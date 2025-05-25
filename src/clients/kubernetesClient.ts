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
  V1Pod,
  V1PodList,
  V1Service,
  V1ServiceList,
  V1ConfigMap,
  V1ConfigMapList,
  V1Secret,
  V1SecretList,
  V1PersistentVolumeClaim,
  V1PersistentVolumeClaimList,
  V1Endpoints,
  V1EndpointsList,
  V1PersistentVolume,
  V1PersistentVolumeList,
  AppsV1Api,
  V1Deployment,
  V1DeploymentList,
  V1ReplicaSet,
  V1ReplicaSetList,
  V1StatefulSet,
  V1StatefulSetList,
  V1DaemonSet,
  V1DaemonSetList,
  BatchV1Api,
  V1Job,
  V1JobList,
  V1CronJob,
  V1CronJobList,
  NetworkingV1Api,
  V1Ingress,
  V1IngressList,
} from '@kubernetes/client-node';
import * as http from 'http';
import { log, LogLevel } from '../extension';
import { EdactlClient } from './edactlClient';
import * as vscode from 'vscode';

export class KubernetesClient {

  private _onResourceChanged = new vscode.EventEmitter<void>();
  readonly onResourceChanged = this._onResourceChanged.event;

  private _onDeviationChanged = new vscode.EventEmitter<void>();
  public readonly onDeviationChanged: vscode.Event<void> = this._onDeviationChanged.event;

  private _onTransactionChanged = new vscode.EventEmitter<void>();
  public readonly onTransactionChanged: vscode.Event<void> = this._onTransactionChanged.event;

  private kc: KubeConfig;
  private apiExtensionsV1Api: ApiextensionsV1Api;
  private customObjectsApi: CustomObjectsApi;
  private apisApi: ApisApi;
  private coreApi: CoreV1Api;
  private appsV1Api: AppsV1Api;
  private batchV1Api: BatchV1Api;
  private networkingV1Api: NetworkingV1Api;

  private crdsInformer: any;
  private crdsCache: V1CustomResourceDefinition[] = [];

  private namespacesInformer: any;
  private namespacesCache: V1Namespace[] = [];

  private podInformers: Map<string, any> = new Map();
  private podsCache: Map<string, V1Pod[]> = new Map();

  private serviceInformers: Map<string, any> = new Map();
  private servicesCache: Map<string, V1Service[]> = new Map();

  private configMapInformers: Map<string, any> = new Map();
  private configMapsCache: Map<string, V1ConfigMap[]> = new Map();

  private secretInformers: Map<string, any> = new Map();
  private secretsCache: Map<string, V1Secret[]> = new Map();

  private pvcInformers: Map<string, any> = new Map();
  private pvcsCache: Map<string, V1PersistentVolumeClaim[]> = new Map();

  private endpointsInformers: Map<string, any> = new Map();
  private endpointsCache: Map<string, V1Endpoints[]> = new Map();

  private pvInformer: any;
  private pvsCache: V1PersistentVolume[] = [];

  private deploymentInformers: Map<string, any> = new Map();
  private deploymentsCache: Map<string, V1Deployment[]> = new Map();

  private replicaSetInformers: Map<string, any> = new Map();
  private replicaSetsCache: Map<string, V1ReplicaSet[]> = new Map();

  private statefulSetInformers: Map<string, any> = new Map();
  private statefulSetsCache: Map<string, V1StatefulSet[]> = new Map();

  private daemonSetInformers: Map<string, any> = new Map();
  private daemonSetsCache: Map<string, V1DaemonSet[]> = new Map();

  private jobInformers: Map<string, any> = new Map();
  private jobsCache: Map<string, V1Job[]> = new Map();

  private cronJobInformers: Map<string, any> = new Map();
  private cronJobsCache: Map<string, V1CronJob[]> = new Map();

  private ingressInformers: Map<string, any> = new Map();
  private ingressesCache: Map<string, V1Ingress[]> = new Map();

  private edaNamespaces: string[] = [];
  private edactlClient?: EdactlClient;

  private resourceInformers: Map<string, any> = new Map();
  private resourceCache: Map<string, KubernetesObject[]> = new Map();

  private resourceChangeDebounceTimer: NodeJS.Timeout | null = null;
  private resourceChangesPending: boolean = false;

  constructor() {
    this.kc = new KubeConfig();
    try {
      this.kc.loadFromDefault();
    } catch (error) {
      log(`Failed to load Kubernetes configuration: ${error}`, LogLevel.ERROR);
    }
    this.apiExtensionsV1Api = this.kc.makeApiClient(ApiextensionsV1Api);
    this.customObjectsApi = this.kc.makeApiClient(CustomObjectsApi);
    this.apisApi = this.kc.makeApiClient(ApisApi);
    this.coreApi = this.kc.makeApiClient(CoreV1Api);
    this.appsV1Api = this.kc.makeApiClient(AppsV1Api);
    this.batchV1Api = this.kc.makeApiClient(BatchV1Api);
    this.networkingV1Api = this.kc.makeApiClient(NetworkingV1Api);
  }

