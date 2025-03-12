// === ./src/clients/kubernetesClient.ts ===
import {
  KubeConfig,
  ApiextensionsV1Api,
  CustomObjectsApi,
  ApisApi,
  makeInformer,
  KubernetesObject,
  V1CustomResourceDefinition,
  V1Namespace,
  V1CustomResourceDefinitionList,
  V1NamespaceList,
  // We might need these for response shaping
  CoreV1Api,
  HttpError
} from '@kubernetes/client-node';
import * as http from 'http';
import { log, LogLevel } from '../extension';

/**
 * Client for interacting with Kubernetes API in a generic way.
 * Only this class is allowed to import from '@kubernetes/client-node'.
 */
export class KubernetesClient {
  private kc: KubeConfig;
  private apiExtensionsV1Api: ApiextensionsV1Api;
  private customObjectsApi: CustomObjectsApi;
  private apisApi: ApisApi;
  private coreApi: CoreV1Api;

  // Watch-based caches:
  private crdsInformer: any;
  private crdsCache: V1CustomResourceDefinition[] = [];

  private namespacesInformer: any;
  private namespacesCache: V1Namespace[] = [];

  /**
   * We will create an informer per CRD (keyed by `group_version_plural`)
   * to watch all objects of that CRD cluster-wide. This map holds those informers.
   */
  private resourceInformers: Map<string, any> = new Map();

  /**
   * The in-memory store for all CRDs' instances.
   * Key: `${group}_${version}_${plural}`, Value: array of KubernetesObject
   */
  private resourceCache: Map<string, KubernetesObject[]> = new Map();

  constructor() {
    this.kc = new KubeConfig();
    try {
      this.kc.loadFromDefault();
    } catch (error) {
      log(`Failed to load Kubernetes configuration: ${error}`, LogLevel.INFO);
    }
    this.apiExtensionsV1Api = this.kc.makeApiClient(ApiextensionsV1Api);
    this.customObjectsApi = this.kc.makeApiClient(CustomObjectsApi);
    this.apisApi = this.kc.makeApiClient(ApisApi);
    this.coreApi = this.kc.makeApiClient(CoreV1Api);
  }

  /**
   * Kick off all watchers so that CRDs, Namespaces, and their resources
   * are continuously cached in memory.
   */
  public async startWatchers(): Promise<void> {
    log('Starting watchers (CRDs, Namespaces, and CRD-based resources)...', LogLevel.INFO);

    await this.startCrdWatcher();
    await this.startNamespaceWatcher();

    log('All watchers started.', LogLevel.INFO);
  }

  /**
   * Begin watching CRDs themselves. Whenever a new CRD is added/updated,
   * we also start a watcher for its resources (if not a standard k8s.io group).
   */
  private async startCrdWatcher(): Promise<void> {
    log('Starting CRD watcher...', LogLevel.INFO);

    // Provide a list function with the correct shape
    const listCrds = async (): Promise<{
      response: http.IncomingMessage;
      body: V1CustomResourceDefinitionList;
    }> => {
      const resp = await this.apiExtensionsV1Api.listCustomResourceDefinition();
      // resp.body is already V1CustomResourceDefinitionList
      return { response: resp.response, body: resp.body };
    };

    // Watch: item type = V1CustomResourceDefinition
    this.crdsInformer = makeInformer<V1CustomResourceDefinition>(
      this.kc,
      '/apis/apiextensions.k8s.io/v1/customresourcedefinitions',
      listCrds
    );

    this.crdsInformer.on('add', (obj: V1CustomResourceDefinition) => {
      if (!this.crdsCache.find((o) => o.metadata?.name === obj.metadata?.name)) {
        this.crdsCache.push(obj);
        log(`Watcher detected new CRD: ${obj.metadata?.name || 'unknown'}`, LogLevel.INFO)
        this.startResourceWatcher(obj).catch((err) =>
          log(`Error starting resource watcher: ${err}`, LogLevel.INFO)
        );
      }
    });

    this.crdsInformer.on('update', (obj: V1CustomResourceDefinition) => {
      const index = this.crdsCache.findIndex((o) => o.metadata?.name === obj.metadata?.name);
      if (index >= 0) {
        this.crdsCache[index] = obj;
      } else {
        this.crdsCache.push(obj);
        log(`Watcher detected update on CRD: ${obj.metadata?.name || 'unknown'}`, LogLevel.INFO)
        this.startResourceWatcher(obj).catch((err) =>
          log(`Error starting resource watcher: ${err}`, LogLevel.INFO)
        );
      }
    });

    this.crdsInformer.on('delete', (obj: V1CustomResourceDefinition) => {
      this.crdsCache = this.crdsCache.filter((o) => o.metadata?.name !== obj.metadata?.name);
      log(`Watcher detected delete CRD: ${obj.metadata?.name || 'unknown'}`, LogLevel.INFO)
      // Optionally: stop watchers for that CRD
    });

    this.crdsInformer.on('error', (err: any) => {
      log(`CRD informer error: ${err}`, LogLevel.INFO);
      // Restart the informer after a short delay
      setTimeout(() => {
        this.crdsInformer.start().catch((err: any) => {
          log(`Failed to restart CRD informer: ${err}`, LogLevel.INFO);
        });
      }, 5000);
    });

    await this.crdsInformer.start();
  }

