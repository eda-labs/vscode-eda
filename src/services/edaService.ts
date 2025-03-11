// src/services/edaService.ts
import { V1Pod } from '@kubernetes/client-node';
import { CoreService } from './coreService';
import { KubernetesClient } from '../clients/kubernetesClient';
import { EdactlClient } from '../clients/edactlClient';
import { CacheService, CacheOptions } from './cacheService';
import { LogLevel, log } from '../extension';

/**
 * Interface for EDA alarm
 */
export interface EdaAlarm {
  "clusterSpecific": string;
  "description": string;
  "group": string;
  "jspath": string;
  "kind": string;
  "name": string;
  "namespace.name": string;
  "parentAlarm": string;
  "probableCause": string;
  "remedialAction": string;
  "resource": string;
  "severity": string;
  "sourceGroup": string;
  "sourceKind": string;
  "sourceResource": string;
  "type": string;
}

/**
 * Interface for EDA transaction
 */
export interface EdaTransaction {
  id: string;
  result: string;
  age: string;
  detail: string;
  dryRun: string;
  username: string;
  description: string;
}

/**
 * Interface for EDA deviation
 */
export interface EdaDeviation {
  apiVersion: string;
  kind: string;
  name: string;
  "namespace.name": string;
}

/**
 * Service for EDA-specific operations
 */
export class EdaService extends CoreService {
  private cacheTtl: number = 15000; // 15s
  private toolboxNamespace: string = 'eda-system';
  
  constructor(
    private k8sClient: KubernetesClient,
    private edactlClient: EdactlClient,
    private cacheService: CacheService
  ) {
    super('EDA');
  }
  
  /**
   * Get EDA namespaces
   * @returns List of EDA namespaces
   */
  public async getEdaNamespaces(): Promise<string[]> {
    return this.edactlClient.getEdaNamespaces();
  }
  
  /**
   * Get EDA alarms
   * @returns List of EDA alarms
   */
  public async getEdaAlarms(): Promise<EdaAlarm[]> {
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: 'EDA alarms',
      namespace: 'global'
    };
    