  /**
   * Get the name of the current context from KubeConfig
   */
  public getCurrentContext(): string {
    return this.kc.getCurrentContext() || 'none';
  }

  /**
   * Return all available contexts in the KubeConfig
   */
  public getAvailableContexts(): string[] {
    const contexts = this.kc.getContexts() || [];
    return contexts.map((ctx) => ctx.name);
  }

  /**
   * Switch the current context and re-init watchers
   */
  public async switchContext(contextName: string): Promise<void> {
    log(`Switching Kubernetes context to "${contextName}"...`, LogLevel.INFO, true);

    this.kc.setCurrentContext(contextName);

    try {
      const { execSync } = require('child_process');
      execSync(`kubectl config use-context ${contextName}`, { encoding: 'utf-8' });
      log(`Updated kubeconfig file to use context "${contextName}"`, LogLevel.INFO);
    } catch (error) {
      log(`Warning: Failed to update kubeconfig file: ${error}`, LogLevel.WARN);
    }

    if (this.edactlClient) {
      this.edactlClient.clearCache();
    }

    if (this.crdsInformer) {
      try {
        this.crdsInformer.stop();
      } catch (err) {
        log(`Error stopping CRD informer: ${err}`, LogLevel.WARN);
      }
    }

    if (this.namespacesInformer) {
      try {
        this.namespacesInformer.stop();
      } catch (err) {
        log(`Error stopping Namespace informer: ${err}`, LogLevel.WARN);
      }
    }

    if (this.pvInformer) {
      try {
        this.pvInformer.stop();
      } catch (err) {
        log(`Error stopping PV informer: ${err}`, LogLevel.WARN);
      }
    }

    this.stopAllNamespacedInformers();

    for (const [key, informer] of this.resourceInformers.entries()) {
      try {
        informer.stop();
      } catch (err) {
        log(`Error stopping resource informer ${key}: ${err}`, LogLevel.WARN);
      }
    }

    this.clearAllCaches();

    this.apiExtensionsV1Api = this.kc.makeApiClient(ApiextensionsV1Api);
    this.customObjectsApi = this.kc.makeApiClient(CustomObjectsApi);
    this.apisApi = this.kc.makeApiClient(ApisApi);
    this.coreApi = this.kc.makeApiClient(CoreV1Api);
    this.appsV1Api = this.kc.makeApiClient(AppsV1Api);
    this.batchV1Api = this.kc.makeApiClient(BatchV1Api);
    this.networkingV1Api = this.kc.makeApiClient(NetworkingV1Api);

    await this.startWatchers();
    log(`Switched Kubernetes context to "${contextName}".`, LogLevel.INFO, true);
  }

  /**
   * Stop all namespaced informers
   */
  private stopAllNamespacedInformers(): void {
    this.stopInformers(this.podInformers);
    this.stopInformers(this.serviceInformers);
    this.stopInformers(this.configMapInformers);
    this.stopInformers(this.secretInformers);
    this.stopInformers(this.pvcInformers);
    this.stopInformers(this.endpointsInformers);
    this.stopInformers(this.deploymentInformers);
    this.stopInformers(this.replicaSetInformers);
    this.stopInformers(this.statefulSetInformers);
    this.stopInformers(this.daemonSetInformers);
    this.stopInformers(this.jobInformers);
    this.stopInformers(this.cronJobInformers);
    this.stopInformers(this.ingressInformers);
  }

  /**
   * Helper to stop all informers in a map
   */
  private stopInformers(informers: Map<string, any>): void {
    for (const [key, informer] of informers.entries()) {
      try {
        informer.stop();
      } catch (err) {
        log(`Error stopping informer ${key}: ${err}`, LogLevel.WARN);
      }
    }
    informers.clear();
  }