  /**
   * Begin watching core Namespaces. We'll store them so that any
   * namespaced CRD watchers know which namespaces exist, but
   * in this example we simply store them for potential filtering.
   */
  private async startNamespaceWatcher(): Promise<void> {
    log('Starting Namespace watcher...', LogLevel.INFO);

    // We watch all namespaces from /api/v1/namespaces
    const listNamespaces = async (): Promise<{
      response: http.IncomingMessage;
      body: V1NamespaceList;
    }> => {
      const resp = await this.coreApi.listNamespace();
      // resp.body is V1NamespaceList
      return { response: resp.response, body: resp.body };
    };

    this.namespacesInformer = makeInformer<V1Namespace>(
      this.kc,
      '/api/v1/namespaces',
      listNamespaces
    );

    this.namespacesInformer.on('add', (obj: V1Namespace) => {
      if (!this.namespacesCache.find((o) => o.metadata?.name === obj.metadata?.name)) {
        this.namespacesCache.push(obj);
        log(`Watcher detected new Namespace: ${obj.metadata?.name || 'unknown'}`, LogLevel.INFO);
      }
    });

    this.namespacesInformer.on('update', (obj: V1Namespace) => {
      const idx = this.namespacesCache.findIndex((o) => o.metadata?.name === obj.metadata?.name);
      if (idx >= 0) {
        this.namespacesCache[idx] = obj;
      } else {
        this.namespacesCache.push(obj);
        log(`Watcher detected update Namespace: ${obj.metadata?.name || 'unknown'}`, LogLevel.INFO);
      }
    });

    this.namespacesInformer.on('delete', (obj: V1Namespace) => {
      this.namespacesCache = this.namespacesCache.filter(
        (o) => o.metadata?.name !== obj.metadata?.name
      );
    });

    this.namespacesInformer.on('error', (err: any) => {
      log(`Namespace informer error: ${err}`, LogLevel.INFO);
      setTimeout(() => {
        this.namespacesInformer.start().catch((startErr: any) => {
          log(`Failed to restart Namespace informer: ${startErr}`, LogLevel.INFO);
        });
      }, 5000);
    });

    await this.namespacesInformer.start();
  }

