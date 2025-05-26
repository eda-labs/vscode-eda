import { fetch } from 'undici';
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
  cluster: { server: string; 'certificate-authority-data'?: string };
}

interface KubeConfigUser {
  name: string;
  user: { token?: string };
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
    this.loadKubeConfig();
  }

  // Placeholder for compatibility
  public setEdactlClient(_client: any): void {
    // no-op
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
      this.currentContext = contextName;
      this.loadKubeConfig();
    }
  }

  private async fetchJSON(pathname: string): Promise<any> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const url = `${this.server}${pathname}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  }

  private startGlobalPoller(fn: () => Promise<void>): void {
    // Immediately run then poll
    fn().catch(err => log(`${err}`, LogLevel.ERROR));
    const t = setInterval(() => {
      fn().catch(err => log(`${err}`, LogLevel.ERROR));
    }, 30000);
    this.timers.push(t);
  }

  private startNamespacePoller(namespace: string, fn: () => Promise<void>): void {
    fn().catch(err => log(`${err}`, LogLevel.ERROR));
    const t = setInterval(() => {
      fn().catch(err => log(`${err}`, LogLevel.ERROR));
    }, 30000);
    const arr = this.namespaceTimers.get(namespace) || [];
    arr.push(t);
    this.namespaceTimers.set(namespace, arr);
  }

  private async refreshCustomResources(): Promise<void> {
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
            this.resourceCache.set(key, res.items || []);
          } catch (err) {
            log(`Failed to refresh ${plural} in namespace ${ns}: ${err}`, LogLevel.ERROR);
          }
        }
      } else {
        const key = `${group}|${version}|${plural}|`;
        try {
          const res = await this.fetchJSON(`/apis/${group}/${version}/${plural}`);
          this.resourceCache.set(key, res.items || []);
        } catch (err) {
          log(`Failed to refresh ${plural}: ${err}`, LogLevel.ERROR);
        }
      }
    }
  }

  public async startWatchers(): Promise<void> {
    try {
      this.startGlobalPoller(async () => {
        this.crdCache = await this.listCustomResourceDefinitions();
        await this.refreshCustomResources();
      });

      this.startGlobalPoller(async () => {
        const namespaces = await this.listNamespaces();
        const names = namespaces.map((n: any) => n.metadata?.name).filter((n: any) => !!n);
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
    this._onResourceChanged.dispose();
    this._onDeviationChanged.dispose();
    this._onTransactionChanged.dispose();
  }
}
