// === ./src/clients/kubernetesClient.ts (UPDATED) ===

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
  CoreV1Api,
} from '@kubernetes/client-node';
import * as http from 'http';
import { log, LogLevel } from '../extension';
import { EdactlClient } from './edactlClient'; // Only for the type reference
import * as vscode from 'vscode';

export class KubernetesClient {

  private _onResourceChanged = new vscode.EventEmitter<void>();
  readonly onResourceChanged = this._onResourceChanged.event;

  private kc: KubeConfig;
  private apiExtensionsV1Api: ApiextensionsV1Api;
  private customObjectsApi: CustomObjectsApi;
  private apisApi: ApisApi;
  private coreApi: CoreV1Api;

  private crdsInformer: any;
  private crdsCache: V1CustomResourceDefinition[] = [];

  private namespacesInformer: any;
  private namespacesCache: V1Namespace[] = [];

  // We store EDA namespaces here, updated whenever refreshEdaNamespaces() is called
  private edaNamespaces: string[] = [];

  // This is initially undefined. We set it once from extension.ts or serviceManager
  private edactlClient?: EdactlClient;

  // Resource watchers:
  private resourceInformers: Map<string, any> = new Map();
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
   * Let external code provide an EdactlClient so that we can fetch EDA namespaces.
   */
  public setEdactlClient(client: EdactlClient) {
    this.edactlClient = client;
  }

  /**
   * Start watchers for CRDs, namespaces, etc.
   */
  public async startWatchers(): Promise<void> {
    log('Starting watchers (CRDs, Namespaces, and CRD-based resources)...', LogLevel.INFO);

    // 1) CRDs
    await this.startCrdWatcher();

    // 2) Namespaces
    await this.startNamespaceWatcher();

    // 3) If we have an edactlClient, do an initial EDA namespace load
    if (this.edactlClient) {
      await this.refreshEdaNamespaces();
    }

    log('All watchers started.', LogLevel.INFO);
  }

  /**
   * Watch CRDs themselves
   */
  private async startCrdWatcher(): Promise<void> {
    log('Starting CRD watcher...', LogLevel.INFO);

    const listCrds = async (): Promise<{
      response: http.IncomingMessage;
      body: V1CustomResourceDefinitionList;
    }> => {
      const resp = await this.apiExtensionsV1Api.listCustomResourceDefinition();
      return { response: resp.response, body: resp.body };
    };

    this.crdsInformer = makeInformer<V1CustomResourceDefinition>(
      this.kc,
      '/apis/apiextensions.k8s.io/v1/customresourcedefinitions',
      listCrds
    );

    this.crdsInformer.on('add', (obj: V1CustomResourceDefinition) => {
      if (!this.crdsCache.find((o) => o.metadata?.name === obj.metadata?.name)) {
        this.crdsCache.push(obj);
        log(`Watcher detected new CRD: ${obj.metadata?.name || 'unknown'}`, LogLevel.INFO);
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
      }
      log(`Watcher detected update CRD: ${obj.metadata?.name || 'unknown'}`, LogLevel.INFO);
      this.startResourceWatcher(obj).catch((err) =>
        log(`Error starting resource watcher: ${err}`, LogLevel.INFO)
      );
    });

    this.crdsInformer.on('delete', (obj: V1CustomResourceDefinition) => {
      this.crdsCache = this.crdsCache.filter((o) => o.metadata?.name !== obj.metadata?.name);
      log(`Watcher detected delete CRD: ${obj.metadata?.name || 'unknown'}`, LogLevel.INFO);
      // optionally stop watchers for that CRD
    });

    this.crdsInformer.on('error', (err: any) => {
      log(`CRD informer error: ${err}`, LogLevel.INFO);
      setTimeout(() => {
        this.crdsInformer.start().catch((e: any) => {
          log(`Failed to restart CRD informer: ${e}`, LogLevel.INFO);
        });
      }, 5000);
    });

    await this.crdsInformer.start();
  }

