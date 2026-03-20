import { log, LogLevel } from '../../extension';
import type { EdaClient, K8sResource } from '../../clients/edaClient';
import { serviceManager } from '../../services/serviceManager';

import type { AutoCompleteHint } from './types';

interface CacheEntry {
  values: string[];
  timestamp: number;
}

const CACHE_TTL_MS = 30_000;

/**
 * Fetches live cluster values based on ui-auto-completes hints.
 * Results are cached with a 30-second TTL.
 */
export class DynamicValueProvider {
  private cache = new Map<string, CacheEntry>();

  /**
   * Get completion values for a given auto-complete hint.
   */
  async getValuesForHint(hint: AutoCompleteHint, namespace?: string): Promise<string[]> {
    const cacheKey = `${hint.type}:${hint.group ?? ''}/${hint.version ?? ''}/${hint.resource ?? hint.kind ?? ''}:${namespace ?? ''}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.values;
    }

    try {
      let values: string[];
      switch (hint.type) {
        case 'gvr':
          values = await this.fetchGvrValues(hint, namespace);
          break;
        case 'label':
          values = await this.fetchLabelValues(hint, namespace);
          break;
        case 'labelselector':
          values = await this.fetchLabelSelectorValues(hint, namespace);
          break;
        default:
          values = [];
      }

      this.cache.set(cacheKey, { values, timestamp: Date.now() });
      return values;
    } catch (err) {
      log(`DynamicValueProvider: failed to fetch values for ${cacheKey}: ${err}`, LogLevel.DEBUG);
      return cached?.values ?? [];
    }
  }

  /**
   * Get values for labelselector format fields.
   * Fetches labels from the specified resource kind and formats as key=value pairs.
   */
  async getLabelSelectorValues(
    group: string,
    version: string,
    kind: string,
    namespace?: string
  ): Promise<string[]> {
    return this.getValuesForHint(
      { type: 'labelselector', group, version, kind },
      namespace
    );
  }

  /**
   * Get label selector suggestions using an existing hint as the target resource.
   * This preserves the original kind/resource information while switching the
   * fetch mode to label key=value pairs.
   */
  async getLabelSelectorValuesForHint(
    hint: AutoCompleteHint,
    namespace?: string
  ): Promise<string[]> {
    return this.getValuesForHint(
      { ...hint, type: 'labelselector' },
      namespace
    );
  }

  /** Fetch resource names for a GVR hint */
  private async fetchGvrValues(hint: AutoCompleteHint, namespace?: string): Promise<string[]> {
    if (!hint.group || !hint.version || !hint.resource) {
      return [];
    }

    const client = this.getEdaClient();
    if (!client) return [];

    // Convert resource plural to kind (best effort: capitalize + remove trailing s)
    const kind = this.pluralToKind(hint.resource);
    const resources = await client.listResources(hint.group, hint.version, kind, namespace);
    return this.extractNames(resources);
  }

  /** Fetch label keys from resources */
  private async fetchLabelValues(hint: AutoCompleteHint, namespace?: string): Promise<string[]> {
    if (!hint.group || !hint.version || !hint.kind) {
      return [];
    }

    const client = this.getEdaClient();
    if (!client) return [];

    const resources = await client.listResources(hint.group, hint.version, hint.kind, namespace);
    const labelKeys = new Set<string>();
    for (const resource of resources) {
      const labels = resource.metadata?.labels;
      if (labels) {
        for (const key of Object.keys(labels)) {
          labelKeys.add(key);
        }
      }
    }
    return Array.from(labelKeys).sort();
  }

  /** Fetch label key=value pairs from resources */
  private async fetchLabelSelectorValues(hint: AutoCompleteHint, namespace?: string): Promise<string[]> {
    if (!hint.group || !hint.version) {
      return [];
    }

    const kind = hint.kind ?? (hint.resource ? this.pluralToKind(hint.resource) : undefined);
    if (!kind) return [];

    const client = this.getEdaClient();
    if (!client) return [];

    const resources = await client.listResources(hint.group, hint.version, kind, namespace);
    const pairs = new Set<string>();
    for (const resource of resources) {
      const labels = resource.metadata?.labels;
      if (labels) {
        for (const [key, value] of Object.entries(labels)) {
          pairs.add(`${key}=${value}`);
        }
      }
    }
    return Array.from(pairs).sort();
  }

  /** Extract metadata.name from a list of resources */
  private extractNames(resources: K8sResource[]): string[] {
    const names: string[] = [];
    for (const r of resources) {
      const name = r.metadata?.name;
      if (typeof name === 'string') {
        names.push(name);
      }
    }
    return names.sort();
  }

  /** Best-effort convert plural to kind (e.g. "routers" -> "Router") */
  private pluralToKind(plural: string): string {
    const singular = plural.endsWith('s') ? plural.slice(0, -1) : plural;
    return singular.charAt(0).toUpperCase() + singular.slice(1);
  }

  private getEdaClient(): EdaClient | null {
    try {
      return serviceManager.getClient<EdaClient>('eda');
    } catch {
      return null;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}
