/* global NodeJS */
import { fetch, Agent } from 'undici';
/* global AbortController, TextDecoder */
import { isDeepStrictEqual } from 'util';
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
  private crdCache: any[] = [];
  private namespaceCache: any[] = [];
  private resourceCache: Map<string, any[]> = new Map();
  private podCache: Map<string, any[]> = new Map();
  private deploymentCache: Map<string, any[]> = new Map();
  private serviceCache: Map<string, any[]> = new Map();
  private configMapCache: Map<string, any[]> = new Map();
  private secretCache: Map<string, any[]> = new Map();

  // Optional edactl client for fetching EDA namespaces
  private edactlClient: { getEdaNamespaces: () => Promise<string[]> } | undefined;

  // Active resource watchers
  private activeWatchKeys: Set<string> = new Set();
  private watchControllers: AbortController[] = [];

  // Poll interval in milliseconds
  private pollInterval: number = 5000;

  // Polling timers
  private timers: NodeJS.Timeout[] = [];
  private namespaceTimers: Map<string, NodeJS.Timeout[]> = new Map();

  private _onResourceChanged = new vscode.EventEmitter<void>();
  readonly onResourceChanged = this._onResourceChanged.event;

  private _onDeviationChanged = new vscode.EventEmitter<void>();
  readonly onDeviationChanged = this._onDeviationChanged.event;

  private _onTransactionChanged = new vscode.EventEmitter<void>();
  readonly onTransactionChanged = this._onTransactionChanged.event;

  constructor() {
    const envInterval = Number(process.env.EDA_POLL_INTERVAL_MS);
    if (!Number.isNaN(envInterval) && envInterval > 0) {
      this.pollInterval = envInterval;
    }
    this.loadKubeConfig();
  }

  // Store reference to edactl client
  public setEdactlClient(client: any): void {
    if (client && typeof client.getEdaNamespaces === 'function') {
      this.edactlClient = client;
    }
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
      this.crdCache = [];
      this.namespaceCache = [];
      this.resourceCache.clear();
      this.podCache.clear();
      this.deploymentCache.clear();
      this.serviceCache.clear();
      this.configMapCache.clear();
      this.secretCache.clear();
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

  private startResourceWatchers(): void {
    for (const crd of this.crdCache) {
      const group = crd.spec?.group || '';
      const version = crd.spec?.versions?.find((v: any) => v.served)?.name || crd.spec?.versions?.[0]?.name || 'v1';
      const plural = crd.spec?.names?.plural || '';
      const namespaced = crd.spec?.scope === 'Namespaced';
      const kind = crd.spec?.names?.kind || '';

      if (!group || !version || !plural) {
        continue;
      }

      if (namespaced) {
        for (const nsObj of this.namespaceCache) {
          const ns = nsObj.metadata?.name;
          if (!ns) continue;
          const key = `${group}|${version}|${plural}|${ns}`;
          const path = `/apis/${group}/${version}/namespaces/${ns}/${plural}`;
          this.startResourceWatcher(path, key, kind);
        }
      } else {
        const key = `${group}|${version}|${plural}|`;
        const path = `/apis/${group}/${version}/${plural}`;
        this.startResourceWatcher(path, key, kind);
      }
    }
  }

  private startResourceWatcher(
    path: string,
    key: string,
    kind: string
  ): void {
    if (this.activeWatchKeys.has(key)) {
      return;
    }
    this.activeWatchKeys.add(key);
    const controller = new AbortController();
    this.watchControllers.push(controller);

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
                const items = this.resourceCache.get(key) || [];
                const uid = evt.object?.metadata?.uid;
                if (!uid) continue;
                const idx = items.findIndex(i => i.metadata?.uid === uid);
                if (evt.type === 'DELETED') {
                  if (idx >= 0) items.splice(idx, 1);
                } else {
                  if (idx >= 0) items[idx] = evt.object;
                  else items.push(evt.object);
                }
                this.resourceCache.set(key, items);
                this._onResourceChanged.fire();
                if (kind === 'Deviation') {
                  this._onDeviationChanged.fire();
                } else if (kind === 'TransactionResult') {
                  this._onTransactionChanged.fire();
                }
              } catch (err) {
                log(`Error processing watch event for ${path}: ${err}`, LogLevel.ERROR);
              }
            }
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            log(`Watch failed for ${path}: ${err}`, LogLevel.ERROR);
            await new Promise(res => setTimeout(res, this.pollInterval));
          }
        }
      }
    };

    void run();
  }

  private async refreshCustomResources(): Promise<void> {
    let resourceChanged = false;
    let deviationChanged = false;
    let transactionChanged = false;
    for (const crd of this.crdCache) {
      const group = crd.spec?.group || '';
      const version = crd.spec?.versions?.find((v: any) => v.served)?.name || crd.spec?.versions?.[0]?.name || 'v1';
      const plural = crd.spec?.names?.plural || '';
      const namespaced = crd.spec?.scope === 'Namespaced';
      if (!group || !version || !plural) {
        continue;
      }
      if (namespaced) {
        for (const nsObj of this.namespaceCache) {
          const ns = nsObj.metadata?.name;
          if (!ns) continue;
          const key = `${group}|${version}|${plural}|${ns}`;
          try {
            const res = await this.fetchJSON(`/apis/${group}/${version}/namespaces/${ns}/${plural}`);
            const items = res.items || [];
            const prev = this.resourceCache.get(key) || [];
            if (!isDeepStrictEqual(prev, items)) {
              this.resourceCache.set(key, items);
              resourceChanged = true;
              const kind = crd.spec?.names?.kind;
              if (kind === 'Deviation') {
                deviationChanged = true;
              } else if (kind === 'TransactionResult') {
                transactionChanged = true;
              }
            }
          } catch (err) {
            log(`Failed to refresh ${plural} in namespace ${ns}: ${err}`, LogLevel.ERROR);
          }
        }
      } else {
        const key = `${group}|${version}|${plural}|`;
        try {
          const res = await this.fetchJSON(`/apis/${group}/${version}/${plural}`);
          const items = res.items || [];
          const prev = this.resourceCache.get(key) || [];
          if (!isDeepStrictEqual(prev, items)) {
            this.resourceCache.set(key, items);
            resourceChanged = true;
            const kind = crd.spec?.names?.kind;
            if (kind === 'Deviation') {
              deviationChanged = true;
            } else if (kind === 'TransactionResult') {
              transactionChanged = true;
            }
          }
        } catch (err) {
          log(`Failed to refresh ${plural}: ${err}`, LogLevel.ERROR);
        }
      }
    }
    if (resourceChanged) {
      this._onResourceChanged.fire();
    }
    if (deviationChanged) {
      this._onDeviationChanged.fire();
    }
    if (transactionChanged) {
      this._onTransactionChanged.fire();
    }
  }

  public async startWatchers(): Promise<void> {
    try {
      this.startGlobalPoller(async () => {
        this.crdCache = await this.listCustomResourceDefinitions();
        await this.refreshCustomResources();
        this.startResourceWatchers();
      });

      this.startGlobalPoller(async () => {
        const allNamespaces = await this.listNamespaces();
        const allNames = allNamespaces.map((n: any) => n.metadata?.name).filter((n: any) => !!n);
        let edaNames: string[] | undefined;
        if (this.edactlClient) {
          try {
            edaNames = await this.edactlClient.getEdaNamespaces();
          } catch (err) {
            log(`Failed to fetch EDA namespaces: ${err}`, LogLevel.WARN);
          }
        }
        const names = edaNames ? allNames.filter(n => edaNames!.includes(n)) : allNames;
        const namespaces = edaNames
          ? allNamespaces.filter(n => edaNames!.includes(n.metadata?.name))
          : allNamespaces;
        const old = this.namespaceCache.map((n: any) => n.metadata?.name).filter((n: any) => !!n);
        this.namespaceCache = namespaces;
        // start pollers for new namespaces
        for (const ns of names) {
          if (!this.namespaceTimers.has(ns)) {
            this.startNamespacePoller(ns, async () => {
              this.podCache.set(ns, await this.fetchJSON(`/api/v1/namespaces/${ns}/pods`).then(d => d.items || []));
              this.deploymentCache.set(ns, await this.fetchJSON(`/apis/apps/v1/namespaces/${ns}/deployments`).then(d => d.items || []));
              this.serviceCache.set(ns, await this.fetchJSON(`/api/v1/namespaces/${ns}/services`).then(d => d.items || []));
              this.configMapCache.set(ns, await this.fetchJSON(`/api/v1/namespaces/${ns}/configmaps`).then(d => d.items || []));
              this.secretCache.set(ns, await this.fetchJSON(`/api/v1/namespaces/${ns}/secrets`).then(d => d.items || []));
            });
          }
        }
        // cleanup removed namespaces
        for (const ns of Array.from(this.namespaceTimers.keys())) {
          if (!names.includes(ns)) {
            const timers = this.namespaceTimers.get(ns) || [];
            timers.forEach(t => clearInterval(t));
            this.namespaceTimers.delete(ns);
            this.podCache.delete(ns);
            this.deploymentCache.delete(ns);
            this.serviceCache.delete(ns);
            this.configMapCache.delete(ns);
            this.secretCache.delete(ns);
          }
        }
        if (JSON.stringify(names) !== JSON.stringify(old)) {
          this._onResourceChanged.fire();
          this.startResourceWatchers();
        }
      });
    } catch (err) {
      log(`Failed to start watchers: ${err}`, LogLevel.ERROR);
    }
  }

  public async listCustomResourceDefinitions(): Promise<any[]> {
    const data = await this.fetchJSON('/apis/apiextensions.k8s.io/v1/customresourcedefinitions');
    return data.items || [];
  }

  public async listNamespaces(): Promise<any[]> {
    const data = await this.fetchJSON('/api/v1/namespaces');
    return data.items || [];
  }

  public async listClusterCustomObject(group: string, version: string, plural: string): Promise<{ items: any[] }> {
    return this.fetchJSON(`/apis/${group}/${version}/${plural}`);
  }

  public async listNamespacedCustomObject(group: string, version: string, namespace: string, plural: string): Promise<{ items: any[] }> {
    return this.fetchJSON(`/apis/${group}/${version}/namespaces/${namespace}/${plural}`);
  }

  public getCachedCrds(): any[] {
    return this.crdCache;
  }

  public getCachedNamespaces(): any[] {
    return this.namespaceCache;
  }

  public getCachedResources(group = '', version = '', plural = '', ns = ''): any[] {
    const key = `${group}|${version}|${plural}|${ns}`;
    return this.resourceCache.get(key) || [];
  }

  public getCachedPods(ns: string): any[] {
    return this.podCache.get(ns) || [];
  }

  public getCachedDeployments(ns: string): any[] {
    return this.deploymentCache.get(ns) || [];
  }

  public getCachedServices(ns: string): any[] {
    return this.serviceCache.get(ns) || [];
  }

  public getCachedConfigMaps(ns: string): any[] {
    return this.configMapCache.get(ns) || [];
  }

  public getCachedSecrets(ns: string): any[] {
    return this.secretCache.get(ns) || [];
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
    this.activeWatchKeys.clear();
    this._onResourceChanged.dispose();
    this._onDeviationChanged.dispose();
    this._onTransactionChanged.dispose();
  }
}