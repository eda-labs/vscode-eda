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

  private k8sClient: KubernetesClient;

  constructor(k8sClient: KubernetesClient) {
    this.k8sClient = k8sClient;
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

  /**
   * Get EDA alarms
   * @returns List of EDA alarms
   */
  public async getEdaAlarms(): Promise<any[]> {
    log(`Fetching EDA alarms...`, LogLevel.DEBUG);
    try {
      // Add timeout handling
      const output = await Promise.race([
        this.executeEdactl('query .namespace.alarms.v1.current-alarm -f json'),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Query timed out after 20 seconds')), 20000)
        )
      ]);

      if (!output || output.trim().length === 0) {
        return [];
      }
      const alarms = JSON.parse(output);
      return alarms;
    } catch (error) {
      log(`Failed to get EDA alarms: ${error}`, LogLevel.ERROR, true);
      return []; // Return empty array instead of hanging
    }
  }

  /**
   * Get alarm details
   * @param id Alarm ID
   * @returns Alarm details
   */
  public async getAlarmDetails(id: string): Promise<string> {
    log(`Fetching EDA alarm details for '${id}'...`, LogLevel.INFO);
    try {
      const output = await this.executeEdactl(`query .namespace.alarms.v1.current-alarm[${id}]`, true);
      return output || `No details available for this alarm`;
    } catch (error) {
      log(`Failed to get alarm details for ID ${id}: ${error}`, LogLevel.ERROR, true);
      return `Error retrieving alarm details for ID ${id}: ${error}`;
    }
  }

  /**
   * Get EDA deviations
   * @returns List of EDA deviations
   */
  public async getEdaDeviations(): Promise<any[]> {
    log(`Fetching EDA deviations via 'edactl query .namespace.resources.cr.core_eda_nokia_com.v1.deviation -f json'...`, LogLevel.DEBUG);
    try {
      // Add timeout handling
      const output = await Promise.race([
        this.executeEdactl('query .namespace.resources.cr.core_eda_nokia_com.v1.deviation -f json', true),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Query timed out after 20 seconds')), 20000)
        )
      ]);

      const deviations = JSON.parse(output);
      log(`Found ${deviations.length} deviations from edactl output`, LogLevel.DEBUG);
      return deviations;
    } catch (error) {
      log(`Failed to get EDA deviations: ${error}`, LogLevel.ERROR, true);
      return [];
    }
  }

  /**
     * Attempt to retrieve the resource YAML via edactl if it's an EDA CRD.
     * If not EDA or if it fails, return '' (so caller can fallback to kubectl).
     *
     * @param kind       CRD kind, e.g. "Deviation"
     * @param name       Resource name
     * @param namespace  Namespace
     * @returns The resource YAML as a string, or '' on error
     */
  public async getEdaResourceYaml(kind: string, name: string, namespace: string): Promise<string> {
    try {
      log(`Using edactl to fetch YAML for EDA CRD: ${kind}/${name} in ns '${namespace}'`, LogLevel.INFO);

      // Construct `edactl get <lowercaseKind> <name> -n <namespace> -o yaml`
      const edaResource = kind.charAt(0).toLowerCase() + kind.slice(1); // e.g., "Deviation" -> "deviation"
      const command = `get ${edaResource} ${name} -n ${namespace} -o yaml`;

      // Reuse the "executeEdactl" method from EdactlClient
      const edaOutput = await this.executeEdactl(command, true); // ignoring "No resources found" if second arg = true

      // Check for error indicators in the output
      if (edaOutput && edaOutput.trim().length > 0) {
        // If the output contains error indicators, log and return empty to trigger fallback
        if (edaOutput.includes('NotFound') ||
            edaOutput.includes('(NotFound)') ||
            edaOutput.includes('error:') ||
            edaOutput.includes('Error:')) {

          log(`Error in edactl output for ${kind}/${name}: ${edaOutput.trim()}`, LogLevel.WARN);
          return ''; // Empty string will trigger fallback to kubectl
        }

        log(`Successfully fetched EDA resource YAML for ${kind}/${name}`, LogLevel.DEBUG);
        return edaOutput;
      }

      log(`edactl returned no output for ${kind}/${name}. Possibly resource doesn't exist.`, LogLevel.DEBUG);
      return '';
    } catch (error: any) {
      // More detailed error logging to help diagnose issues
      log(`Error getting EDA resource YAML with edactl: ${error}`, LogLevel.ERROR);
      if (error.message) {
        log(`Error message: ${error.message}`, LogLevel.ERROR);
      }
      if (error.stdout) {
        log(`Error stdout: ${error.stdout}`, LogLevel.ERROR);
      }
      if (error.stderr) {
        log(`Error stderr: ${error.stderr}`, LogLevel.ERROR);
      }
      return ''; // Empty string will trigger fallback to kubectl
    }
  }

  /**
   * Clear cached toolbox pod information
   * This should be called when Kubernetes context changes
   */
  public clearCache(): void {
    log('Clearing EdactlClient cache due to context change', LogLevel.INFO);
    this.cachedToolboxPod = null;
    this.cacheExpiry = 0;
  }
}