  /**
   * Clear all cache collections
   */
  private clearAllCaches(): void {
    this.resourceInformers.clear();
    this.resourceCache.clear();

    this.podInformers.clear();
    this.podsCache.clear();
    this.serviceInformers.clear();
    this.servicesCache.clear();
    this.configMapInformers.clear();
    this.configMapsCache.clear();
    this.secretInformers.clear();
    this.secretsCache.clear();
    this.pvcInformers.clear();
    this.pvcsCache.clear();
    this.endpointsInformers.clear();
    this.endpointsCache.clear();

    this.pvsCache = [];

    this.deploymentInformers.clear();
    this.deploymentsCache.clear();
    this.replicaSetInformers.clear();
    this.replicaSetsCache.clear();
    this.statefulSetInformers.clear();
    this.statefulSetsCache.clear();
    this.daemonSetInformers.clear();
    this.daemonSetsCache.clear();

    this.jobInformers.clear();
    this.jobsCache.clear();
    this.cronJobInformers.clear();
    this.cronJobsCache.clear();

    this.ingressInformers.clear();
    this.ingressesCache.clear();

    this.crdsCache = [];
    this.namespacesCache = [];
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

    await this.startCrdWatcher();
    await this.startNamespaceWatcher();
    await this.startPersistentVolumeWatcher();

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
      listCrds,
    );

