// src/k8s/edaService.ts
import * as k8s from '@kubernetes/client-node';
import { EdaTransaction, EdaAlarm, EdaDeviation } from '../types';
import { BaseK8sService } from './baseK8sService';
import { ToolboxService } from './toolboxService';
import { LogLevel, log } from '../../extension';
import { cache } from '../../utils/cacheUtils';

export class EdaService extends BaseK8sService {
  // We no longer store local "edaNamespacesCache" or "edaTransactionsCache".
  // All caching is handled by `cache.getOrFetch(...)`.

  private toolboxService: ToolboxService;

  constructor(toolboxService: ToolboxService) {
    super();
    this.toolboxService = toolboxService;
  }

  /**
   * Get EDA namespaces - prefer edactl, fallback to label-based search. Cached.
   */
  async getEdaNamespaces(): Promise<string[]> {
    return cache.getOrFetch<string[]>(
      'eda-service',
      'namespaces',
      async () => {
        try {
          // 1) Attempt: edactl namespace
          const output = await this.toolboxService.executeCommandInToolbox('edactl namespace', true);
          if (output && output.trim().length > 0) {
            const namespaces = output
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0);
            log(`Found ${namespaces.length} EDA namespaces via edactl`, LogLevel.DEBUG);
            return namespaces;
          }

          // 2) Fallback: label-based search
          log('No output from edactl, using label-based search...', LogLevel.INFO);
          const allNamespaces = await this.k8sApi.listNamespace();
          const edaNamespaces = allNamespaces.body.items
            .filter(ns => {
              const name = ns.metadata?.name || '';
              const labels = ns.metadata?.labels || {};
              return (
                labels['eda.nokia.com/managed'] === 'true' ||
                labels['eda-managed'] === 'true' ||
                labels['app.kubernetes.io/part-of'] === 'eda' ||
                name.startsWith('eda-') ||
                name === 'eda'
              );
            })
            .map(ns => ns.metadata!.name!);

          // Add known EDA namespaces
          ['eda', 'eda-system'].forEach(known => {
            if (!edaNamespaces.includes(known)) {
              edaNamespaces.push(known);
            }
          });
          log(`Found ${edaNamespaces.length} EDA namespaces via label search`, LogLevel.INFO);
          return edaNamespaces;
        } catch (error) {
          log(`Failed to get EDA namespaces: ${error}`, LogLevel.ERROR, true);
          return [];
        }
      },
      {
        ttl: this.cacheTtl,
        description: 'EDA namespaces',
      }
    );
  }

  /**
  * Get current alarms from "edactl query .namespace.alarms.current-alarm -f json"
  */
  async getEdaAlarms(): Promise<EdaAlarm[]> {
    return cache.getOrFetch<EdaAlarm[]>(
      'eda-service',
      'alarms',
      async () => {
        log(`Fetching EDA alarms via "edactl query .namespace.alarms.current-alarm -f json"...`, LogLevel.DEBUG);
        try {
          // 1) Run the command in the toolbox:
          const output = await this.toolboxService.executeCommandInToolbox(
            'edactl query .namespace.alarms.current-alarm -f json'
          );
          if (!output || !output.trim().length) {
            return [];
          }

          // 2) Parse JSON array
          //    If the output is JSON lines, or a single JSON array, adapt accordingly.
          const alarms = JSON.parse(output) as EdaAlarm[];
          log(`Found ${alarms.length} alarms from edactl output`, LogLevel.DEBUG);

          return alarms;
        } catch (err) {
          log(`Failed to get EDA alarms: ${err}`, LogLevel.ERROR, true);
          return [];
        }
      },
      {
        ttl: this.cacheTtl,
        description: 'EDA alarms',
      }
    );
  }

  async getEdaDeviations(): Promise<EdaDeviation[]> {
    return cache.getOrFetch<EdaDeviation[]>(
      'eda-service',
      'deviations',
      async () => {
        log(`Fetching EDA deviations via 'edactl query .namespace.resources.cr.core_eda_nokia_com.v1.deviation -f json'...`, LogLevel.DEBUG);
        try {
          const output = await this.toolboxService.executeCommandInToolbox(
            'edactl query .namespace.resources.cr.core_eda_nokia_com.v1.deviation -f json'
          );
          if (!output || !output.trim().length) {
            return [];
          }
          const deviations = JSON.parse(output) as EdaDeviation[];
          log(`Found ${deviations.length} deviations from edactl output`, LogLevel.DEBUG);
          return deviations;
        } catch (err) {
          log(`Failed to get EDA deviations: ${err}`, LogLevel.ERROR, true);
          return [];
        }
      },
      {
        ttl: this.cacheTtl,
        description: 'EDA deviations',
      }
    );
  }
  

  /**
   * Get EDA transactions via edactl transaction. Cached.
   */
  async getEdaTransactions(): Promise<EdaTransaction[]> {
    return cache.getOrFetch<EdaTransaction[]>(
      'eda-service',
      'transactions',
      async () => {
        log(`Fetching EDA transactions via 'edactl transaction'...`, LogLevel.DEBUG);
        try {
          const output = await this.toolboxService.executeCommandInToolbox('edactl transaction');
          if (!output || output.trim().length === 0) {
            return [];
          }

          const lines = output.split('\n').filter(line => line.trim().length > 0);
          if (lines.length <= 1) {
            return [];
          }

          const headerRow = lines[0];
          const idPos = headerRow.indexOf('ID');
          const resultPos = headerRow.indexOf('Result');
          const agePos = headerRow.indexOf('Age');
          const detailPos = headerRow.indexOf('Detail');
          const dryRunPos = headerRow.indexOf('DryRun');
          const usernamePos = headerRow.indexOf('Username');
          const descriptionPos = headerRow.indexOf('Description');

          const transactions: EdaTransaction[] = [];
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.length < usernamePos) {
              continue;
            }
            const id = line.substring(idPos, resultPos).trim();
            const result = line.substring(resultPos, agePos).trim();
            const age = line.substring(agePos, detailPos).trim();
            const detail = line.substring(detailPos, dryRunPos).trim();
            const dryRun = line.substring(dryRunPos, usernamePos).trim();
            const username = line.substring(
              usernamePos,
              descriptionPos > 0 ? descriptionPos : line.length
            ).trim();
            const description = descriptionPos > 0 ? line.substring(descriptionPos).trim() : '';
            transactions.push({ id, result, age, detail, dryRun, username, description });
          }
          log(`Found ${transactions.length} transactions from edactl output`, LogLevel.DEBUG);
          return transactions;
        } catch (error) {
          log(`Failed to get EDA transactions: ${error}`, LogLevel.ERROR, true);
          return [];
        }
      },
      {
        ttl: this.cacheTtl,
        description: 'EDA transactions',
      }
    );
  }

  /**
   * Get EDA transaction details for a given ID
   */
  async getEdaTransactionDetails(id: string): Promise<string> {
    log(`Fetching EDA transaction details for '${id}'...`, LogLevel.INFO);
    try {
      const output = await this.toolboxService.executeCommandInToolbox(`edactl transaction ${id}`);
      return output || `No details available for this transaction`;
    } catch (error) {
      log(`Failed to get transaction details for ID ${id}: ${error}`, LogLevel.ERROR, true);
      return `Error retrieving transaction details for ID ${id}: ${error}`;
    }
  }

  /**
   * Specifically clear the transaction cache
   */
  public clearTransactionCache(): void {
    // Clear only the transactions key from the eda-service cache group
    cache.remove('eda-service', 'transactions');
    log('Transaction cache cleared', LogLevel.DEBUG);
  }

  /**
   * Revert a transaction using its commit hash
   */
  async revertTransaction(commitHash: string): Promise<string> {
    log(`Reverting transaction with commit hash ${commitHash}...`, LogLevel.INFO);
    try {
      const output = await this.toolboxService.executeCommandInToolbox(`edactl git revert ${commitHash}`);
      return output;
    } catch (error) {
      log(`Failed to revert transaction with commit hash ${commitHash}: ${error}`, LogLevel.ERROR, true);
      throw error;
    }
  }

  /**
   * Restore a transaction using its commit hash
   */
  async restoreTransaction(commitHash: string): Promise<string> {
    log(`Restoring transaction with commit hash ${commitHash}...`, LogLevel.INFO);
    try {
      const output = await this.toolboxService.executeCommandInToolbox(`edactl git restore ${commitHash}`);
      return output;
    } catch (error) {
      log(`Failed to restore transaction with commit hash ${commitHash}: ${error}`, LogLevel.ERROR, true);
      throw error;
    }
  }

  /**
   * Get NPP pods for a given EDA namespace
   */
  async getNppPodsForNamespace(edaNamespace: string): Promise<k8s.V1Pod[]> {
    try {
      const prefix = `eda-npp-${edaNamespace}`;
      log(`Fetching NPP Pods (prefix='${prefix}') in toolbox namespace '${this.toolboxNamespace}'...`, LogLevel.DEBUG);
      const response = await this.k8sApi.listNamespacedPod(this.toolboxNamespace);
      const filteredPods = response.body.items.filter(pod => {
        const podName = pod.metadata?.name || '';
        return podName.startsWith(prefix);
      });
      log(`Found ${filteredPods.length} NPP pods for namespace '${edaNamespace}'`, LogLevel.DEBUG);
      return filteredPods;
    } catch (error) {
      log(`Failed to get NPP pods for namespace '${edaNamespace}': ${error}`, LogLevel.ERROR, true);
      return [];
    }
  }

  /**
   * Try to get the resource via edactl for known EDA CRDs
   */
  async getEdaResourceYaml(
    kind: string,
    name: string,
    namespace?: string,
    isEdaCrd: boolean = true
  ): Promise<string> {
    const ns = namespace || this.namespace;
    try {
      if (isEdaCrd) {
        log(`Using edactl for EDA CRD ${kind}/${name} in namespace ${ns}`, LogLevel.INFO);
        const edaResource = kind.charAt(0).toLowerCase() + kind.slice(1);
        const edaOutput = await this.toolboxService.executeCommandInToolbox(
          `edactl get ${edaResource} ${name} -n ${ns} -o yaml`,
          true
        );
        if (edaOutput && edaOutput.trim().length > 0) {
          return edaOutput;
        }
      }
      // fallback
      log(`EDA resource not found with edactl, falling back to kubectl`, LogLevel.DEBUG);
      return '';
    } catch (error: any) {
      log(`Error getting EDA resource YAML: ${error}`, LogLevel.ERROR);
      return '';
    }
  }

  /**
   * Reset local caches (now just clearing the group in our global cache)
   */
  resetNamespaceCache() {
    // If you want to nuke the 'eda-service' group from the cache:
    cache.clear('eda-service');
  }
}