  /**
   * Watch all namespaces as you originally wanted
   */
  private async startNamespaceWatcher(): Promise<void> {
    log('Starting Namespace watcher...', LogLevel.INFO);

    const listNamespaces = async (): Promise<{
      response: http.IncomingMessage;
      body: V1NamespaceList;
    }> => {
      const resp = await this.coreApi.listNamespace();
      return { response: resp.response, body: resp.body };
    };

    this.namespacesInformer = makeInformer<V1Namespace>(
      this.kc,
      '/api/v1/namespaces',
      listNamespaces
    );

    this.namespacesInformer.on('add', async (obj: V1Namespace) => {
      if (!this.namespacesCache.find((o) => o.metadata?.name === obj.metadata?.name)) {
        this.namespacesCache.push(obj);
        log(`Watcher detected new Namespace: ${obj.metadata?.name || 'unknown'}`, LogLevel.INFO);
      }
      if (this.edactlClient) {
        await this.refreshEdaNamespaces(); // re-check if EDA ns changed
      }
    });

    this.namespacesInformer.on('update', async (obj: V1Namespace) => {
      const idx = this.namespacesCache.findIndex((o) => o.metadata?.name === obj.metadata?.name);
      if (idx >= 0) {
        this.namespacesCache[idx] = obj;
      } else {
        this.namespacesCache.push(obj);
      }
      log(`Watcher detected update Namespace: ${obj.metadata?.name || 'unknown'}`, LogLevel.INFO);
      if (this.edactlClient) {
        await this.refreshEdaNamespaces();
      }
    });

    this.namespacesInformer.on('delete', async (obj: V1Namespace) => {
      this.namespacesCache = this.namespacesCache.filter(
        (o) => o.metadata?.name !== obj.metadata?.name
      );
      log(`Watcher detected delete Namespace: ${obj.metadata?.name || 'unknown'}`, LogLevel.INFO);
      if (this.edactlClient) {
        await this.refreshEdaNamespaces();
      }
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
   * Re-fetch EDA namespaces via edactlClient, then create watchers for only those namespaces
   */
  private async refreshEdaNamespaces() {
    if (!this.edactlClient) {
      return; // in case it's never set
    }
    try {
      const ns = await this.edactlClient.getEdaNamespaces();
      this.edaNamespaces = ns || [];
      log(`Refreshed EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

      // For all known CRDs, if they are "Namespaced", watch them in these EDA namespaces only
      for (const crd of this.crdsCache) {
        if (crd.spec.scope === 'Namespaced') {
          await this.startResourceWatcher(crd);
        }
      }
    } catch (err) {
      log(`Failed to refresh EDA namespaces: ${err}`, LogLevel.ERROR);
    }
  }

  /**
   * If cluster-scoped, watch cluster-wide. If namespaced, watch only edaNamespaces.
   */
  private async startResourceWatcher(crd: V1CustomResourceDefinition): Promise<void> {
    const group = crd.spec?.group || '';
    if (!group || group.endsWith('k8s.io')) {
      return; // ignore standard k8s.io
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

    if (crd.spec.scope === 'Cluster') {
      const key = `${group}_${version}_${plural}`;
      if (this.resourceInformers.has(key)) {
        // already have a cluster-wide informer
        return;
      }
      log(`Starting cluster-wide resource watcher for CRD: ${key}`, LogLevel.INFO);

      const path = `/apis/${group}/${version}/${plural}`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: { items: KubernetesObject[] } }> => {
        const res = await this.customObjectsApi.listClusterCustomObject(group, version, plural);
        return { response: res.response, body: res.body as { items: KubernetesObject[] } };
      };

      const informer = makeInformer<KubernetesObject>(this.kc, path, listFn);
      this.attachResourceInformerHandlers(informer, crd, key);
      this.resourceInformers.set(key, informer);
      await informer.start();
    } else {
      // "Namespaced" CRD => watchers only in this.edaNamespaces
      const baseKey = `${group}_${version}_${plural}`;

      // create watchers for each EDA namespace that doesn't already have one
      for (const ns of this.edaNamespaces) {
        const nsKey = `${baseKey}_${ns}`;
        if (this.resourceInformers.has(nsKey)) {
          // already watching
          continue;
        }
        log(`Starting namespaced resource watcher for CRD: ${baseKey} in namespace: ${ns}`, LogLevel.INFO);

        const path = `/apis/${group}/${version}/namespaces/${ns}/${plural}`;
        const listFn = async (): Promise<{ response: http.IncomingMessage; body: { items: KubernetesObject[] } }> => {
          const res = await this.customObjectsApi.listNamespacedCustomObject(group, version, ns, plural);
          return { response: res.response, body: res.body as { items: KubernetesObject[] } };
        };

        const informer = makeInformer<KubernetesObject>(this.kc, path, listFn);
        this.attachResourceInformerHandlers(informer, crd, nsKey);
        this.resourceInformers.set(nsKey, informer);
        await informer.start();
      }

      // OPTIONAL: Stop watchers for namespaces that are no longer in EDA set:
      for (const [infKey, infVal] of this.resourceInformers.entries()) {
        if (infKey.startsWith(`${baseKey}_`)) {
          // e.g. "group_ver_plural_myns"
          const parts = infKey.split('_');
          const nsPart = parts[3];
          if (!this.edaNamespaces.includes(nsPart)) {
            log(`Stopping stale watcher for CRD: ${baseKey} in old namespace: ${nsPart}`, LogLevel.INFO);
            try {
              infVal.stop();
            } catch (err) {
              log(`Error stopping informer for ${infKey}: ${err}`, LogLevel.ERROR);
            }
            this.resourceInformers.delete(infKey);
          }
        }
      }
    }
  }

  private attachResourceInformerHandlers(
    informer: ReturnType<typeof makeInformer<KubernetesObject>>,
    crd: V1CustomResourceDefinition,
    key: string
  ) {
    informer.on('add', (obj: KubernetesObject) => {
      const arr = this.resourceCache.get(key) || [];
      if (!arr.find((o) => o.metadata?.uid === obj.metadata?.uid)) {
        arr.push(obj);
        this.resourceCache.set(key, arr);
        const resourceName = obj.metadata?.name || 'unknown';
        log(`Watcher detected new ${crd.spec?.names?.kind || 'resource'}: ${resourceName}`, LogLevel.INFO);

        // Fire the event with a slight delay to ensure consistent state
        setTimeout(() => {
          this._onResourceChanged.fire();
        }, 50);
      }
    });

    informer.on('update', (obj: KubernetesObject) => {
      const arr = this.resourceCache.get(key) || [];
      const idx = arr.findIndex((o) => o.metadata?.uid === obj.metadata?.uid);
      if (idx >= 0) {
        arr[idx] = obj;
      } else {
        // If not found by UID, this is actually a new object we missed somehow
        arr.push(obj);
      }
      this.resourceCache.set(key, arr);
      const resourceName = obj.metadata?.name || 'unknown';
      log(`Watcher detected update to ${crd.spec?.names?.kind || 'resource'}: ${resourceName}`, LogLevel.INFO);

      // Fire the event with a slight delay
      setTimeout(() => {
        this._onResourceChanged.fire();
      }, 50);
    });

    informer.on('delete', (obj: KubernetesObject) => {
      let arr = this.resourceCache.get(key) || [];
      arr = arr.filter((o) => o.metadata?.uid !== obj.metadata?.uid);
      this.resourceCache.set(key, arr);
      const resourceName = obj.metadata?.name || 'unknown';
      log(`Watcher detected deletion of ${crd.spec?.names?.kind || 'resource'}: ${resourceName}`, LogLevel.INFO);

      // Fire the event with a slight delay
      setTimeout(() => {
        this._onResourceChanged.fire();
      }, 50);
    });

    informer.on('error', (err: any) => {
      log(`Resource watcher error for ${key}: ${err}`, LogLevel.INFO);
      setTimeout(() => {
        informer.start().catch((startErr: any) => {
          log(`Failed to restart resource watcher (${key}): ${startErr}`, LogLevel.INFO);
        });
      }, 5000);
    });
  }

  // Public getters remain as you had them:
  public getCachedCrds(): V1CustomResourceDefinition[] {
    return this.crdsCache;
  }

  public getCachedNamespaces(): V1Namespace[] {
    return this.namespacesCache;
  }

  public getCachedResources(group: string, version: string, plural: string, namespace?: string): KubernetesObject[] {
    let results: KubernetesObject[] = [];

    // Collect all matching resources
    for (const [key, resources] of this.resourceCache.entries()) {
      // Parse the key to get components
      const keyParts = key.split('_');
      const keyGroup = keyParts[0];
      const keyVersion = keyParts[1];
      const keyPlural = keyParts[2];
      const keyNamespace = keyParts.length > 3 ? keyParts[3] : undefined;

      // Check if this cache entry matches our request
      if (keyGroup === group && keyVersion === version && keyPlural === plural) {
        // If namespace is specified, only include resources from that namespace
        if (namespace) {
          if (keyNamespace === namespace) {
            results = [...results, ...resources];
          } else {
            // For resources without explicit namespace key, filter by metadata
            const filteredResources = resources.filter(r =>
              r.metadata?.namespace === namespace);
            results = [...results, ...filteredResources];
          }
        } else {
          // No namespace filter, include all resources
          results = [...results, ...resources];
        }
      }
    }

    log(`Found ${results.length} cached ${plural} resources in ${namespace || 'all namespaces'}`, LogLevel.DEBUG);
    return results;
  }


  public dispose(): void {
    // Stop all informers
    for (const informer of this.resourceInformers.values()) {
      try {
        informer.stop();
      } catch (error) {
        log(`Error stopping informer: ${error}`, LogLevel.ERROR);
      }
    }

    this.crdsInformer?.stop();
    this.namespacesInformer?.stop();
    this._onResourceChanged.dispose();

    // Clear caches
    this.resourceInformers.clear();
    this.resourceCache.clear();
    this.crdsCache = [];
    this.namespacesCache = [];
  }

  // Direct listing methods are the same:
  public async listCustomResourceDefinitions(): Promise<V1CustomResourceDefinition[]> {
    try {
      const resp = await this.apiExtensionsV1Api.listCustomResourceDefinition();
      return resp.body.items || [];
    } catch (error) {
      log(`Error listing CRDs: ${error}`, LogLevel.INFO);
      return [];
    }
  }

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
