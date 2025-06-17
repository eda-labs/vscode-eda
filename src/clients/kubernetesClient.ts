/* global NodeJS */
import { fetch, Agent } from 'undici';
/* global AbortController, TextDecoder */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { log, LogLevel } from '../extension';

interface KubeConfigContext {
  name: string;
  context: { cluster: string; user: string };
}

interface KubeConfigCluster {
  name: string;
  cluster: {
    server: string;
    'certificate-authority-data'?: string;
    'certificate-authority'?: string;
  };
}

interface KubeConfigUser {
  name: string;
  user: {
    token?: string;
    'client-certificate-data'?: string;
    'client-key-data'?: string;
    'client-certificate'?: string;
    'client-key'?: string;
  };
}

interface KubeConfigFile {
  contexts?: KubeConfigContext[];
  clusters?: KubeConfigCluster[];
  users?: KubeConfigUser[];
  'current-context'?: string;
}

export class KubernetesClient {
  private server: string = '';
  private token: string | undefined;
  private agent: Agent | undefined;
  private currentContext: string = '';
  private contexts: string[] = [];

  // Cached resources
  private namespaceCache: any[] = [];
  private podsCache: Map<string, any[]> = new Map();
  private deploymentsCache: Map<string, any[]> = new Map();
  private servicesCache: Map<string, any[]> = new Map();
  private configmapsCache: Map<string, any[]> = new Map();
  private secretsCache: Map<string, any[]> = new Map();
  private endpointsCache: Map<string, any[]> = new Map();
  private replicationcontrollersCache: Map<string, any[]> = new Map();
  private persistentvolumeclaimsCache: Map<string, any[]> = new Map();
  private serviceaccountsCache: Map<string, any[]> = new Map();
  private eventsCache: Map<string, any[]> = new Map();
  private resourcequotasCache: Map<string, any[]> = new Map();
  private limitrangesCache: Map<string, any[]> = new Map();
  private controllerrevisionsCache: Map<string, any[]> = new Map();
  private replicasetsCache: Map<string, any[]> = new Map();
  private statefulsetsCache: Map<string, any[]> = new Map();
  private daemonsetsCache: Map<string, any[]> = new Map();
  private jobsCache: Map<string, any[]> = new Map();
  private cronjobsCache: Map<string, any[]> = new Map();
  private horizontalpodautoscalersCache: Map<string, any[]> = new Map();
  private ingressesCache: Map<string, any[]> = new Map();
  private networkpoliciesCache: Map<string, any[]> = new Map();
  private rolesCache: Map<string, any[]> = new Map();
  private rolebindingsCache: Map<string, any[]> = new Map();
  private poddisruptionbudgetsCache: Map<string, any[]> = new Map();
  private leasesCache: Map<string, any[]> = new Map();

  private nodesCache: any[] = [];
  private persistentvolumesCache: any[] = [];
  private clusterrolesCache: any[] = [];
  private clusterrolebindingsCache: any[] = [];
  private storageclassesCache: any[] = [];
  private volumeattachmentsCache: any[] = [];
  private customresourcedefinitionsCache: any[] = [];
  private apiservicesCache: any[] = [];
  private mutatingwebhookconfigurationsCache: any[] = [];
  private validatingwebhookconfigurationsCache: any[] = [];
  private certificatesigningrequestsCache: any[] = [];
  private componentstatusesCache: any[] = [];

  // Active resource watchers
  private watchControllers: AbortController[] = [];

  // Poll interval in milliseconds
  private pollInterval: number = 5000;

  // Polling timers
  private timers: NodeJS.Timeout[] = [];
  private namespaceTimers: Map<string, NodeJS.Timeout[]> = new Map();
  private activeWatchers: Map<string, AbortController> = new Map();