    return this.cacheService.getOrFetch<EdaAlarm[]>(
      'eda-service',
      'alarms',
      async () => {
        this.logWithPrefix(`Fetching EDA alarms via "edactl query .namespace.alarms.current-alarm -f json"...`, LogLevel.DEBUG);
        try {
          const output = await this.edactlClient.executeEdactl(
            'query .namespace.alarms.current-alarm -f json'
          );
          
          if (!output || !output.trim().length) {
            return [];
          }
          
          const alarms = JSON.parse(output) as EdaAlarm[];
          this.logWithPrefix(`Found ${alarms.length} alarms from edactl output`, LogLevel.DEBUG);
          
          return alarms;
        } catch (err) {
          this.logWithPrefix(`Failed to get EDA alarms: ${err}`, LogLevel.ERROR, true);
          return [];
        }
      },
      cacheOptions
    );
  }
  
  /**
   * Get EDA deviations
   * @returns List of EDA deviations
   */
  public async getEdaDeviations(): Promise<EdaDeviation[]> {
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: 'EDA deviations',
      namespace: 'global'
    };
    
    return this.cacheService.getOrFetch<EdaDeviation[]>(
      'eda-service',
      'deviations',
      async () => {
        this.logWithPrefix(`Fetching EDA deviations via 'edactl query .namespace.resources.cr.core_eda_nokia_com.v1.deviation -f json'...`, LogLevel.DEBUG);
        try {
          const output = await this.edactlClient.executeEdactl(
            'query .namespace.resources.cr.core_eda_nokia_com.v1.deviation -f json'
          );
          
          if (!output || !output.trim().length) {
            return [];
          }
          
          const deviations = JSON.parse(output) as EdaDeviation[];
          this.logWithPrefix(`Found ${deviations.length} deviations from edactl output`, LogLevel.DEBUG);
          
          return deviations;
        } catch (err) {
          this.logWithPrefix(`Failed to get EDA deviations: ${err}`, LogLevel.ERROR, true);
          return [];
        }
      },
      cacheOptions
    );
  }
  
  /**
   * Get EDA transactions
   * @returns List of EDA transactions
   */
  public async getEdaTransactions(): Promise<EdaTransaction[]> {
    return this.edactlClient.getEdaTransactions() as Promise<EdaTransaction[]>;
  }
  
  /**
   * Get EDA transaction details
   * @param id Transaction ID
   * @returns Transaction details
   */
  public async getEdaTransactionDetails(id: string): Promise<string> {
    return this.edactlClient.getTransactionDetails(id);
  }
  
  /**
   * Revert a transaction
   * @param commitHash Commit hash
   * @returns Command output
   */
  public async revertTransaction(commitHash: string): Promise<string> {
    this.logWithPrefix(`Reverting transaction with commit hash ${commitHash}...`, LogLevel.INFO);
    try {
      const output = await this.edactlClient.executeEdactl(`git revert ${commitHash}`);
      return output;
    } catch (error) {
      this.logWithPrefix(`Failed to revert transaction with commit hash ${commitHash}: ${error}`, LogLevel.ERROR, true);
      throw error;
    }
  }
  
  /**
   * Restore a transaction
   * @param commitHash Commit hash
   * @returns Command output
   */
  public async restoreTransaction(commitHash: string): Promise<string> {
    this.logWithPrefix(`Restoring transaction with commit hash ${commitHash}...`, LogLevel.INFO);
    try {
      const output = await this.edactlClient.executeEdactl(`git restore ${commitHash}`);
      return output;
    } catch (error) {
      this.logWithPrefix(`Failed to restore transaction with commit hash ${commitHash}: ${error}`, LogLevel.ERROR, true);
      throw error;
    }
  }
  
  /**
   * Get NPP pods for a namespace
   * @param edaNamespace EDA namespace
   * @returns List of NPP pods
   */
  public async getNppPodsForNamespace(edaNamespace: string): Promise<V1Pod[]> {
    try {
      const prefix = `eda-npp-${edaNamespace}`;
      const coreV1Api = this.k8sClient.getCoreV1Api();
      const response = await coreV1Api.listNamespacedPod({ namespace: this.toolboxNamespace });
      
      const filteredPods = response.items.filter(pod => {
        const podName = pod.metadata?.name || '';
        return podName.startsWith(prefix);
      });
      
      return filteredPods;
    } catch (error) {
      this.logWithPrefix(`Failed to get NPP pods for namespace '${edaNamespace}': ${error}`, LogLevel.ERROR, true);
      return [];
    }
  }
  
  /**
   * Get EDA resource YAML
   * @param kind Resource kind
   * @param name Resource name
   * @param namespace Namespace (optional, uses current namespace if not provided)
   * @param isEdaCrd Whether the resource is an EDA CRD
   * @returns Resource YAML
   */
  public async getEdaResourceYaml(
    kind: string,
    name: string,
    namespace?: string,
    isEdaCrd: boolean = true
  ): Promise<string> {
    const ns = namespace || this.namespace;
    
    try {
      if (isEdaCrd) {
        this.logWithPrefix(`Using edactl for EDA CRD ${kind}/${name} in namespace ${ns}`, LogLevel.INFO);
        const edaResource = kind.charAt(0).toLowerCase() + kind.slice(1);
        
        const edaOutput = await this.edactlClient.executeEdactl(
          `get ${edaResource} ${name} -n ${ns} -o yaml`,
          true
        );
        
        if (edaOutput && edaOutput.trim().length > 0) {
          return edaOutput;
        }
      }
      
      // Fallback
      this.logWithPrefix(`EDA resource not found with edactl, falling back to kubectl`, LogLevel.DEBUG);
      return '';
    } catch (error: any) {
      this.logWithPrefix(`Error getting EDA resource YAML: ${error}`, LogLevel.ERROR);
      return '';
    }
  }
  
  /**
   * Clear the transaction cache
   */
  public clearTransactionCache(): void {
    this.cacheService.remove('eda-service', 'transactions');
    this.logWithPrefix('Transaction cache cleared', LogLevel.DEBUG);
  }
  
  /**
   * Reset namespace cache
   */
  public resetNamespaceCache(): void {
    this.cacheService.clear('eda-service');
  }
}