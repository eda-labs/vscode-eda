import { V1CustomResourceDefinition } from '@kubernetes/client-node';
import { execSync } from 'child_process';
import { BaseK8sService } from './baseK8sService';
import { CrdInfo } from '../types';
import { LogLevel, log } from '../../extension.js';
import { fetchResources, executeKubectl } from '../../utils/resourceUtils';
import { cache } from '../../utils/cacheUtils';

export class CrdService extends BaseK8sService {
  constructor() {
    super();
    // Pre-fetch all CRDs to build cache in background
    this.prefetchAllCrds();
  }

  // Pre-fetch all CRDs in background
  private async prefetchAllCrds(): Promise<void> {
    try {
      log('Pre-fetching all cluster CRDs in background...', LogLevel.DEBUG);
      this.getAllCrds().catch(err => {
        log(`Error pre-fetching CRDs: ${err}`, LogLevel.ERROR);
      });
    } catch (error) {
      log(`Error pre-fetching CRDs: ${error}`, LogLevel.ERROR);
    }
  }

  // Retrieve all CRDs at once and cache them using the new cache helper
  async getAllCrds(): Promise<V1CustomResourceDefinition[]> {
    return cache.getOrFetch<V1CustomResourceDefinition[]>(
      'allCrds',
      'cluster-wide',
      async () => {
        log(`Fetching all CRDs cluster-wide...`, LogLevel.INFO);
        const response = await this.k8sApiext.listCustomResourceDefinition();
        const items = response.items;
        log(`Found ${items.length} CRDs in the cluster`, LogLevel.INFO);
        return items;
      },
      {
        ttl: 3600000, // one hour TTL for CRDs
        description: 'CRDs cluster-wide',
        namespace: 'cluster-wide'
      }
    );
  }

  public async getCrdYamlForKind(kind: string): Promise<string> {
    // Step 1: Find the CRD name (e.g. "interfaces.interfaces.eda.nokia.com")
    const allCrds = await this.getAllCrds();
    const crdMatch = allCrds.find(c => c.spec?.names?.kind === kind);
    if (!crdMatch || !crdMatch.metadata?.name) {
      throw new Error(`Could not find a CRD whose kind = ${kind}`);
    }
    const crdName = crdMatch.metadata.name;

    // Step 2: Use our new kubectl helper to fetch the YAML
    try {
      log(`Fetching CRD YAML for ${crdName}`, LogLevel.DEBUG);
      return executeKubectl(
        this.kubectlPath,
        ['get', 'crd', crdName, '-o', 'yaml', '--show-managed-fields=false'],
        { encoding: 'utf-8' }
      );
    } catch (err: any) {
      log(`Error executing kubectl get crd: ${err}`, LogLevel.ERROR, true);
      throw new Error(`Failed to retrieve CRD for kind ${kind}: ${err.message}`);
    }
  }

  // Return all CRD groups that match "eda.nokia.com"
  async getAvailableCrdGroups(): Promise<string[]> {
    const crds = await this.getAllCrds();
    const groups = new Set<string>();
    for (const crd of crds) {
      if (crd.spec?.group?.includes('eda.nokia.com')) {
        groups.add(crd.spec.group);
      }
    }
    log(`Found ${groups.size} EDA-related CRD groups`, LogLevel.DEBUG);
    return Array.from(groups);
  }

  /**
   * Get all Custom Resource Definitions in the cluster using API
   */
  public async getCRDs(): Promise<any[]> {
    try {
      log('Getting CRDs from cluster using API...', LogLevel.INFO);
      const response = await this.k8sApiext.listCustomResourceDefinition();
      if (!response.items || !Array.isArray(response.items)) {
        log('No CRDs found in the cluster', LogLevel.WARN);
        return [];
      }
      return response.items;
    } catch (error) {
      log(`Error getting CRDs: ${error}`, LogLevel.ERROR);
      return [];
    }
  }

  // Add this at the top of CrdService class
  private crdGroupCache = new Map<string, CrdInfo[]>();

  async getCrdsForGroup(group: string, skipLogging: boolean = false): Promise<CrdInfo[]> {
    // Check cache first
    if (this.crdGroupCache.has(group)) {
      // Only log once in a while, not every call
      if (!skipLogging) {
        log(`Using cached ${this.crdGroupCache.get(group)!.length} CRDs in group '${group}'`, LogLevel.DEBUG);
      }
      return this.crdGroupCache.get(group)!;
    }

    const crds = await this.getAllCrds();
    const result = crds
      .filter(crd => crd.spec?.group === group)
      .map(crd => {
        const version = crd.spec?.versions?.find(v => v.served)?.name || 'v1';
        return {
          name: crd.metadata?.name || '',
          apiGroup: crd.spec?.group || '',
          kind: crd.spec?.names?.kind || '',
          version: version
        };
      });
    
    // Log only on cache miss
    log(`Found ${result.length} CRDs in group '${group}'`, LogLevel.DEBUG);
    
    // Store in cache
    this.crdGroupCache.set(group, result);
    return result;
  }

  // NEW: Check multiple CRDs in parallel using Promise.all
  async batchCheckCrdInstances(namespace: string, crds: CrdInfo[]): Promise<Set<string>> {
    log(`Batch checking ${crds.length} CRDs for instances in namespace ${namespace}`, LogLevel.DEBUG);
    const result = new Set<string>();

    const promises = crds.map(async (crd) => {
      const hasInstances = await this.hasCrdInstances(namespace, crd);
      if (hasInstances) {
        result.add(crd.kind);
      }
    });

    await Promise.all(promises);
    return result;
  }