  private watchDefinitions = [
    // Core/v1
    { name: 'pods', group: '', version: 'v1', plural: 'pods', namespaced: true },
    { name: 'services', group: '', version: 'v1', plural: 'services', namespaced: true },
    { name: 'endpoints', group: '', version: 'v1', plural: 'endpoints', namespaced: true },
    { name: 'replicationcontrollers', group: '', version: 'v1', plural: 'replicationcontrollers', namespaced: true },
    { name: 'configmaps', group: '', version: 'v1', plural: 'configmaps', namespaced: true },
    { name: 'secrets', group: '', version: 'v1', plural: 'secrets', namespaced: true },
    { name: 'persistentvolumeclaims', group: '', version: 'v1', plural: 'persistentvolumeclaims', namespaced: true },
    { name: 'persistentvolumes', group: '', version: 'v1', plural: 'persistentvolumes', namespaced: false },
    { name: 'serviceaccounts', group: '', version: 'v1', plural: 'serviceaccounts', namespaced: true },
    { name: 'events', group: '', version: 'v1', plural: 'events', namespaced: true },
    { name: 'resourcequotas', group: '', version: 'v1', plural: 'resourcequotas', namespaced: true },
    { name: 'limitranges', group: '', version: 'v1', plural: 'limitranges', namespaced: true },
    { name: 'componentstatuses', group: '', version: 'v1', plural: 'componentstatuses', namespaced: false },
    { name: 'nodes', group: '', version: 'v1', plural: 'nodes', namespaced: false },

    // apps/v1
    { name: 'deployments', group: 'apps', version: 'v1', plural: 'deployments', namespaced: true },
    { name: 'replicasets', group: 'apps', version: 'v1', plural: 'replicasets', namespaced: true },
    { name: 'statefulsets', group: 'apps', version: 'v1', plural: 'statefulsets', namespaced: true },
    { name: 'daemonsets', group: 'apps', version: 'v1', plural: 'daemonsets', namespaced: true },
    { name: 'controllerrevisions', group: 'apps', version: 'v1', plural: 'controllerrevisions', namespaced: true },

    // batch/v1
    { name: 'jobs', group: 'batch', version: 'v1', plural: 'jobs', namespaced: true },
    { name: 'cronjobs', group: 'batch', version: 'v1', plural: 'cronjobs', namespaced: true },

    // autoscaling
    { name: 'horizontalpodautoscalers', group: 'autoscaling', version: 'v1', plural: 'horizontalpodautoscalers', namespaced: true },

    // networking.k8s.io
    { name: 'ingresses', group: 'networking.k8s.io', version: 'v1', plural: 'ingresses', namespaced: true },
    { name: 'networkpolicies', group: 'networking.k8s.io', version: 'v1', plural: 'networkpolicies', namespaced: true },

    // rbac.authorization.k8s.io
    { name: 'roles', group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'roles', namespaced: true },
    { name: 'rolebindings', group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'rolebindings', namespaced: true },
    { name: 'clusterroles', group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'clusterroles', namespaced: false },
    { name: 'clusterrolebindings', group: 'rbac.authorization.k8s.io', version: 'v1', plural: 'clusterrolebindings', namespaced: false },

    // policy/v1
    { name: 'poddisruptionbudgets', group: 'policy', version: 'v1', plural: 'poddisruptionbudgets', namespaced: true },

    // storage.k8s.io/v1
    { name: 'storageclasses', group: 'storage.k8s.io', version: 'v1', plural: 'storageclasses', namespaced: false },
    { name: 'volumeattachments', group: 'storage.k8s.io', version: 'v1', plural: 'volumeattachments', namespaced: false },

    // apiextensions.k8s.io
    { name: 'customresourcedefinitions', group: 'apiextensions.k8s.io', version: 'v1', plural: 'customresourcedefinitions', namespaced: false },

    // apiregistration.k8s.io
    { name: 'apiservices', group: 'apiregistration.k8s.io', version: 'v1', plural: 'apiservices', namespaced: false },

    // admissionregistration.k8s.io
    { name: 'mutatingwebhookconfigurations', group: 'admissionregistration.k8s.io', version: 'v1', plural: 'mutatingwebhookconfigurations', namespaced: false },
    { name: 'validatingwebhookconfigurations', group: 'admissionregistration.k8s.io', version: 'v1', plural: 'validatingwebhookconfigurations', namespaced: false },

    // certificates.k8s.io
    { name: 'certificatesigningrequests', group: 'certificates.k8s.io', version: 'v1', plural: 'certificatesigningrequests', namespaced: false },

    // coordination.k8s.io
    { name: 'leases', group: 'coordination.k8s.io', version: 'v1', plural: 'leases', namespaced: true }
  ];

  private _onResourceChanged = new vscode.EventEmitter<void>();
  readonly onResourceChanged = this._onResourceChanged.event;

  private _onDeviationChanged = new vscode.EventEmitter<void>();
  readonly onDeviationChanged = this._onDeviationChanged.event;

  private _onTransactionChanged = new vscode.EventEmitter<void>();
  readonly onTransactionChanged = this._onTransactionChanged.event;

  private _onNamespacesChanged = new vscode.EventEmitter<void>();
  readonly onNamespacesChanged = this._onNamespacesChanged.event;

