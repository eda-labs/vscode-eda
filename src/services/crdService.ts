// src/services/crdService.ts
import * as vscode from 'vscode';
import { V1CustomResourceDefinition } from '@kubernetes/client-node';
import { CoreService } from './coreService';
import { KubernetesClient } from '../clients/kubernetesClient';
import { CacheService, CacheOptions } from './cacheService';
import { ResourceService } from './resourceService'
import { LogLevel, log } from '../extension';
import { CrdInfo } from './types';

/**
 * Service for managing Custom Resource Definitions (CRDs)
 */
export class CrdService extends CoreService {
  private cacheTtl: number = 60000; // 60s for CRDs as they change infrequently
  private edaGroups: Set<string> = new Set(['eda.nokia.com', 'core.eda.nokia.com']);

  constructor(
    private k8sClient: KubernetesClient,
    private cacheService: CacheService,
    private resourceService: ResourceService
  ) {
    super('CRD');
  }

  /**
   * Get all CRDs in the cluster
   * @returns List of CRDs
   */
  public async getAllCrds(): Promise<V1CustomResourceDefinition[]> {
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: 'All cluster CRDs',
      namespace: 'global'
    };

    return this.cacheService.getOrFetch<V1CustomResourceDefinition[]>(
      'crds',
      'all',
      async () => {
        this.logWithPrefix('Fetching all CRDs from cluster...', LogLevel.DEBUG);

        try {
          const apiExtV1 = this.k8sClient.getApiExtensionsV1Api();
          const response = await apiExtV1.listCustomResourceDefinition();
          const crds = response.items;

          this.logWithPrefix(`Found ${crds.length} CRDs in cluster`, LogLevel.DEBUG);
          return crds;
        } catch (error) {
          this.logWithPrefix(`Error fetching CRDs: ${error}`, LogLevel.ERROR);
          return [];
        }
      },
      cacheOptions
    );
  }

  /**
   * Get all available CRD groups
   * @returns List of API groups
   */
  public async getAvailableCrdGroups(): Promise<string[]> {
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: 'CRD API groups',
      namespace: 'global'
    };

    return this.cacheService.getOrFetch<string[]>(
      'crds',
      'groups',
      async () => {
        this.logWithPrefix('Fetching available CRD groups...', LogLevel.DEBUG);

        try {
          const crds = await this.getAllCrds();
          const groups = new Set<string>();

          for (const crd of crds) {
            const group = crd.spec?.group;
            if (group) {
              groups.add(group);
            }
          }

          const groupList = Array.from(groups);
          this.logWithPrefix(`Found ${groupList.length} CRD API groups`, LogLevel.DEBUG);
          return groupList;
        } catch (error) {
          this.logWithPrefix(`Error fetching CRD groups: ${error}`, LogLevel.ERROR);
          return [];
        }
      },
      cacheOptions
    );
  }

  /**
   * Get CRDs for a specific API group
   * @param group API group
   * @returns List of CRD info objects
   */
  public async getCrdsForGroup(group: string): Promise<CrdInfo[]> {
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: `CRDs for group '${group}'`,
      namespace: 'global'
    };

    return this.cacheService.getOrFetch<CrdInfo[]>(
      'crds',
      `group-${group}`,
      async () => {
        this.logWithPrefix(`Fetching CRDs for group '${group}'...`, LogLevel.DEBUG);

        try {
          const crds = await this.getAllCrds();
          const crdInfos: CrdInfo[] = [];

          for (const crd of crds) {
            if (crd.spec?.group === group) {
              const name = crd.metadata?.name || '';
              const kind = crd.spec?.names?.kind || '';
              const version = crd.spec?.versions?.[0]?.name || '';

              if (name && kind && version) {
                crdInfos.push({
                  name,
                  apiGroup: group,
                  kind,
                  version
                });
              }
            }
          }

          this.logWithPrefix(`Found ${crdInfos.length} CRDs in group '${group}'`, LogLevel.DEBUG);
          return crdInfos;
        } catch (error) {
          this.logWithPrefix(`Error fetching CRDs for group '${group}': ${error}`, LogLevel.ERROR);
          return [];
        }
      },
      cacheOptions
    );
  }

  /**
   * Check if a kind is an EDA CRD
   * @param kind Resource kind
   * @returns Whether the kind is an EDA CRD
   */
  public async isEdaCrd(kind: string): Promise<boolean> {
    try {
      const crd = await this.getCrdDefinitionForKind(kind);
      if (!crd || !crd.spec?.group) {
        return false;
      }

      return this.edaGroups.has(crd.spec.group);
    } catch (error) {
      this.logWithPrefix(`Error checking if '${kind}' is an EDA CRD: ${error}`, LogLevel.ERROR);
      return false;
    }
  }

  /**
   * Get YAML for a CRD
   * @param kind Resource kind
   * @returns CRD YAML
   */
  public async getCrdYamlForKind(kind: string): Promise<string> {
    try {
      const crd = await this.getCrdDefinitionForKind(kind);
      if (!crd) {
        return '';
      }

      return this.resourceService.getResourceYaml(
        'CustomResourceDefinition',
        crd.metadata?.name || '',
        'default'
      );
    } catch (error) {
      this.logWithPrefix(`Error getting CRD YAML for '${kind}': ${error}`, LogLevel.ERROR);
      return '';
    }
  }

  /**
   * Get all CRDs
   * @returns List of CRDs
   */
  public async getCRDs(): Promise<any[]> {
    try {
      return this.getAllCrds();
    } catch (error) {
      this.logWithPrefix(`Error getting CRDs: ${error}`, LogLevel.ERROR);
      return [];
    }
  }

  /**
   * Check if CRD instances exist in a namespace
   * @param namespace Namespace
   * @param crd CRD info
   * @returns Whether instances exist
   */
  public async hasCrdInstances(namespace: string, crd: CrdInfo): Promise<boolean> {
    try {
      const instances = await this.getCrdInstances(namespace, crd);
      return instances.length > 0;
    } catch (error) {
      this.logWithPrefix(`Error checking CRD instances: ${error}`, LogLevel.ERROR);
      return false;
    }
  }

  /**
   * Batch check for CRD instances
   * @param namespace Namespace
   * @param crds List of CRD infos
   * @returns Set of kinds that have instances
   */
  public async batchCheckCrdInstances(namespace: string, crds: CrdInfo[]): Promise<Set<string>> {
    const result = new Set<string>();

    await Promise.all(
      crds.map(async (crd) => {
        const hasInstances = await this.hasCrdInstances(namespace, crd);
        if (hasInstances) {
          result.add(crd.kind);
        }
      })
    );

    return result;
  }

  /**
   * Get instances of a CRD
   * @param namespace Namespace
   * @param crd CRD info
   * @returns List of instances
   */
  public async getCrdInstances(namespace: string, crd: CrdInfo): Promise<any[]> {
    const cacheKey = `${namespace}/${crd.kind}`;
    const cacheOptions: CacheOptions = {
      ttl: 15000, // 15s
      description: `${crd.kind} instances in ${namespace}`,
      namespace: namespace
    };

    return this.cacheService.getOrFetch<any[]>(
      'crd-instances',
      cacheKey,
      async () => {
        this.logWithPrefix(`Fetching ${crd.kind} instances in namespace '${namespace}'...`, LogLevel.DEBUG);

        try {
          // Use dynamic client to get custom resources
          const customObjectsApi = this.k8sClient.getCustomObjectsApi();

          const response = await customObjectsApi.listNamespacedCustomObject({
            group: crd.apiGroup,
            version: crd.version,
            namespace: namespace,
            plural: crd.name.split('.')[0].toLowerCase() + 's'
          });

          const instances = response.body.items || [];
          this.logWithPrefix(`Found ${instances.length} ${crd.kind} instances in '${namespace}'`, LogLevel.DEBUG);

          return instances;
        } catch (error: any) {
          // 404 means no instances found, not an error
          if (error.response && error.response.statusCode === 404) {
            return [];
          }

          this.logWithPrefix(`Error fetching ${crd.kind} instances: ${error}`, LogLevel.ERROR);
          return [];
        }
      },
      cacheOptions
    );
  }

  /**
   * Get CRD definition for a kind
   * @param kind Resource kind
   * @returns CRD definition
   */
  public async getCrdDefinitionForKind(kind: string): Promise<V1CustomResourceDefinition> {
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: `CRD definition for '${kind}'`,
      namespace: 'global'
    };

    return this.cacheService.getOrFetch<V1CustomResourceDefinition>(
      'crds',
      `kind-${kind}`,
      async () => {
        this.logWithPrefix(`Fetching CRD definition for kind '${kind}'...`, LogLevel.DEBUG);

        try {
          const crds = await this.getAllCrds();

          for (const crd of crds) {
            if (crd.spec?.names?.kind === kind) {
              return crd;
            }
          }

          throw new Error(`CRD for kind '${kind}' not found`);
        } catch (error) {
          this.logWithPrefix(`Error fetching CRD definition for '${kind}': ${error}`, LogLevel.ERROR);
          throw error;
        }
      },
      cacheOptions
    );
  }

  /**
   * Get CRD schema for a kind
   * @param kind Resource kind
   * @returns CRD schema
   */
  public async getCrdSchemaForKind(kind: string): Promise<any> {
    try {
      const crd = await this.getCrdDefinitionForKind(kind);

      if (!crd || !crd.spec?.versions || crd.spec.versions.length === 0) {
        return null;
      }

      // Find the storage version or the first version
      const version = crd.spec.versions.find(v => v.storage) || crd.spec.versions[0];

      return version?.schema?.openAPIV3Schema || null;
    } catch (error) {
      this.logWithPrefix(`Error fetching CRD schema for '${kind}': ${error}`, LogLevel.ERROR);
      return null;
    }
  }

  /**
   * Clear CRD cache
   */
  public clearCrdCache(): void {
    this.cacheService.clear('crds');
    this.cacheService.clear('crd-instances');
    this.logWithPrefix('CRD cache cleared', LogLevel.DEBUG);
  }
}