  // Check if a CRD has instances in a namespace using the new cache helper
  async hasCrdInstances(namespace: string, crd: CrdInfo): Promise<boolean> {
    const cacheKey = `${namespace}|${crd.kind}|exists`;
    return cache.getOrFetch<boolean>(
      cacheKey,
      namespace,
      async () => {
        try {
          const resource = crd.name.split('.')[0]; // e.g. "fabrics"
          const response = await this.k8sCustomObjects.listNamespacedCustomObject({
            group: crd.apiGroup,
            version: crd.version,
            namespace,
            plural: resource
          });
          const items = (response.body as any).items;
          return Array.isArray(items) && items.length > 0;
        } catch (error) {
          // If error is 404, it means the resource type doesn't exist in this namespace
          return false;
        }
      },
      {
        ttl: this.cacheTtl,
        description: `existence check for ${crd.kind} in ${namespace}`,
        namespace: namespace
      }
    );
  }

  private async fetchCrdInstances(namespace: string, crd: CrdInfo): Promise<any[]> {
    try {
      log(`Fetching instances of ${crd.kind} in ${namespace} via K8s API`, LogLevel.DEBUG);
      const resource = crd.name.split('.')[0]; // e.g. "fabrics"
      const response = await this.k8sCustomObjects.listNamespacedCustomObject({
        group: crd.apiGroup,
        version: crd.version,
        namespace,
        plural: resource
      });
      const items = (response.body as any).items || [];
      log(`Found ${items.length} instances of ${crd.kind} in ${namespace}`, LogLevel.DEBUG);
      return items;
    } catch (error) {
      if ((error as any).statusCode === 404) {
        log(`No instances of ${crd.kind} found in ${namespace}`, LogLevel.DEBUG);
        return [];
      }
      log(`Error fetching instances of ${crd.kind} in ${namespace}: ${error}`, LogLevel.ERROR);
      return [];
    }
  }

  // Get CRD instances for a specific CRD type and namespace using the new cache helper.
  async getCrdInstances(namespace: string, crd: CrdInfo): Promise<any[]> {
    // Always bypass cache for system namespace
    const isSystemNamespace = namespace === 'eda-system';
    const cacheKey = `${namespace}|${crd.kind}`;
    if (isSystemNamespace) {
      log(`Getting CRD instances for ${crd.kind} in system namespace using K8s API (uncached)`, LogLevel.DEBUG);
      return this.fetchCrdInstances(namespace, crd);
    }
    return cache.getOrFetch<any[]>(
      cacheKey,
      namespace,
      () => this.fetchCrdInstances(namespace, crd),
      {
        ttl: this.cacheTtl,
        description: `instances of ${crd.kind} in ${namespace}`,
        namespace: namespace
      }
    );
  }

  // Helper to check if a resource kind is an EDA CRD
  async isEdaCrd(kind: string): Promise<boolean> {
    try {
      const crds = await this.getAllCrds();
      return crds.some(crd =>
        crd.spec?.names?.kind === kind &&
        crd.spec?.group?.includes('eda.nokia.com')
      );
    } catch (error) {
      log(`Error checking if ${kind} is an EDA CRD: ${error}`, LogLevel.ERROR);
      return false;
    }
  }

  /**
   * Get the JSON schema for a specific CRD kind
   */
  public async getCrdSchemaForKind(kind: string): Promise<any> {
    try {
      log(`Retrieving schema for CRD kind: ${kind}`, LogLevel.INFO);
      const crd = await this.getCrdDefinitionForKind(kind);
      if (!crd) {
        log(`No CRD found for kind: ${kind}`, LogLevel.WARN);
        return null;
      }
      // Look for the schema in the CRD
      let schema = null;
      // Modern v1 CRDs store schema in versions array
      if (crd.spec?.versions && crd.spec.versions.length > 0) {
        // Find the served version (or first if none marked as served)
        const version = crd.spec.versions.find(v => v.served === true) || crd.spec.versions[0];
        log(`Using CRD version: ${version.name} for kind: ${kind}`, LogLevel.DEBUG);
        // v1 CRDs have schema in version.schema.openAPIV3Schema
        if (version.schema?.openAPIV3Schema) {
          schema = version.schema.openAPIV3Schema;
          log(`Found schema in version.schema.openAPIV3Schema for kind: ${kind}`, LogLevel.DEBUG);
        }
      }
      // If we couldn't find a schema and the CRD has the older format field directly on spec
      if (!schema && (crd.spec as any).validation?.openAPIV3Schema) {
        schema = (crd.spec as any).validation.openAPIV3Schema;
        log(`Found schema in spec.validation.openAPIV3Schema for kind: ${kind}`, LogLevel.DEBUG);
      }
      if (!schema) {
        log(`No schema found in CRD for kind: ${kind}`, LogLevel.WARN);
        return null;
      }
      log(`Successfully retrieved schema for CRD kind: ${kind}`, LogLevel.INFO);
      return schema;
    } catch (error) {
      log(`Failed to get schema for kind ${kind}: ${error}`, LogLevel.ERROR);
      return null;
    }
  }

  // Retrieve the full CRD object for a given Kind
  public async getCrdDefinitionForKind(kind: string): Promise<V1CustomResourceDefinition> {
    const allCrds = await this.getAllCrds();
    const crd = allCrds.find(crd => crd.spec?.names?.kind === kind);
    if (!crd) {
      throw new Error(`No CRD found for kind: ${kind}`);
    }
    return crd;
  }

  // Clear CRD cache
  public clearCrdCache(): void {
    cache.clear('crds');
    cache.clear('crd-instances');
    cache.clear('crd-instance-exists');
  }
}