  constructor() {
    const envInterval = Number(process.env.EDA_POLL_INTERVAL_MS);
    if (!Number.isNaN(envInterval) && envInterval > 0) {
      this.pollInterval = envInterval;
    }
    this.loadKubeConfig();
  }


  private loadKubeConfig(): void {
    try {
      const configPath = process.env.KUBECONFIG || path.join(os.homedir(), '.kube', 'config');
      const content = fs.readFileSync(configPath, 'utf8');
      const kc = yaml.load(content) as KubeConfigFile;
      this.currentContext = kc['current-context'] || '';
      this.contexts = (kc.contexts || []).map(c => c.name);
      const ctx = (kc.contexts || []).find(c => c.name === this.currentContext)?.context;
      const clusterName = ctx?.cluster;
      const userName = ctx?.user;
      const cluster = (kc.clusters || []).find(c => c.name === clusterName)?.cluster;
      const user = (kc.users || []).find(u => u.name === userName)?.user;
      this.server = cluster?.server || '';
      this.token = user?.token;
      const caData = cluster?.['certificate-authority-data'];
      const caPath = cluster?.['certificate-authority'];
      const certData = user?.['client-certificate-data'];
      const certPath = user?.['client-certificate'];
      const keyData = user?.['client-key-data'];
      const keyPath = user?.['client-key'];

      const connect: Record<string, string> = {};
      if (caData) {
        connect.ca = Buffer.from(caData, 'base64').toString('utf8');
      } else if (caPath && fs.existsSync(caPath)) {
        connect.ca = fs.readFileSync(caPath, 'utf8');
      }

      if (certData && keyData) {
        connect.cert = Buffer.from(certData, 'base64').toString('utf8');
        connect.key = Buffer.from(keyData, 'base64').toString('utf8');
      } else if (certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        connect.cert = fs.readFileSync(certPath, 'utf8');
        connect.key = fs.readFileSync(keyPath, 'utf8');
      }

      this.agent = Object.keys(connect).length > 0 ? new Agent({ connect }) : undefined;
    } catch (err) {
      log(`Failed to load kubeconfig: ${err}`, LogLevel.ERROR);
    }
  }

  public getCurrentContext(): string {
    return this.currentContext || 'none';
  }

  public getAvailableContexts(): string[] {
    return this.contexts;
  }

  public async switchContext(contextName: string): Promise<void> {
    if (this.contexts.includes(contextName)) {
      this.dispose();
      this.namespaceCache = [];
      for (const def of this.watchDefinitions) {
        const key = `${def.name}Cache` as keyof this;
        if (def.namespaced) {
          (this as any)[key] = new Map();
        } else {
          (this as any)[key] = [];
        }
      }
      this.currentContext = contextName;
      this.loadKubeConfig();
      await this.startWatchers();
    }
  }

