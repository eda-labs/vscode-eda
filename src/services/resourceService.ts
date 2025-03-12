import * as vscode from 'vscode';
import { CoreService } from './coreService';
import { KubernetesClient } from '../clients/kubernetesClient';
import { log, LogLevel } from '../extension';

interface ResourceDefinition {
  name: string;        // CRD plural
  kind?: string;       // CRD kind
  namespaced?: boolean;
  apiVersion?: string; // the version part only (e.g., "v1alpha1")
  apiGroup?: string;   // the group part (e.g., "mycrd.example.com")
  plural?: string;     // CRD "plural"
}

interface ResourceResult {
  resource: ResourceDefinition;
  instances: any[];
}

/**
 * Service for fetching and managing custom resources
 */
export class ResourceService extends CoreService {
  private k8sClient: KubernetesClient;

  // We cache discovered CRDs so we don't fetch them repeatedly
  private crdsCache: ResourceDefinition[] = [];

  // We'll still cache namespaces. We allow only some
  // set if we want to limit or filter them.
  private ALLOWED_NAMESPACES = ['default', 'eda-system', 'eda', 'clab-eda-st'];
  private namespaceCache: string[] = [];

  constructor(k8sClient: KubernetesClient) {
    super();
    this.k8sClient = k8sClient;
  }

  /**
   * Run resource fetch tests (example usage)
   */
  public async runResourceFetchTests(): Promise<void> {
    try {
      const startTime = Date.now();
      log('===== Testing resource fetching =====', LogLevel.INFO);
  
      const crds = await this.getAllCrds();
      log(`Found ${crds.length} custom resource definitions`, LogLevel.INFO);
  
      const resourceInstances = await this.getAllResourceInstances();
      log(`Found resources across ${resourceInstances.length} CRD types`, LogLevel.INFO);
  
      // Log every resource instance (this may flood the output if there are many)
      let instanceCount = 0;
      for (const rr of resourceInstances) {
        log(`CRD ${rr.resource.name} has ${rr.instances.length} instance(s)`, LogLevel.INFO);
        for (const instance of rr.instances) {
          // Print each instance as a JSON string. You can adjust the verbosity or formatting as needed.
          log(JSON.stringify(instance), LogLevel.DEBUG);
          instanceCount++;
        }
      }
      log(`Total of ${instanceCount} resource instances logged.`, LogLevel.INFO);
  
      const duration = Date.now() - startTime;
      log(`===== Testing resource fetching took ${duration} ms =====`, LogLevel.INFO);
  
      vscode.window.showInformationMessage('Kubernetes resource fetch test completed. Check output panel for details.');
    } catch (error) {
      log(`Error testing resource fetching: ${error}`, LogLevel.ERROR);
      vscode.window.showErrorMessage(`Error fetching Kubernetes resources: ${error}`);
    }
  }
  

  /**
   * Get (and cache) the namespaces, filtered by ALLOWED_NAMESPACES
   */
  private async getAllNamespaces(): Promise<string[]> {
    if (this.namespaceCache.length > 0) {
      return this.namespaceCache;
    }

    try {
      // We use the generic custom objects approach for "namespaces"
      // but it's actually possible to get them from the core API.
      // Since the requirement is to keep everything generic, we can do:
      const resp = await this.k8sClient.listClusterCustomObject('', 'v1', 'namespaces');
      const allNs = (resp.items || []).map((ns: any) => ns.metadata?.name).filter(Boolean);

      // Filter to allowed
      this.namespaceCache = allNs.filter((ns: string) => this.ALLOWED_NAMESPACES.includes(ns));
      log(`Filtered to ${this.namespaceCache.length} allowed namespaces: ${this.namespaceCache.join(', ')}`, /* LogLevel.INFO */);
      return this.namespaceCache;
    } catch (error) {
      log(`Error fetching namespaces: ${error}`, /* LogLevel.INFO */);
      // Fallback to the known allowed list if we couldn't fetch
      this.namespaceCache = this.ALLOWED_NAMESPACES;
      return this.namespaceCache;
    }
  }

  /**
   * Fetch all CRDs in the cluster, skipping standard K8s groups
   */
  public async getAllCrds(): Promise<ResourceDefinition[]> {
    if (this.crdsCache.length > 0) {
      return this.crdsCache;
    }

    log('Fetching all CRDs...', /* LogLevel.INFO */);

    try {
      // 1) List CRDs via the k8sClient
      const crdItems = await this.k8sClient.listCustomResourceDefinitions();

      const results: ResourceDefinition[] = [];

      for (const crd of crdItems) {
        // skip if it's in a standard group
        const group = crd.spec.group || '';
        if (!group || group.endsWith('k8s.io')) {
          // skip standard resources
          continue;
        }

        // Many CRDs have multiple versions; pick the first served version
        const versionObj = crd.spec.versions?.find((v: any) => v.served) || crd.spec.versions?.[0];
        if (!versionObj) {
          continue;
        }

        // Construct the ResourceDefinition
        const rd: ResourceDefinition = {
          name: crd.metadata?.name || '',
          kind: crd.spec.names?.kind || '',
          namespaced: crd.spec.scope === 'Namespaced',
          apiVersion: versionObj.name, // e.g. "v1alpha1"
          apiGroup: group,            // e.g. "mycrd.example.com"
          plural: crd.spec.names?.plural || ''
        };
        results.push(rd);
      }

      this.crdsCache = results;
      log(`Found ${results.length} CRDs (excluding standard k8s.io groups)`, /* LogLevel.INFO */);
      return results;
    } catch (error) {
      log(`Error fetching CRDs: ${error}`, /* LogLevel.INFO */);
      return [];
    }
  }

  /**
   * Fetch instances of all discovered CRDs, in parallel
   */
  public async getAllResourceInstances(): Promise<ResourceResult[]> {
    log('Fetching all resource instances (from CRDs)...', /* LogLevel.INFO */);

    const crds = await this.getAllCrds();
    const namespaces = await this.getAllNamespaces();
    const results: ResourceResult[] = [];

    // Kick off parallel fetches for each CRD
    await Promise.all(
      crds.map(async (crd) => {
        try {
          let allInstances: any[] = [];

          if (crd.namespaced) {
            // For namespaced CRDs, fetch from each allowed namespace in parallel
            const nsResults = await Promise.all(
              namespaces.map(async (ns) => {
                try {
                  const resp = await this.k8sClient.listNamespacedCustomObject(
                    crd.apiGroup || '',
                    crd.apiVersion || '',
                    ns,
                    crd.plural || ''
                  );
                  return resp.items || [];
                } catch (error) {
                  log(`Skipping namespace ${ns} for CRD ${crd.name}: ${error}`, /* LogLevel.INFO */);
                  return [];
                }
              })
            );
            // Flatten
            nsResults.forEach((arr) => allInstances.push(...arr));
          } else {
            // Cluster-scoped
            try {
              const resp = await this.k8sClient.listClusterCustomObject(
                crd.apiGroup || '',
                crd.apiVersion || '',
                crd.plural || ''
              );
              allInstances = resp.items || [];
            } catch (error) {
              log(`Error fetching cluster-scoped CRD ${crd.name}: ${error}`, /* LogLevel.INFO */);
            }
          }

          results.push({ resource: crd, instances: allInstances });
        } catch (error) {
          log(`Error fetching resource instances for CRD ${crd.name}: ${error}`, /* LogLevel.INFO */);
        }
      })
    );

    let total = 0;
    for (const rr of results) {
      total += rr.instances.length;
    }
    log(`Total resource instances (across all CRDs): ${total}`, /* LogLevel.INFO */);

    return results;
  }
}
