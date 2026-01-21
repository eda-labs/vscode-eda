/* global AbortController, TextDecoder */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { fetch, Agent } from 'undici';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

import { log, LogLevel } from '../extension';
import { sanitizeResource } from '../utils/yamlUtils';

// API group constants
const API_GROUP_CORE_EDA = 'core.eda.nokia.com';
const API_GROUP_ARTIFACTS_EDA = 'artifacts.eda.nokia.com';
const API_GROUP_APPS = 'apps';
const API_GROUP_BATCH = 'batch';
const API_GROUP_NETWORKING = 'networking.k8s.io';
const API_GROUP_STORAGE = 'storage.k8s.io';
const API_GROUP_RBAC = 'rbac.authorization.k8s.io';

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
  private artifactsCache: Map<string, any[]> = new Map();
  private engineconfigsCache: Map<string, any[]> = new Map();
  private nodeprofilesCache: Map<string, any[]> = new Map();
  private manifestsCache: Map<string, any[]> = new Map();
  private simnodesCache: Map<string, any[]> = new Map();
  private simlinksCache: Map<string, any[]> = new Map();
  private crdCache: any[] = [];


  // Active resource watchers
  private watchControllers: AbortController[] = [];

  // Poll interval in milliseconds
  private pollInterval: number = 5000;

  private activeWatchers: Map<string, AbortController> = new Map();
  private lastChangeLogTime: Map<string, number> = new Map();

  private watchDefinitions = [
    // Core/v1
    { name: 'configmaps', group: '', version: 'v1', plural: 'configmaps', namespaced: true },
    { name: 'endpoints', group: '', version: 'v1', plural: 'endpoints', namespaced: true },
    { name: 'events', group: '', version: 'v1', plural: 'events', namespaced: true },
    { name: 'persistentvolumeclaims', group: '', version: 'v1', plural: 'persistentvolumeclaims', namespaced: true },
    { name: 'pods', group: '', version: 'v1', plural: 'pods', namespaced: true },
    { name: 'secrets', group: '', version: 'v1', plural: 'secrets', namespaced: true },
    { name: 'serviceaccounts', group: '', version: 'v1', plural: 'serviceaccounts', namespaced: true },
    { name: 'services', group: '', version: 'v1', plural: 'services', namespaced: true },

    // artifacts.eda.nokia.com/v1
    { name: 'artifacts', group: API_GROUP_ARTIFACTS_EDA, version: 'v1', plural: 'artifacts', namespaced: true },

    // core.eda.nokia.com/v1
    { name: 'engineconfigs', group: API_GROUP_CORE_EDA, version: 'v1', plural: 'engineconfigs', namespaced: true },
    { name: 'nodeprofiles', group: API_GROUP_CORE_EDA, version: 'v1', plural: 'nodeprofiles', namespaced: true },
    { name: 'manifests', group: API_GROUP_CORE_EDA, version: 'v1', plural: 'manifests', namespaced: true },
    { name: 'simnodes', group: API_GROUP_CORE_EDA, version: 'v1', plural: 'simnodes', namespaced: true },
    { name: 'simlinks', group: API_GROUP_CORE_EDA, version: 'v1', plural: 'simlinks', namespaced: true },

    // apps/v1
    { name: 'deployments', group: API_GROUP_APPS, version: 'v1', plural: 'deployments', namespaced: true },
    { name: 'statefulsets', group: API_GROUP_APPS, version: 'v1', plural: 'statefulsets', namespaced: true },
    { name: 'daemonsets', group: API_GROUP_APPS, version: 'v1', plural: 'daemonsets', namespaced: true },


    // batch/v1
    { name: 'jobs', group: API_GROUP_BATCH, version: 'v1', plural: 'jobs', namespaced: true },
    { name: 'cronjobs', group: API_GROUP_BATCH, version: 'v1', plural: 'cronjobs', namespaced: true },

    // networking.k8s.io/v1
    { name: 'ingresses', group: API_GROUP_NETWORKING, version: 'v1', plural: 'ingresses', namespaced: true },

    // Cluster scoped resources
    { name: 'nodes', group: '', version: 'v1', plural: 'nodes', namespaced: false },
    { name: 'persistentvolumes', group: '', version: 'v1', plural: 'persistentvolumes', namespaced: false },
    { name: 'storageclasses', group: API_GROUP_STORAGE, version: 'v1', plural: 'storageclasses', namespaced: false },
    { name: 'clusterroles', group: API_GROUP_RBAC, version: 'v1', plural: 'clusterroles', namespaced: false },
    { name: 'clusterrolebindings', group: API_GROUP_RBAC, version: 'v1', plural: 'clusterrolebindings', namespaced: false }
  ];

  private _onResourceChanged = new vscode.EventEmitter<void>();
  readonly onResourceChanged = this._onResourceChanged.event;

  private _onDeviationChanged = new vscode.EventEmitter<void>();
  readonly onDeviationChanged = this._onDeviationChanged.event;

  private _onTransactionChanged = new vscode.EventEmitter<void>();
  readonly onTransactionChanged = this._onTransactionChanged.event;

  private _onNamespacesChanged = new vscode.EventEmitter<void>();
  readonly onNamespacesChanged = this._onNamespacesChanged.event;

  constructor(contextName?: string) {
    const envInterval = Number(process.env.EDA_POLL_INTERVAL_MS);
    if (!Number.isNaN(envInterval) && envInterval > 0) {
      this.pollInterval = envInterval;
    }
    this.loadKubeConfig(contextName);
  }

  /**
   * Get the kubeconfig file path from environment or default location
   */
  private getKubeConfigPath(): string {
    return process.env.KUBECONFIG || path.join(os.homedir(), '.kube', 'config');
  }

  /**
   * Read a credential value from base64 data or a file path
   */
  private readCredential(base64Data?: string, filePath?: string): string | undefined {
    if (base64Data) {
      return Buffer.from(base64Data, 'base64').toString('utf8');
    }
    if (filePath && fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return undefined;
  }

  /**
   * Build TLS connect options from cluster and user config
   */
  private buildConnectOptions(
    cluster: KubeConfigCluster['cluster'] | undefined,
    user: KubeConfigUser['user'] | undefined
  ): Record<string, string> {
    const connect: Record<string, string> = {};

    const ca = this.readCredential(
      cluster?.['certificate-authority-data'],
      cluster?.['certificate-authority']
    );
    if (ca) {
      connect.ca = ca;
    }

    const cert = this.readCredential(
      user?.['client-certificate-data'],
      user?.['client-certificate']
    );
    const key = this.readCredential(
      user?.['client-key-data'],
      user?.['client-key']
    );
    if (cert && key) {
      connect.cert = cert;
      connect.key = key;
    }

    return connect;
  }

  /**
   * Resolve the current context name from the provided name, existing state, or kubeconfig default
   */
  private resolveContextName(contextName: string | undefined, kc: KubeConfigFile): string {
    return contextName ?? (this.currentContext || kc['current-context'] || '');
  }

  /**
   * Extract cluster and user configuration from a kubeconfig context
   */
  private extractContextConfig(kc: KubeConfigFile): {
    cluster: KubeConfigCluster['cluster'] | undefined;
    user: KubeConfigUser['user'] | undefined;
  } {
    const ctx = (kc.contexts ?? []).find(c => c.name === this.currentContext)?.context;
    const cluster = (kc.clusters ?? []).find(c => c.name === ctx?.cluster)?.cluster;
    const user = (kc.users ?? []).find(u => u.name === ctx?.user)?.user;
    return { cluster, user };
  }

  private loadKubeConfig(contextName?: string): void {
    try {
      const content = fs.readFileSync(this.getKubeConfigPath(), 'utf8');
      const kc = yaml.load(content) as KubeConfigFile;

      this.contexts = (kc.contexts ?? []).map(c => c.name);
      this.currentContext = this.resolveContextName(contextName, kc);

      const { cluster, user } = this.extractContextConfig(kc);
      this.server = cluster?.server ?? '';
      this.token = user?.token;

      const connect = this.buildConnectOptions(cluster, user);
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

  public switchContext(contextName: string): void {
    if (!this.contexts.includes(contextName)) {
      return;
    }
    this.clearWatchers();
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
    this.startWatchers(prevNamespaces);
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

  private async requestJSON(method: string, pathname: string, body?: any): Promise<any> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (body) {
      headers['Content-Type'] = 'application/json';
    }
    const url = `${this.server}${pathname}`;
    const res = await fetch(url, {
      method,
      headers,
      dispatcher: this.agent,
      body: body ? JSON.stringify(body) : undefined
    } as any);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.status === 204 ? undefined : res.json();
  }

  private guessPlural(kind: string): string {
    const lower = kind.toLowerCase();
    if (/(s|x|z|ch|sh)$/.test(lower)) {
      return `${lower}es`;
    }
    if (/[^aeiou]y$/.test(lower)) {
      return `${lower.slice(0, -1)}ies`;
    }
    return `${lower}s`;
  }

  /**
   * Parse apiVersion into group and version components
   */
  private parseApiVersion(apiVersion: string): { group: string; version: string } {
    if (apiVersion.includes('/')) {
      const [group, version] = apiVersion.split('/');
      return { group, version };
    }
    return { group: '', version: apiVersion };
  }

  /**
   * Build the base API path for a resource
   */
  private buildApiBasePath(group: string, version: string, namespace: string | undefined, plural: string, namespaced: boolean): string {
    const base = group ? `/apis/${group}/${version}` : `/api/${version}`;
    const nsPart = namespaced ? `/namespaces/${namespace}` : '';
    return `${base}${nsPart}/${plural}`;
  }

  public async applyResource(
    resource: any,
    opts: { dryRun?: boolean; isNew?: boolean } = {}
  ): Promise<any> {
    const { dryRun = false, isNew = false } = opts;
    const { group, version } = this.parseApiVersion(resource.apiVersion ?? '');
    const namespace: string | undefined = resource.metadata?.namespace;
    const name: string | undefined = resource.metadata?.name;

    const pluralGuess = this.guessPlural(resource.kind);
    const def = this.watchDefinitions.find(
      d => d.plural === pluralGuess && d.group === group && d.version === version
    );
    const plural = def?.plural ?? pluralGuess;
    const namespaced = def?.namespaced ?? namespace !== undefined;

    const basePath = this.buildApiBasePath(group, version, namespace, plural, namespaced);
    const resourcePath = isNew ? basePath : `${basePath}/${name}`;

    const params = ['fieldValidation=Strict'];
    if (dryRun) {
      params.unshift('dryRun=All');
    }
    const url = `${resourcePath}?${params.join('&')}`;

    const method = isNew ? 'POST' : 'PUT';
    return this.requestJSON(method, url, sanitizeResource(resource));
  }


  /**
   * Start watchers for namespaced resources in newly added namespaces
   */
  private startNamespacedWatchers(namespaces: string[]): void {
    const namespacedDefs = this.watchDefinitions.filter(d => d.namespaced);
    for (const ns of namespaces) {
      for (const def of namespacedDefs) {
        const key = `${def.name}:${ns}`;
        if (!this.activeWatchers.has(key)) {
          this.watchApiResource(def, ns);
        }
      }
    }
  }

  /**
   * Stop watchers for namespaced resources in removed namespaces
   */
  private stopRemovedNamespaceWatchers(namespaces: string[]): void {
    for (const key of Array.from(this.activeWatchers.keys())) {
      const [resourceName, ns] = key.split(':');
      if (!ns || namespaces.includes(ns)) {
        continue;
      }
      this.activeWatchers.get(key)?.abort();
      this.activeWatchers.delete(key);

      const cacheName = `${resourceName}Cache` as keyof this;
      const map = (this as any)[cacheName] as Map<string, any[]> | undefined;
      map?.delete(ns);
    }
  }

  /**
   * Ensure cluster-scoped resource watchers are running
   */
  private ensureClusterScopedWatchers(): void {
    for (const def of this.watchDefinitions.filter(d => !d.namespaced)) {
      if (!this.activeWatchers.has(def.name)) {
        this.watchApiResource(def);
      }
    }
  }

  private updateNamespaceWatchers(namespaces: string[]): void {
    const old = this.namespaceCache;
    this.namespaceCache = namespaces;

    this.startNamespacedWatchers(namespaces);
    this.stopRemovedNamespaceWatchers(namespaces);
    this.ensureClusterScopedWatchers();

    if (JSON.stringify(namespaces) !== JSON.stringify(old)) {
      this._onNamespacesChanged.fire();
      this._onResourceChanged.fire();
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
                if (!obj?.metadata?.name) {
                  const snippet = JSON.stringify(obj).slice(0, 200);
                  log(
                    `Received ${def.name} event without name: ${snippet}`,
                    LogLevel.DEBUG
                  );
                }
                const cacheName = `${def.name}Cache` as keyof this;
                if (def.namespaced) {
                  const map = (this as any)[cacheName] as Map<string, any[]>;
                  const arr = map.get(namespace!) || [];
                  if (evt.type === 'DELETED') {
                    map.set(
                      namespace!,
                      arr.filter(
                        r =>
                          r.metadata?.uid !== obj.metadata?.uid &&
                          r.metadata?.name !== obj.metadata?.name
                      )
                    );
                  } else {
                    const idx = arr.findIndex(r => r.metadata?.uid === obj.metadata?.uid);
                    if (idx >= 0) arr[idx] = obj; else arr.push(obj);
                    map.set(namespace!, arr);
                  }
                } else {
                  const arr = (this as any)[cacheName] as any[];
                  if (evt.type === 'DELETED') {
                    (this as any)[cacheName] = arr.filter(
                      (r: any) =>
                        r.metadata?.uid !== obj.metadata?.uid &&
                        r.metadata?.name !== obj.metadata?.name
                    );
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
                this._onResourceChanged.fire();
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

  public startWatchers(namespaces: string[] = this.namespaceCache): void {
    try {
      this.updateNamespaceWatchers(namespaces);
    } catch (err) {
      log(`Failed to start watchers: ${err}`, LogLevel.ERROR);
    }
  }

  public setWatchedNamespaces(namespaces: string[]): void {
    this.updateNamespaceWatchers(namespaces);
  }

  public async listNamespaces(): Promise<any[]> {
    const data = await this.fetchJSON('/api/v1/namespaces');
    return data.items || [];
  }

  public async listCrds(): Promise<any[]> {
    const data = await this.fetchJSON('/apis/apiextensions.k8s.io/v1/customresourcedefinitions');
    this.crdCache = data.items || [];
    return this.crdCache;
  }

  public getCachedCrds(): any[] {
    return this.crdCache;
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

  public getCachedArtifacts(ns: string): any[] {
    return this.artifactsCache.get(ns) || [];
  }

  public getCachedEngineconfigs(ns: string): any[] {
    return this.engineconfigsCache.get(ns) || [];
  }

  public getCachedNodeprofiles(ns: string): any[] {
    return this.nodeprofilesCache.get(ns) || [];
  }

  public getCachedManifests(ns: string): any[] {
    return this.manifestsCache.get(ns) || [];
  }

  public getCachedSimnodes(ns: string): any[] {
    return this.simnodesCache.get(ns) || [];
  }

  public getCachedSimlinks(ns: string): any[] {
    return this.simlinksCache.get(ns) || [];
  }


  public async getCustomResourceYaml(
    group: string,
    version: string,
    plural: string,
    name: string,
    namespace: string
  ): Promise<string> {
    const data = await this.fetchJSON(
      `/apis/${group}/${version}/namespaces/${namespace}/${plural}/${name}`
    );
    return JSON.stringify(data, null, 2);
  }

  public async getArtifactYaml(name: string, namespace: string): Promise<string> {
    return this.getCustomResourceYaml(API_GROUP_ARTIFACTS_EDA, 'v1', 'artifacts', name, namespace);
  }

  public async getEngineconfigYaml(name: string, namespace: string): Promise<string> {
    return this.getCustomResourceYaml(API_GROUP_CORE_EDA, 'v1', 'engineconfigs', name, namespace);
  }

  public async getNodeprofileYaml(name: string, namespace: string): Promise<string> {
    return this.getCustomResourceYaml(API_GROUP_CORE_EDA, 'v1', 'nodeprofiles', name, namespace);
  }

  public async getManifestYaml(name: string, namespace: string): Promise<string> {
    return this.getCustomResourceYaml(API_GROUP_CORE_EDA, 'v1', 'manifests', name, namespace);
  }

  /**
   * Fetch any Kubernetes resource as YAML using the API
   */
  public async getResourceYaml(kind: string, name: string, namespace: string): Promise<string> {
    const pluralGuess = this.guessPlural(kind);
    const def = this.watchDefinitions.find(d => d.plural === pluralGuess || d.name === pluralGuess);
    const group = def?.group ?? '';
    const version = def?.version ?? 'v1';
    const plural = def?.plural ?? pluralGuess;
    const namespaced = def?.namespaced ?? true;
    const base = group ? `/apis/${group}/${version}` : `/api/${version}`;
    const nsPart = namespaced ? `/namespaces/${namespace}` : '';
    const data = await this.fetchJSON(`${base}${nsPart}/${plural}/${name}`);
    const sanitized = sanitizeResource(data);
    return yaml.dump(sanitized, { indent: 2 });
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

  private clearWatchers(): void {
    for (const c of this.watchControllers) {
      c.abort();
    }
    this.watchControllers = [];
    this.activeWatchers.clear();
  }

  public dispose(): void {
    this.clearWatchers();
    this._onResourceChanged.dispose();
    this._onDeviationChanged.dispose();
    this._onTransactionChanged.dispose();
    this._onNamespacesChanged.dispose();
  }
}