    this.crdsInformer.on('add', (obj: V1CustomResourceDefinition) => {
      if (!this.crdsCache.find((o) => o.metadata?.name === obj.metadata?.name)) {
        this.crdsCache.push(obj);
        log(`Watcher detected new CRD: ${obj.metadata?.name || 'unknown'}`, LogLevel.DEBUG);
        this.startResourceWatcher(obj).catch((err) =>
          log(`Error starting resource watcher: ${err}`, LogLevel.ERROR)
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
      log(`Watcher detected update CRD: ${obj.metadata?.name || 'unknown'}`, LogLevel.DEBUG);
      this.startResourceWatcher(obj).catch((err) =>
        log(`Error starting resource watcher: ${err}`, LogLevel.ERROR)
      );
    });

    this.crdsInformer.on('delete', (obj: V1CustomResourceDefinition) => {
      this.crdsCache = this.crdsCache.filter((o) => o.metadata?.name !== obj.metadata?.name);
      log(`Watcher detected delete CRD: ${obj.metadata?.name || 'unknown'}`, LogLevel.DEBUG);
    });

    this.crdsInformer.on('error', (err: any) => {
      log(`CRD informer error: ${err}`, LogLevel.ERROR);
      setTimeout(() => {
        this.crdsInformer.start().catch((e: any) => {
          log(`Failed to restart CRD informer: ${e}`, LogLevel.ERROR);
        });
      }, 5000);
    });

    await this.crdsInformer.start();
  }

  /**
   * Watch all namespaces
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
        log(`Watcher detected new Namespace: ${obj.metadata?.name || 'unknown'}`, LogLevel.DEBUG);
      }
      if (this.edactlClient) {
        await this.refreshEdaNamespaces();
      }
        this.debouncedFireResourceChanged();
    });

    this.namespacesInformer.on('update', async (obj: V1Namespace) => {
      const idx = this.namespacesCache.findIndex((o) => o.metadata?.name === obj.metadata?.name);
      if (idx >= 0) {
        this.namespacesCache[idx] = obj;
      } else {
        this.namespacesCache.push(obj);
      }
      log(`Watcher detected update Namespace: ${obj.metadata?.name || 'unknown'}`, LogLevel.DEBUG);
      if (this.edactlClient) {
        await this.refreshEdaNamespaces();
      }
        this.debouncedFireResourceChanged();
    });

    this.namespacesInformer.on('delete', async (obj: V1Namespace) => {
      this.namespacesCache = this.namespacesCache.filter(
        (o) => o.metadata?.name !== obj.metadata?.name
      );
      log(`Watcher detected delete Namespace: ${obj.metadata?.name || 'unknown'}`, LogLevel.DEBUG);
      if (this.edactlClient) {
        await this.refreshEdaNamespaces();
      }
        this.debouncedFireResourceChanged();
    });

    this.namespacesInformer.on('error', (err: any) => {
      log(`Namespace informer error: ${err}`, LogLevel.ERROR);
      setTimeout(() => {
        this.namespacesInformer.start().catch((startErr: any) => {
          log(`Failed to restart Namespace informer: ${startErr}`, LogLevel.ERROR);
        });
      }, 5000);
    });

    await this.namespacesInformer.start();
  }

  /**
   * Watch PersistentVolumes (cluster-scoped resource)
   */
  private async startPersistentVolumeWatcher(): Promise<void> {
    log('Starting PersistentVolume watcher...', LogLevel.INFO);

    const listPVs = async (): Promise<{
      response: http.IncomingMessage;
      body: V1PersistentVolumeList;
    }> => {
      const resp = await this.coreApi.listPersistentVolume();
      return { response: resp.response, body: resp.body };
    };

    this.pvInformer = makeInformer<V1PersistentVolume>(
      this.kc,
      '/api/v1/persistentvolumes',
      listPVs,
    );

    this.pvInformer.on('add', (obj: V1PersistentVolume) => {
      if (!this.pvsCache.find((o) => o.metadata?.uid === obj.metadata?.uid)) {
        this.pvsCache.push(obj);
        log(`Watcher detected new PersistentVolume: ${obj.metadata?.name || 'unknown'}`, LogLevel.DEBUG);
      }
        this.debouncedFireResourceChanged();
    });

    this.pvInformer.on('update', (obj: V1PersistentVolume) => {
      const idx = this.pvsCache.findIndex((o) => o.metadata?.uid === obj.metadata?.uid);
      if (idx >= 0) {
        this.pvsCache[idx] = obj;
      } else {
        this.pvsCache.push(obj);
      }
      log(`Watcher detected update to PersistentVolume: ${obj.metadata?.name || 'unknown'}`, LogLevel.DEBUG);
        this.debouncedFireResourceChanged();
    });

    this.pvInformer.on('delete', (obj: V1PersistentVolume) => {
      this.pvsCache = this.pvsCache.filter((o) => o.metadata?.uid !== obj.metadata?.uid);
      log(`Watcher detected deletion of PersistentVolume: ${obj.metadata?.name || 'unknown'}`, LogLevel.DEBUG);
        this.debouncedFireResourceChanged();
    });

    this.pvInformer.on('error', (err: any) => {
      log(`PersistentVolume watcher error: ${err}`, LogLevel.ERROR);
      setTimeout(() => {
        this.pvInformer.start().catch((startErr: any) => {
          log(`Failed to restart PersistentVolume watcher: ${startErr}`, LogLevel.ERROR);
        });
      }, 5000);
    });

    await this.pvInformer.start();
  }

  /**
   * Setup pod watchers for each EDA namespace
   */
  private async setupPodWatchers(): Promise<void> {
    log(`Setting up Pod watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `pods_${ns}`;
      if (this.podInformers.has(nsKey)) {
        continue;
      }
      log(`Starting Pod watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/api/v1/namespaces/${ns}/pods`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1PodList }> => {
        const res = await this.coreApi.listNamespacedPod(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1Pod>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.podsCache, 'Pod');
      this.podInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.podInformers, 'pods_');
  }

  /**
   * Setup Service watchers for each EDA namespace
   */
  private async setupServiceWatchers(): Promise<void> {
    log(`Setting up Service watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `services_${ns}`;
      if (this.serviceInformers.has(nsKey)) {
        continue;
      }
      log(`Starting Service watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/api/v1/namespaces/${ns}/services`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1ServiceList }> => {
        const res = await this.coreApi.listNamespacedService(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1Service>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.servicesCache, 'Service');
      this.serviceInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.serviceInformers, 'services_');
  }

  /**
   * Setup ConfigMap watchers for each EDA namespace
   */
  private async setupConfigMapWatchers(): Promise<void> {
    log(`Setting up ConfigMap watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `configmaps_${ns}`;
      if (this.configMapInformers.has(nsKey)) {
        continue;
      }
      log(`Starting ConfigMap watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/api/v1/namespaces/${ns}/configmaps`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1ConfigMapList }> => {
        const res = await this.coreApi.listNamespacedConfigMap(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1ConfigMap>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.configMapsCache, 'ConfigMap');
      this.configMapInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.configMapInformers, 'configmaps_');
  }

  /**
   * Setup Secret watchers for each EDA namespace
   */
  private async setupSecretWatchers(): Promise<void> {
    log(`Setting up Secret watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `secrets_${ns}`;
      if (this.secretInformers.has(nsKey)) {
        continue;
      }
      log(`Starting Secret watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/api/v1/namespaces/${ns}/secrets`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1SecretList }> => {
        const res = await this.coreApi.listNamespacedSecret(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1Secret>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.secretsCache, 'Secret');
      this.secretInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.secretInformers, 'secrets_');
  }

  /**
   * Setup PersistentVolumeClaim watchers for each EDA namespace
   */
  private async setupPVCWatchers(): Promise<void> {
    log(`Setting up PVC watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `pvcs_${ns}`;
      if (this.pvcInformers.has(nsKey)) {
        continue;
      }
      log(`Starting PVC watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/api/v1/namespaces/${ns}/persistentvolumeclaims`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1PersistentVolumeClaimList }> => {
        const res = await this.coreApi.listNamespacedPersistentVolumeClaim(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1PersistentVolumeClaim>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.pvcsCache, 'PVC');
      this.pvcInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.pvcInformers, 'pvcs_');
  }

  /**
   * Setup Endpoints watchers for each EDA namespace
   */
  private async setupEndpointsWatchers(): Promise<void> {
    log(`Setting up Endpoints watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `endpoints_${ns}`;
      if (this.endpointsInformers.has(nsKey)) {
        continue;
      }
      log(`Starting Endpoints watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/api/v1/namespaces/${ns}/endpoints`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1EndpointsList }> => {
        const res = await this.coreApi.listNamespacedEndpoints(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1Endpoints>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.endpointsCache, 'Endpoints');
      this.endpointsInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.endpointsInformers, 'endpoints_');
  }

  /**
   * Setup Deployment watchers for each EDA namespace
   */
  private async setupDeploymentWatchers(): Promise<void> {
    log(`Setting up Deployment watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `deployments_${ns}`;
      if (this.deploymentInformers.has(nsKey)) {
        continue;
      }
      log(`Starting Deployment watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/apis/apps/v1/namespaces/${ns}/deployments`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1DeploymentList }> => {
        const res = await this.appsV1Api.listNamespacedDeployment(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1Deployment>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.deploymentsCache, 'Deployment');
      this.deploymentInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.deploymentInformers, 'deployments_');
  }

  /**
   * Setup ReplicaSet watchers for each EDA namespace
   */
  private async setupReplicaSetWatchers(): Promise<void> {
    log(`Setting up ReplicaSet watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `replicasets_${ns}`;
      if (this.replicaSetInformers.has(nsKey)) {
        continue;
      }
      log(`Starting ReplicaSet watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/apis/apps/v1/namespaces/${ns}/replicasets`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1ReplicaSetList }> => {
        const res = await this.appsV1Api.listNamespacedReplicaSet(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1ReplicaSet>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.replicaSetsCache, 'ReplicaSet');
      this.replicaSetInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.replicaSetInformers, 'replicasets_');
  }

  /**
   * Setup StatefulSet watchers for each EDA namespace
   */
  private async setupStatefulSetWatchers(): Promise<void> {
    log(`Setting up StatefulSet watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `statefulsets_${ns}`;
      if (this.statefulSetInformers.has(nsKey)) {
        continue;
      }
      log(`Starting StatefulSet watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/apis/apps/v1/namespaces/${ns}/statefulsets`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1StatefulSetList }> => {
        const res = await this.appsV1Api.listNamespacedStatefulSet(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1StatefulSet>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.statefulSetsCache, 'StatefulSet');
      this.statefulSetInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.statefulSetInformers, 'statefulsets_');
  }

  /**
   * Setup DaemonSet watchers for each EDA namespace
   */
  private async setupDaemonSetWatchers(): Promise<void> {
    log(`Setting up DaemonSet watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `daemonsets_${ns}`;
      if (this.daemonSetInformers.has(nsKey)) {
        continue;
      }
      log(`Starting DaemonSet watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/apis/apps/v1/namespaces/${ns}/daemonsets`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1DaemonSetList }> => {
        const res = await this.appsV1Api.listNamespacedDaemonSet(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1DaemonSet>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.daemonSetsCache, 'DaemonSet');
      this.daemonSetInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.daemonSetInformers, 'daemonsets_');
  }

  /**
   * Setup Job watchers for each EDA namespace
   */
  private async setupJobWatchers(): Promise<void> {
    log(`Setting up Job watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `jobs_${ns}`;
      if (this.jobInformers.has(nsKey)) {
        continue;
      }
      log(`Starting Job watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/apis/batch/v1/namespaces/${ns}/jobs`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1JobList }> => {
        const res = await this.batchV1Api.listNamespacedJob(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1Job>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.jobsCache, 'Job');
      this.jobInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.jobInformers, 'jobs_');
  }

  /**
   * Setup CronJob watchers for each EDA namespace
   */
  private async setupCronJobWatchers(): Promise<void> {
    log(`Setting up CronJob watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `cronjobs_${ns}`;
      if (this.cronJobInformers.has(nsKey)) {
        continue;
      }
      log(`Starting CronJob watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/apis/batch/v1/namespaces/${ns}/cronjobs`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1CronJobList }> => {
        const res = await this.batchV1Api.listNamespacedCronJob(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1CronJob>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.cronJobsCache, 'CronJob');
      this.cronJobInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.cronJobInformers, 'cronjobs_');
  }

  /**
   * Setup Ingress watchers for each EDA namespace
   */
  private async setupIngressWatchers(): Promise<void> {
    log(`Setting up Ingress watchers for EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

    for (const ns of this.edaNamespaces) {
      const nsKey = `ingresses_${ns}`;
      if (this.ingressInformers.has(nsKey)) {
        continue;
      }
      log(`Starting Ingress watcher for namespace: ${ns}`, LogLevel.DEBUG);

      const path = `/apis/networking.k8s.io/v1/namespaces/${ns}/ingresses`;
      const listFn = async (): Promise<{ response: http.IncomingMessage; body: V1IngressList }> => {
        const res = await this.networkingV1Api.listNamespacedIngress(ns);
        return { response: res.response, body: res.body };
      };

      const informer = makeInformer<V1Ingress>(this.kc, path, listFn);
      this.attachNamespacedInformerHandlers(informer, ns, nsKey, this.ingressesCache, 'Ingress');
      this.ingressInformers.set(nsKey, informer);
      await informer.start();
    }

    this.cleanupStaleWatchers(this.ingressInformers, 'ingresses_');
  }

  /**
   * Generic method to attach handlers to a namespaced informer
   */
  private attachNamespacedInformerHandlers<T extends KubernetesObject>(
    informer: ReturnType<typeof makeInformer<T>>,
    namespace: string,
    key: string,
    cache: Map<string, T[]>,
    resourceKind: string
  ) {
    informer.on('add', (obj: any) => {
      const arr = cache.get(key) || [];
      if (!arr.find((o: any) => o.metadata?.uid === obj.metadata?.uid)) {
        arr.push(obj);
        cache.set(key, arr);
        log(`Watcher detected new ${resourceKind}: ${obj.metadata?.name || 'unknown'} in namespace ${namespace}`, LogLevel.DEBUG);

        setTimeout(() => {
          this._onResourceChanged.fire();
        }, 50);
      }
    });

    informer.on('update', (obj: any) => {
      const arr = cache.get(key) || [];
      const idx = arr.findIndex((o: any) => o.metadata?.uid === obj.metadata?.uid);
      if (idx >= 0) {
        arr[idx] = obj;
      } else {
        arr.push(obj);
      }
      cache.set(key, arr);
      log(`Watcher detected update to ${resourceKind}: ${obj.metadata?.name || 'unknown'} in namespace ${namespace}`, LogLevel.DEBUG);

      this.debouncedFireResourceChanged();
    });

    informer.on('delete', (obj: any) => {
      let arr = cache.get(key) || [];
      arr = arr.filter((o: any) => o.metadata?.uid !== obj.metadata?.uid);
      cache.set(key, arr);
      log(`Watcher detected deletion of ${resourceKind}: ${obj.metadata?.name || 'unknown'} in namespace ${namespace}`, LogLevel.DEBUG);

      this.debouncedFireResourceChanged();
    });

    informer.on('error', (err: any) => {
      log(`${resourceKind} watcher error for ${namespace}: ${err}`, LogLevel.ERROR);
      setTimeout(() => {
        informer.start().catch((startErr: any) => {
          log(`Failed to restart ${resourceKind} watcher for ${namespace}: ${startErr}`, LogLevel.ERROR);
        });
      }, 5000);
    });
  }

  /**
   * Helper to cleanup stale watchers that are no longer in EDA namespaces
   */
  private cleanupStaleWatchers(informers: Map<string, any>, prefix: string): void {
    for (const [infKey, infVal] of informers.entries()) {
      if (infKey.startsWith(prefix)) {
        const nsPart = infKey.substring(prefix.length);
        if (!this.edaNamespaces.includes(nsPart)) {
          log(`Stopping stale watcher for namespace: ${nsPart}`, LogLevel.DEBUG);
          try {
            infVal.stop();
          } catch (err) {
            log(`Error stopping informer for ${infKey}: ${err}`, LogLevel.ERROR);
          }
          informers.delete(infKey);
        }
      }
    }
  }

  /**
   * Re-fetch EDA namespaces via edactlClient, then create watchers for only those namespaces
   */
  private async refreshEdaNamespaces() {
    if (!this.edactlClient) {
      return;
    }
    try {
      const ns = await this.edactlClient.getEdaNamespaces();
      this.edaNamespaces = ns || [];
      log(`Refreshed EDA namespaces: ${this.edaNamespaces.join(', ')}`, LogLevel.INFO);

      await this.setupPodWatchers();
      await this.setupServiceWatchers();
      await this.setupConfigMapWatchers();
      await this.setupSecretWatchers();
      await this.setupPVCWatchers();
      await this.setupEndpointsWatchers();
      await this.setupDeploymentWatchers();
      await this.setupReplicaSetWatchers();
      await this.setupStatefulSetWatchers();
      await this.setupDaemonSetWatchers();
      await this.setupJobWatchers();
      await this.setupCronJobWatchers();
      await this.setupIngressWatchers();

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

    if (crd.spec.scope === 'Cluster') {
      const key = `${group}_${version}_${plural}`;
      if (this.resourceInformers.has(key)) {
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
      const baseKey = `${group}_${version}_${plural}`;

      for (const ns of this.edaNamespaces) {
        const nsKey = `${baseKey}_${ns}`;
        if (this.resourceInformers.has(nsKey)) {
          continue;
        }
        log(`Starting namespaced resource watcher for CRD: ${baseKey} in namespace: ${ns}`, LogLevel.DEBUG);

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

      for (const [infKey, infVal] of this.resourceInformers.entries()) {
        if (infKey.startsWith(`${baseKey}_`)) {
          const parts = infKey.split('_');
          const nsPart = parts[3];
          if (!this.edaNamespaces.includes(nsPart)) {
            log(`Stopping stale watcher for CRD: ${baseKey} in old namespace: ${nsPart}`, LogLevel.DEBUG);
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
        log(`Watcher detected new ${crd.spec?.names?.kind || 'resource'}: ${resourceName}`, LogLevel.DEBUG);
        if (crd.spec?.names?.kind === 'Deviation') {
          this._onDeviationChanged.fire();
        }
        if (crd.spec?.names?.kind === 'TransactionResult') {
          this._onTransactionChanged.fire();
        }
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
        arr.push(obj);
      }
      this.resourceCache.set(key, arr);
      const resourceName = obj.metadata?.name || 'unknown';
      log(`Watcher detected update to ${crd.spec?.names?.kind || 'resource'}: ${resourceName}`, LogLevel.DEBUG);
      if (crd.spec?.names?.kind === 'Deviation') {
        this._onDeviationChanged.fire();
      }
      if (crd.spec?.names?.kind === 'TransactionResult') {
        this._onTransactionChanged.fire();
      }
      this.debouncedFireResourceChanged();
    });

    informer.on('delete', (obj: KubernetesObject) => {
      let arr = this.resourceCache.get(key) || [];
      arr = arr.filter((o) => o.metadata?.uid !== obj.metadata?.uid);
      this.resourceCache.set(key, arr);
      const resourceName = obj.metadata?.name || 'unknown';
      log(`Watcher detected deletion of ${crd.spec?.names?.kind || 'resource'}: ${resourceName}`, LogLevel.DEBUG);
      if (crd.spec?.names?.kind === 'Deviation') {
        this._onDeviationChanged.fire();
      }
      if (crd.spec?.names?.kind === 'TransactionResult') {
        this._onTransactionChanged.fire();
      }
      this.debouncedFireResourceChanged();
    });

    informer.on('error', (err: any) => {
      log(`Resource watcher error for ${key}: ${err}`, LogLevel.ERROR);
      setTimeout(() => {
        informer.start().catch((startErr: any) => {
          log(`Failed to restart resource watcher (${key}): ${startErr}`, LogLevel.ERROR);
        });
      }, 5000);
    });
  }

  public getCachedCrds(): V1CustomResourceDefinition[] {
    return this.crdsCache;
  }

  public getCachedNamespaces(): V1Namespace[] {
    return this.namespacesCache;
  }

  /**
   * Get cached pods, optionally filtered by namespace
   */
  public getCachedPods(namespace?: string): V1Pod[] {
    return this.getCachedResourcesFromMap<V1Pod>(this.podsCache, namespace);
  }

  /**
   * Get cached services, optionally filtered by namespace
   */
  public getCachedServices(namespace?: string): V1Service[] {
    return this.getCachedResourcesFromMap<V1Service>(this.servicesCache, namespace);
  }

  /**
   * Get cached config maps, optionally filtered by namespace
   */
  public getCachedConfigMaps(namespace?: string): V1ConfigMap[] {
    return this.getCachedResourcesFromMap<V1ConfigMap>(this.configMapsCache, namespace);
  }

  /**
   * Get cached secrets, optionally filtered by namespace
   */
  public getCachedSecrets(namespace?: string): V1Secret[] {
    return this.getCachedResourcesFromMap<V1Secret>(this.secretsCache, namespace);
  }

  /**
   * Get cached persistent volume claims, optionally filtered by namespace
   */
  public getCachedPVCs(namespace?: string): V1PersistentVolumeClaim[] {
    return this.getCachedResourcesFromMap<V1PersistentVolumeClaim>(this.pvcsCache, namespace);
  }

  /**
   * Get cached persistent volumes (cluster-scoped)
   */
  public getCachedPVs(): V1PersistentVolume[] {
    return this.pvsCache;
  }

  /**
   * Get cached endpoints, optionally filtered by namespace
   */
  public getCachedEndpoints(namespace?: string): V1Endpoints[] {
    return this.getCachedResourcesFromMap<V1Endpoints>(this.endpointsCache, namespace);
  }

  /**
   * Get cached deployments, optionally filtered by namespace
   */
  public getCachedDeployments(namespace?: string): V1Deployment[] {
    return this.getCachedResourcesFromMap<V1Deployment>(this.deploymentsCache, namespace);
  }

  /**
   * Get cached replica sets, optionally filtered by namespace
   */
  public getCachedReplicaSets(namespace?: string): V1ReplicaSet[] {
    return this.getCachedResourcesFromMap<V1ReplicaSet>(this.replicaSetsCache, namespace);
  }

  /**
   * Get cached stateful sets, optionally filtered by namespace
   */
  public getCachedStatefulSets(namespace?: string): V1StatefulSet[] {
    return this.getCachedResourcesFromMap<V1StatefulSet>(this.statefulSetsCache, namespace);
  }

  /**
   * Get cached daemon sets, optionally filtered by namespace
   */
  public getCachedDaemonSets(namespace?: string): V1DaemonSet[] {
    return this.getCachedResourcesFromMap<V1DaemonSet>(this.daemonSetsCache, namespace);
  }

  /**
   * Get cached jobs, optionally filtered by namespace
   */
  public getCachedJobs(namespace?: string): V1Job[] {
    return this.getCachedResourcesFromMap<V1Job>(this.jobsCache, namespace);
  }

  /**
   * Get cached cron jobs, optionally filtered by namespace
   */
  public getCachedCronJobs(namespace?: string): V1CronJob[] {
    return this.getCachedResourcesFromMap<V1CronJob>(this.cronJobsCache, namespace);
  }

  /**
   * Get cached ingresses, optionally filtered by namespace
   */
  public getCachedIngresses(namespace?: string): V1Ingress[] {
    return this.getCachedResourcesFromMap<V1Ingress>(this.ingressesCache, namespace);
  }

  /**
   * Generic method to get cached resources from a map, optionally filtered by namespace
   */
  private getCachedResourcesFromMap<T>(cache: Map<string, T[]>, namespace?: string): T[] {
    let results: T[] = [];

    if (namespace) {
      const key = cache.keys().next().value?.split('_')[0] + '_' + namespace;
      const items = cache.get(key);
      if (items) {
        results = [...items];
      }
    } else {
      for (const items of cache.values()) {
        results.push(...items);
      }
    }

    return results;
  }

  /**
   * Debounced method to fire resource change events
   */
  private debouncedFireResourceChanged(): void {
    if (this.resourceChangeDebounceTimer) {
      clearTimeout(this.resourceChangeDebounceTimer);
    }

    this.resourceChangesPending = true;

    this.resourceChangeDebounceTimer = setTimeout(() => {
      if (this.resourceChangesPending) {
        log(`Firing debounced resource changed event`, LogLevel.DEBUG);
        this._onResourceChanged.fire();
        this.resourceChangesPending = false;
      }
      this.resourceChangeDebounceTimer = null;
    }, 100);
  }

  public getCachedResources(group: string, version: string, plural: string, namespace?: string): KubernetesObject[] {
    let results: KubernetesObject[] = [];

    for (const [key, resources] of this.resourceCache.entries()) {
      const keyParts = key.split('_');
      const keyGroup = keyParts[0];
      const keyVersion = keyParts[1];
      const keyPlural = keyParts[2];
      const keyNamespace = keyParts.length > 3 ? keyParts[3] : undefined;

      if (keyGroup === group && keyVersion === version && keyPlural === plural) {
        if (namespace) {
          if (keyNamespace === namespace) {
            results = [...results, ...resources];
          } else {
            const filteredResources = resources.filter(r =>
              r.metadata?.namespace === namespace);
            results = [...results, ...filteredResources];
          }
        } else {
          results = [...results, ...resources];
        }
      }
    }

    log(`Found ${results.length} cached ${plural} resources in ${namespace || 'all namespaces'}`, LogLevel.DEBUG);
    return results;
  }

  public dispose(): void {
    for (const informer of this.resourceInformers.values()) {
      try {
        informer.stop();
      } catch (error) {
        log(`Error stopping informer: ${error}`, LogLevel.ERROR);
      }
    }

    this.stopAllNamespacedInformers();

    this.crdsInformer?.stop();
    this.namespacesInformer?.stop();
    this.pvInformer?.stop();

    this._onResourceChanged.dispose();
    this._onDeviationChanged.dispose();
    this._onTransactionChanged.dispose();

    this.clearAllCaches();
  }

  public async listCustomResourceDefinitions(): Promise<V1CustomResourceDefinition[]> {
    try {
      const resp = await this.apiExtensionsV1Api.listCustomResourceDefinition();
      return resp.body.items || [];
    } catch (error) {
      log(`Error listing CRDs: ${error}`, LogLevel.ERROR);
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