  /**
   * Whenever a new CRD is discovered (or updated), we start a
   * watch-based informer for that CRD’s resources, if it is
   * not part of the standard k8s.io group. This yields a
   * cluster-wide resource cache.
   */
  private async startResourceWatcher(crd: V1CustomResourceDefinition): Promise<void> {
    const group = crd.spec?.group || '';
    if (!group || group.endsWith('k8s.io')) {
      // Skip standard k8s
      return;
    }

    const versionObj = crd.spec?.versions?.find((v) => v.served) || crd.spec?.versions?.[0];
    if (!versionObj) {
      return;
    }
    const version = versionObj.name;
    const plural = crd.spec?.names?.plural || '';
    if (!plural) {
      return;
    }
    const scope = crd.spec?.scope; // "Namespaced" or "Cluster"

    // We'll store them in resourceCache keyed by "group_version_plural"
    const key = `${group}_${version}_${plural}`;
    if (this.resourceInformers.has(key)) {
      // Already watching this CRD
      return;
    }

    log(`Starting resource watcher for CRD: ${key}`, LogLevel.INFO);

    // We will watch cluster-wide for both cluster-scoped and namespaced CRDs
    const path = `/apis/${group}/${version}/${plural}`;

    // The list function must return { response, body },
    // where body.items = array of objects that implement KubernetesObject
    const listFn = async (): Promise<{
      response: http.IncomingMessage;
      body: { items: KubernetesObject[] };
    }> => {
      const res = await this.customObjectsApi.listClusterCustomObject(group, version, plural);
      // The returned object is typed
      //   { response: IncomingMessage; body: any }
      // We must cast `res.body` to { items: KubernetesObject[] } for the informer to work
      return {
        response: res.response,
        body: res.body as { items: KubernetesObject[] }
      };
    };

    const informer = makeInformer<KubernetesObject>(this.kc, path, listFn);
    this.resourceInformers.set(key, informer);
    this.resourceCache.set(key, []); // Initialize empty array

    informer.on('add', (obj: KubernetesObject) => {
      const arr = this.resourceCache.get(key) || [];
      if (!arr.find((o) => o.metadata?.uid === obj.metadata?.uid)) {
        arr.push(obj);
        this.resourceCache.set(key, arr);

        const resourceName = obj.metadata?.name || 'unknown';
        const namespace = obj.metadata?.namespace ? `in namespace ${obj.metadata.namespace}` : '(cluster-scoped)';
        log(`Watcher detected new ${crd.spec?.names?.kind || 'resource'}: ${resourceName} ${namespace}`, LogLevel.INFO);

      }
    });

    informer.on('update', (obj: KubernetesObject) => {
      const arr = this.resourceCache.get(key) || [];
      const idx = arr.findIndex((o) => o.metadata?.uid === obj.metadata?.uid);
      if (idx >= 0) {
        arr[idx] = obj;
      } else {
        arr.push(obj);
      }
      this.resourceCache.set(key, arr);
      const resourceName = obj.metadata?.name || 'unknown';
      log(`Watcher detected update to ${crd.spec?.names?.kind || 'resource'}: ${resourceName}`, LogLevel.INFO);
    });

    informer.on('delete', (obj: KubernetesObject) => {
      let arr = this.resourceCache.get(key) || [];
      arr = arr.filter((o) => o.metadata?.uid !== obj.metadata?.uid);
      this.resourceCache.set(key, arr);
      const resourceName = obj.metadata?.name || 'unknown';
      log(`Watcher detected deletion of ${crd.spec?.names?.kind || 'resource'}: ${resourceName}`, LogLevel.INFO);
    });

    informer.on('error', (err: any) => {
      log(`Resource watcher error for ${key}: ${err}`, LogLevel.INFO);
      // Attempt to restart after a delay
      setTimeout(() => {
        informer.start().catch((startErr: any) => {
          log(`Failed to restart resource watcher (${key}): ${startErr}`, LogLevel.INFO);
        });
      }, 5000);
    });

    await informer.start();
  }

  /***********************
   *  Cache Getters
   **********************/
  public getCachedCrds(): V1CustomResourceDefinition[] {
    return this.crdsCache;
  }

  public getCachedNamespaces(): V1Namespace[] {
    return this.namespacesCache;
  }

  public getCachedResources(group: string, version: string, plural: string): KubernetesObject[] {
    const key = `${group}_${version}_${plural}`;
    return this.resourceCache.get(key) || [];
  }

  /***********************
   *  (Optional) direct list methods
   **********************/

  /**
   * List all CustomResourceDefinitions (direct API call).
   * Not used by the informer, but can be used outside watchers if needed.
   */
  public async listCustomResourceDefinitions(): Promise<V1CustomResourceDefinition[]> {
    try {
      const resp = await this.apiExtensionsV1Api.listCustomResourceDefinition();
      return resp.body.items || [];
    } catch (error) {
      log(`Error listing CRDs: ${error}`, LogLevel.INFO);
      return [];
    }
  }

  /**
   * List cluster-scoped objects for a given CRD (direct API call).
   * Returns just { items: ... }, not suitable for `makeInformer`.
   */
  public async listClusterCustomObject(
    group: string,
    version: string,
    plural: string
  ): Promise<{ items: any[] }> {
    try {
      const res = await this.customObjectsApi.listClusterCustomObject(group, version, plural);
      return res.body as { items: any[] };
    } catch (error) {
      throw new Error(`listClusterCustomObject failed: ${error}`);
    }
  }

  /**
   * List namespaced objects for a given CRD (direct API call).
   */
  public async listNamespacedCustomObject(
    group: string,
    version: string,
    namespace: string,
    plural: string
  ): Promise<{ items: any[] }> {
    try {
      const res = await this.customObjectsApi.listNamespacedCustomObject(
        group,
        version,
        namespace,
        plural
      );
      return res.body as { items: any[] };
    } catch (error) {
      throw new Error(`listNamespacedCustomObject failed: ${error}`);
    }
  }
}
