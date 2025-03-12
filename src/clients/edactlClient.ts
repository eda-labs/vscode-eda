import { LogLevel, log } from '../extension';
import { KubernetesClient } from './kubernetesClient';
import { execInPod } from '../utils/kubectlRunner';

/**
 * Client for interacting with the EDA toolbox and edactl commands
 * Extracted from toolboxService.ts
 */
export class EdactlClient {
  private toolboxNamespace: string = 'eda-system';
  private toolboxPodLabelSelector: string = 'eda.nokia.com/app=eda-toolbox';
  private kubectlPath: string = 'kubectl'; // Default path to kubectl
  private cachedToolboxPod: string | null = null;
  private cacheExpiry: number = 0;
  private cacheTTL: number = 60000; // 1 minute

  constructor(
  ) {
    log('Initializing EdactlClient', LogLevel.INFO);
  }

  /**
   * Find the toolbox pod name,
   * @returns Name of the toolbox pod
   */
  private async findToolboxPod(): Promise<string> {
    // Check if we have a cached pod name that's still valid
    const now = Date.now();
    if (this.cachedToolboxPod && now < this.cacheExpiry) {
      return this.cachedToolboxPod;
    }

    log(`Finding toolbox pod in namespace ${this.toolboxNamespace}...`, LogLevel.DEBUG);

    try {
      // Use the runKubectl utility instead of execInPod for this special case
      const { runKubectl } = require('../utils/kubectlRunner');

      // Direct kubectl command to get the pod name
      const podName = runKubectl(
        this.kubectlPath,
        ['get', 'pods', '-l', this.toolboxPodLabelSelector, '-o', 'jsonpath={.items[0].metadata.name}'],
        { namespace: this.toolboxNamespace, ignoreErrors: true }
      ).trim();

      if (!podName) {
        throw new Error('No toolbox pod found');
      }

      log(`Found toolbox pod: ${podName}`, LogLevel.DEBUG);

      // Cache the pod name for a period of time
      this.cachedToolboxPod = podName;
      this.cacheExpiry = now + this.cacheTTL;

      return podName;
    } catch (error) {
      log(`Error finding toolbox pod: ${error}`, LogLevel.ERROR, true);
      throw new Error(`Failed to find toolbox pod: ${error}`);
    }
  }

  /**
   * Execute a command in the toolbox pod
   * @param command Command to execute
   * @param ignoreNoResources Whether to ignore "no resources found" errors
   * @returns Command output
   */
  public async executeCommand(command: string, ignoreNoResources: boolean = false): Promise<string> {
    try {
      const podName = await this.findToolboxPod();
      log(`Executing command in toolbox pod ${podName}: ${command}`, LogLevel.DEBUG);

      // Use execInPod directly with the correct syntax
      // The problem was likely that we were using 'sh -c' which might affect how the command runs
      const output = execInPod(
        this.kubectlPath,
        podName,
        this.toolboxNamespace,
        command.split(' '), // Split the command into an array of arguments
        { ignoreErrors: ignoreNoResources }
      );

      if (ignoreNoResources && output.includes('No resources found')) {
        log('Command returned "No resources found", ignoring as requested', LogLevel.DEBUG);
        return '';
      }

      // Check if help text appears, which indicates an error
      if (output.includes('Usage:') && output.includes('Available Commands:')) {
        log(`Command execution error: received help text which indicates command failure`, LogLevel.WARN);
        throw new Error('Command returned help text instead of expected output');
      }

      return output;
    } catch (error) {
      if (ignoreNoResources && error.toString().includes('No resources found')) {
        log('Command returned "No resources found", ignoring as requested', LogLevel.DEBUG);
        return '';
      }
      log(`Error executing command in toolbox pod: ${error}`, LogLevel.ERROR, true);
      throw new Error(`Failed to execute command in toolbox pod: ${error}`);
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
    log(`Fetching EDA namespaces via 'edactl namespace'...`, LogLevel.DEBUG);
    try {
      const output = await this.executeEdactl('namespace', true);
      if (output && output.trim().length > 0) {
        const namespaces = output
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0);

        log(`Found ${namespaces.length} EDA namespaces via edactl`, LogLevel.INFO);
        return namespaces;
      }
      return [];
    } catch (error) {
      log(`Failed to get EDA namespaces: ${error}`, LogLevel.ERROR, true);
      return [];
    }
  }

  /**
   * Get EDA transactions
   * @returns List of EDA transactions
   */
  public async getEdaTransactions(): Promise<any[]> {
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
}