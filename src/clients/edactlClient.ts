// src/clients/edactlClient.ts
import { V1Pod } from '@kubernetes/client-node';
import { LogLevel, log } from '../extension';
import { KubernetesClient } from './kubernetesClient';
import { runKubectl, execInPod } from '../utils/kubectlRunner';
import { CacheService, CacheOptions } from '../services/cacheService';

/**
 * Client for interacting with the EDA toolbox and edactl commands
 * Extracted from toolboxService.ts
 */
export class EdactlClient {
  private toolboxNamespace: string = 'eda-system';
  private defaultCacheTtl: number = 60000; // 1 minute

  constructor(
    private k8sClient: KubernetesClient,
    private cacheService: CacheService
  ) {
    log('Initializing EdactlClient', LogLevel.INFO);
  }

  /**
   * Find the toolbox pod name, cached for performance
   * @returns Name of the toolbox pod
   */
  private async findToolboxPod(): Promise<string> {
    const cacheOptions: CacheOptions = {
      ttl: this.defaultCacheTtl,
      description: 'toolbox pod name',
      namespace: this.toolboxNamespace
    };

    return this.cacheService.getOrFetch<string>(
      'toolbox',
      'pod-name',
      async () => {
        log(`Looking for eda-toolbox pod in namespace '${this.toolboxNamespace}'...`, LogLevel.INFO);

        // Try multiple label selectors
        const labelSelectors = [
          'eda.nokia.com/app=eda-toolbox',
          'app=eda-toolbox',
          'app.kubernetes.io/name=eda-toolbox'
        ];

        const coreV1Api = this.k8sClient.getCoreV1Api();

        for (const selector of labelSelectors) {
          try {
            const pods = await coreV1Api.listNamespacedPod(this.toolboxNamespace, selector);

            if (pods.body.items.length > 0) {
              const podName = pods.body.items[0].metadata!.name!;
              log(`Found toolbox pod: ${podName} using selector: ${selector}`, LogLevel.INFO);
              return podName;
            }
          } catch (error) {
            log(`Error finding toolbox pod with selector ${selector}: ${error}`, LogLevel.DEBUG);
          }
        }

        // If label search fails, try name-based search
        try {
          const allPods = await coreV1Api.listNamespacedPod(this.toolboxNamespace);

          for (const pod of allPods.body.items) {
            const name = pod.metadata!.name!;
            if (name.includes('toolbox') || name.includes('eda-toolbox')) {
              log(`Found toolbox pod by name: ${name}`, LogLevel.INFO);
              return name;
            }
          }
        } catch (error) {
          log(`Error finding toolbox pod by name: ${error}`, LogLevel.ERROR);
        }

        throw new Error(`No toolbox pod found in namespace ${this.toolboxNamespace}`);
      },
      cacheOptions
    );
  }

  /**
   * Execute a command in the toolbox pod
   * @param command Command to execute
   * @param ignoreNoResources Whether to ignore "no resources found" errors
   * @returns Command output
   */
  public async executeCommand(
    command: string,
    ignoreNoResources: boolean = false
  ): Promise<string> {
    try {
      const podName = await this.findToolboxPod();
      log(`Executing in toolbox pod '${podName}': ${command}`, LogLevel.DEBUG);

      try {
        const kubectlPath = this.k8sClient.getKubectlPath();
        const commandParts = command.split(' ');

        const output = execInPod(
          kubectlPath,
          podName,
          this.toolboxNamespace,
          commandParts,
          { ignoreErrors: ignoreNoResources }
        );

        return output;
      } catch (execError: any) {
        // Handle "no resources found" special case
        if (
          ignoreNoResources &&
          (execError.stderr?.includes('no resources found') ||
           execError.stdout?.includes('no resources found'))
        ) {
          log(`No resources found for: ${command}`, LogLevel.DEBUG);
          return '';
        }

        log(`Error executing command in toolbox: ${execError}`, LogLevel.ERROR, true);

        if (execError.stdout) {
          return execError.stdout;
        }

        throw execError;
      }
    } catch (error) {
      log(`Failed to execute command in eda-toolbox: ${error}`, LogLevel.ERROR, true);
      return '';
    }
  }

  /**
   * Execute edactl command in the toolbox pod
   * @param subCommand edactl subcommand and arguments
   * @param ignoreNoResources Whether to ignore "no resources found" errors
   * @returns Command output
   */
  public async executeEdactl(
    subCommand: string,
    ignoreNoResources: boolean = false
  ): Promise<string> {
    return this.executeCommand(`edactl ${subCommand}`, ignoreNoResources);
  }

  /**
   * Get EDA namespaces
   * @returns List of EDA namespaces
   */
  public async getEdaNamespaces(): Promise<string[]> {
    const cacheOptions: CacheOptions = {
      ttl: this.defaultCacheTtl,
      description: 'EDA namespaces',
      namespace: 'global'
    };

    return this.cacheService.getOrFetch<string[]>(
      'eda',
      'namespaces',
      async () => {
        try {
          // 1) Attempt: edactl namespace
          const output = await this.executeEdactl('namespace', true);
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
          const coreV1Api = this.k8sClient.getCoreV1Api();
          const allNamespaces = await coreV1Api.listNamespace();
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
      cacheOptions
    );
  }

  /**
   * Get EDA transactions
   * @returns List of EDA transactions
   */
  public async getEdaTransactions(): Promise<any[]> {
    const cacheOptions: CacheOptions = {
      ttl: this.defaultCacheTtl,
      description: 'EDA transactions',
      namespace: 'global'
    };

    return this.cacheService.getOrFetch<any[]>(
      'eda',
      'transactions',
      async () => {
        log(`Fetching EDA transactions via 'edactl transaction'...`, LogLevel.DEBUG);
        try {
          const output = await this.executeEdactl('transaction');
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

          const transactions = [];
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
      cacheOptions
    );
  }

  /**
   * Get EDA transaction details
   * @param id Transaction ID
   * @returns Transaction details
   */
  public async getTransactionDetails(id: string): Promise<string> {
    log(`Fetching EDA transaction details for '${id}'...`, LogLevel.INFO);
    try {
      const output = await this.executeEdactl(`transaction ${id}`);
      return output || `No details available for this transaction`;
    } catch (error) {
      log(`Failed to get transaction details for ID ${id}: ${error}`, LogLevel.ERROR, true);
      return `Error retrieving transaction details for ID ${id}: ${error}`;
    }
  }

  /**
   * Reset toolbox cache
   */
  public resetCache(): void {
    this.cacheService.clear('toolbox');
    this.cacheService.clear('eda');
  }
}