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
  private namespaceCache: string[] = [];
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
  private activeWatchers: Map<string, AbortController> = new Map();
  private lastChangeLogTime: Map<string, number> = new Map();

  private watchDefinitions = [
    // Core/v1
    { name: 'pods', group: '', version: 'v1', plural: 'pods', namespaced: true },
    { name: 'services', group: '', version: 'v1', plural: 'services', namespaced: true },
    { name: 'configmaps', group: '', version: 'v1', plural: 'configmaps', namespaced: true },
    { name: 'secrets', group: '', version: 'v1', plural: 'secrets', namespaced: true },
    { name: 'events', group: '', version: 'v1', plural: 'events', namespaced: true },
    { name: 'nodes', group: '', version: 'v1', plural: 'nodes', namespaced: false },

    // apps/v1
    { name: 'deployments', group: 'apps', version: 'v1', plural: 'deployments', namespaced: true }
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


  private loadKubeConfig(contextName?: string): void {
    try {
      const configPath = process.env.KUBECONFIG || path.join(os.homedir(), '.kube', 'config');
      const content = fs.readFileSync(configPath, 'utf8');
      const kc = yaml.load(content) as KubeConfigFile;
      this.contexts = (kc.contexts || []).map(c => c.name);
      this.currentContext = contextName || this.currentContext || kc['current-context'] || '';
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
      const prevNamespaces = this.namespaceCache.slice();
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
      this.loadKubeConfig(contextName);
      await this.startWatchers(prevNamespaces);
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

  private updateNamespaceWatchers(namespaces: string[]): void {
    const old = this.namespaceCache;
    this.namespaceCache = namespaces;

    for (const ns of namespaces) {
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
        if (!namespaces.includes(ns)) {
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

    if (JSON.stringify(namespaces) !== JSON.stringify(old)) {
      this._onNamespacesChanged.fire();
      log(`Firing _onResourceChanged event (listeners: ${(this._onResourceChanged as any).event ? 'YES' : 'NO'})`, LogLevel.DEBUG);
      this._onResourceChanged.fire();
      log('_onResourceChanged.fire() completed', LogLevel.DEBUG);
    }
  }

  private async preloadNamespaceResources(): Promise<void> {
    const namespaces = this.namespaceCache;

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
          let url = `${this.server}${path}?watch=true&allowWatchBookmarks=true&timeoutSeconds=0`;
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
            signal: controller.signal,
            headersTimeout: 0,
            bodyTimeout: 0
          } as any);

          if (!res.ok || !res.body) {
            throw new Error(`HTTP ${res.status}`);
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          readLoop: while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) {
              log(
                `Watch stream for ${def.name}${namespace ? `/${namespace}` : ''} ended; reconnecting`,
                LogLevel.INFO
              );
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
              if (!part.trim()) continue;
              try {
                const evt = JSON.parse(part);
                if (evt.type === 'ERROR') {
                  log(
                    `Watch stream for ${def.name}${namespace ? `/${namespace}` : ''} returned error ${evt.object?.message || ''}; reconnecting`,
                    LogLevel.INFO
                  );
                  resourceVersion = '';
                  break readLoop;
                }
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
                const origin = namespace ? `${def.name}/${namespace}` : def.name;
                const nsInfo = namespace ? ` (namespace: ${namespace})` : '';
                const objName = obj.metadata?.name ? ` ${obj.metadata?.name}` : '';
                const now = Date.now();
                const last = this.lastChangeLogTime.get(origin) || 0;
                if (now - last > 1000) {
                  log(
                    `Change detected from stream ${origin}${nsInfo}:${objName} ${evt.type}`,
                    LogLevel.DEBUG
                  );
                  this.lastChangeLogTime.set(origin, now);
                }
                log(`Firing _onResourceChanged event (listeners: ${(this._onResourceChanged as any).event ? 'YES' : 'NO'})`, LogLevel.DEBUG);
                this._onResourceChanged.fire();
                log('_onResourceChanged.fire() completed', LogLevel.DEBUG);
              } catch (err) {
                log(`Error processing ${def.name} watch event: ${err}`, LogLevel.ERROR);
              }
            }
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            const msg = `${err}`;
            if (msg.includes('terminated')) {
              log(
                `Watch stream for ${def.name}${namespace ? `/${namespace}` : ''} terminated; reconnecting`,
                LogLevel.INFO
              );
            } else {
              log(`Watch failed for ${def.name}: ${err}`, LogLevel.ERROR);
            }
            await new Promise(res => setTimeout(res, this.pollInterval));
          }
        }
      }
    };

    void run();
  }

  public async startWatchers(namespaces: string[] = this.namespaceCache): Promise<void> {
    try {
      this.updateNamespaceWatchers(namespaces);
    } catch (err) {
      log(`Failed to start watchers: ${err}`, LogLevel.ERROR);
    }
  }

  public async setWatchedNamespaces(namespaces: string[]): Promise<void> {
    this.updateNamespaceWatchers(namespaces);
  }

  public async listNamespaces(): Promise<any[]> {
    const data = await this.fetchJSON('/api/v1/namespaces');
    return data.items || [];
  }

  public getCachedCrds(): any[] {
    return [];
  }

  public getCachedNamespaces(): string[] {
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