  private async fetchJSON(pathname: string): Promise<any> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const url = `${this.server}${pathname}`;
    try {
      const res = await fetch(url, { headers, dispatcher: this.agent });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    } catch (err) {
      log(`Fetch failed for ${url}: ${err}`, LogLevel.ERROR);
      throw err;
    }
  }

  private startGlobalPoller(fn: () => Promise<void>): void {
    let errorCount = 0;
    let t: NodeJS.Timeout;

    const run = async () => {
      try {
        await fn();
        errorCount = 0;
      } catch (err) {
        errorCount += 1;
        log(`${err}`, LogLevel.ERROR);
        if (errorCount >= 5) {
          clearInterval(t);
          log('Stopping global poller due to repeated errors', LogLevel.ERROR);
        }
      }
    };

    // Immediately run then poll
    run();
    t = setInterval(run, this.pollInterval);
    this.timers.push(t);
  }

  private startNamespacePoller(namespace: string, fn: () => Promise<void>): void {
    let errorCount = 0;
    let t: NodeJS.Timeout;

    const run = async () => {
      try {
        await fn();
        errorCount = 0;
      } catch (err) {
        errorCount += 1;
        log(`${err}`, LogLevel.ERROR);
        if (errorCount >= 5) {
          clearInterval(t);
          log(`Stopping poller for namespace ${namespace} due to repeated errors`, LogLevel.ERROR);
        }
      }
    };

    run();
    t = setInterval(run, this.pollInterval);
    const arr = this.namespaceTimers.get(namespace) || [];
    arr.push(t);
    this.namespaceTimers.set(namespace, arr);
  }


  private async refreshNamespaces(): Promise<void> {
    const allNamespaces = await this.listNamespaces();
    const allNames = allNamespaces.map((n: any) => n.metadata?.name).filter((n: any) => !!n);
    const names = allNames;
    const namespaces = allNamespaces;
    const old = this.namespaceCache.map((n: any) => n.metadata?.name).filter((n: any) => !!n);
    this.namespaceCache = namespaces;
    for (const ns of names) {
      for (const def of this.watchDefinitions.filter(d => d.namespaced)) {
        const key = `${def.name}:${ns}`;
        if (!this.activeWatchers.has(key)) {
          this.watchApiResource(def, ns);
        }
      }
    }

    for (const key of Array.from(this.activeWatchers.keys())) {
      const parts = key.split(':');
      if (parts.length === 2) {
        const ns = parts[1];
        if (!names.includes(ns)) {
          const controller = this.activeWatchers.get(key);
          controller?.abort();
          this.activeWatchers.delete(key);
          const cacheName = `${parts[0]}Cache` as keyof this;
          const map = (this as any)[cacheName] as Map<string, any[]>;
          map?.delete(ns);
        }
      }
    }

    for (const def of this.watchDefinitions.filter(d => !d.namespaced)) {
      if (!this.activeWatchers.has(def.name)) {
        this.watchApiResource(def);
      }
    }

    if (JSON.stringify(names) !== JSON.stringify(old)) {
      this._onNamespacesChanged.fire();
      this._onResourceChanged.fire();
    }
    if (JSON.stringify(names) !== JSON.stringify(old)) {
      this._onNamespacesChanged.fire();
      this._onResourceChanged.fire();
    }
  }

  private async preloadNamespaceResources(): Promise<void> {
    const namespaces = this.namespaceCache
      .map(n => n.metadata?.name)
      .filter((n): n is string => !!n);

    for (const ns of namespaces) {
      try {
        const [pods, deployments, services] = await Promise.all([
          this.fetchJSON(`/api/v1/namespaces/${ns}/pods`).then(d => d.items || []),
          this.fetchJSON(`/apis/apps/v1/namespaces/${ns}/deployments`).then(d => d.items || []),
          this.fetchJSON(`/api/v1/namespaces/${ns}/services`).then(d => d.items || [])
        ]);
        this.podsCache.set(ns, pods);
        this.deploymentsCache.set(ns, deployments);
        this.servicesCache.set(ns, services);
      } catch (err) {
        log(`Failed to preload resources in namespace ${ns}: ${err}`, LogLevel.WARN);
      }
    }
  }


  private startNamespaceWatcher(): void {
    const controller = new AbortController();
    this.watchControllers.push(controller);

    const run = async () => {
      let resourceVersion = '';
      while (!controller.signal.aborted) {
        try {
          let url = `${this.server}/api/v1/namespaces?watch=true&allowWatchBookmarks=true`;
          if (resourceVersion) {
            url += `&resourceVersion=${resourceVersion}`;
          }

          const headers: Record<string, string> = { Accept: 'application/json' };
          if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
          }

          const res = await fetch(url, {
            headers,
            dispatcher: this.agent,
            signal: controller.signal
          });

          if (!res.ok || !res.body) {
            throw new Error(`HTTP ${res.status}`);
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
              if (!part.trim()) continue;
              try {
                const evt = JSON.parse(part);
                resourceVersion = evt.object?.metadata?.resourceVersion || resourceVersion;
                if (['ADDED', 'DELETED', 'MODIFIED'].includes(evt.type)) {
                  await this.refreshNamespaces();
                }
              } catch (err) {
                log(`Error processing namespace watch event: ${err}`, LogLevel.ERROR);
              }
            }
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            log(`Watch failed for namespaces: ${err}`, LogLevel.ERROR);
            await new Promise(res => setTimeout(res, this.pollInterval));
          }
        }
      }
    };

    void run();
  }

  private watchApiResource(def: { name: string; group: string; version: string; plural: string; namespaced: boolean }, namespace?: string): void {
    const controller = new AbortController();
    const key = namespace ? `${def.name}:${namespace}` : def.name;
    this.activeWatchers.set(key, controller);
    this.watchControllers.push(controller);

    const base = def.group ? `/apis/${def.group}/${def.version}` : `/api/${def.version}`;
    const path = namespace ? `${base}/namespaces/${namespace}/${def.plural}` : `${base}/${def.plural}`;

    const run = async () => {
      let resourceVersion = '';
      while (!controller.signal.aborted) {
        try {
          let url = `${this.server}${path}?watch=true&allowWatchBookmarks=true`;
          if (resourceVersion) {
            url += `&resourceVersion=${resourceVersion}`;
          }

          const headers: Record<string, string> = { Accept: 'application/json' };
          if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
          }

          const res = await fetch(url, {
            headers,
            dispatcher: this.agent,
            signal: controller.signal
          });

          if (!res.ok || !res.body) {
            throw new Error(`HTTP ${res.status}`);
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
              if (!part.trim()) continue;
              try {
                const evt = JSON.parse(part);
                resourceVersion = evt.object?.metadata?.resourceVersion || resourceVersion;
                const obj = evt.object;
                const cacheName = `${def.name}Cache` as keyof this;
                if (def.namespaced) {
                  const map = (this as any)[cacheName] as Map<string, any[]>;
                  const arr = map.get(namespace!) || [];
                  if (evt.type === 'DELETED') {
                    map.set(namespace!, arr.filter(r => r.metadata?.uid !== obj.metadata?.uid));
                  } else {
                    const idx = arr.findIndex(r => r.metadata?.uid === obj.metadata?.uid);
                    if (idx >= 0) arr[idx] = obj; else arr.push(obj);
                    map.set(namespace!, arr);
                  }
                } else {
                  const arr = (this as any)[cacheName] as any[];
                  if (evt.type === 'DELETED') {
                    (this as any)[cacheName] = arr.filter((r: any) => r.metadata?.uid !== obj.metadata?.uid);
                  } else {
                    const idx = arr.findIndex((r: any) => r.metadata?.uid === obj.metadata?.uid);
                    if (idx >= 0) arr[idx] = obj; else arr.push(obj);
                    (this as any)[cacheName] = arr;
                  }
                }
                this._onResourceChanged.fire();
              } catch (err) {
                log(`Error processing ${def.name} watch event: ${err}`, LogLevel.ERROR);
              }
            }
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            log(`Watch failed for ${def.name}: ${err}`, LogLevel.ERROR);
            await new Promise(res => setTimeout(res, this.pollInterval));
          }
        }
      }
    };

    void run();
  }

  public async startWatchers(): Promise<void> {
    try {
      await this.refreshNamespaces();
      this.startNamespaceWatcher();
    } catch (err) {
      log(`Failed to start watchers: ${err}`, LogLevel.ERROR);
    }
  }

  public async listNamespaces(): Promise<any[]> {
    const data = await this.fetchJSON('/api/v1/namespaces');
    return data.items || [];
  }

  public getCachedCrds(): any[] {
    return [];
  }

  public getCachedNamespaces(): any[] {
    return this.namespaceCache;
  }

  public getCachedResources(): any[] {
    return [];
  }

  public getCachedPods(ns: string): any[] {
    return this.podsCache.get(ns) || [];
  }

  public getCachedDeployments(ns: string): any[] {
    return this.deploymentsCache.get(ns) || [];
  }

  public getCachedServices(ns: string): any[] {
    return this.servicesCache.get(ns) || [];
  }

  public getCachedConfigMaps(ns: string): any[] {
    return this.configmapsCache.get(ns) || [];
  }

  public getCachedSecrets(ns: string): any[] {
    return this.secretsCache.get(ns) || [];
  }

  public getCachedResource(type: string, ns?: string): any[] {
    const def = this.watchDefinitions.find(d => d.name === type);
    if (!def) return [];
    if (def.namespaced) {
      const map = (this as any)[`${type}Cache`] as Map<string, any[]> | undefined;
      return map?.get(ns || '') || [];
    }
    const arr = (this as any)[`${type}Cache`] as any[] | undefined;
    return arr || [];
  }

  public getWatchedResourceTypes(): string[] {
    return this.watchDefinitions.map(d => d.name);
  }

  public isNamespacedResource(type: string): boolean {
    return this.watchDefinitions.find(d => d.name === type)?.namespaced ?? true;
  }

  public dispose(): void {
    this.timers.forEach(t => clearInterval(t));
    for (const arr of this.namespaceTimers.values()) {
      arr.forEach(t => clearInterval(t));
    }
    this.namespaceTimers.clear();
    for (const c of this.watchControllers) {
      c.abort();
    }
    this.watchControllers = [];
    this._onResourceChanged.dispose();
    this._onDeviationChanged.dispose();
    this._onTransactionChanged.dispose();
    this._onNamespacesChanged.dispose();
  }
}