import * as k8s from '@kubernetes/client-node';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { BaseK8sService } from './baseK8sService';
import { LogLevel, log } from '../../extension';
import { fetchResources, executeKubectl } from '../../utils/resourceUtils';
import { cache } from '../../utils/cacheUtils';

export class K8sResourcesService extends BaseK8sService {
  constructor() {
    super();
  }

  // Standard Kubernetes resource retrieval using the k8s client library
  async getPods(namespace?: string): Promise<k8s.V1Pod[]> {
    const ns = namespace || this.namespace;
    return cache.getOrFetch<k8s.V1Pod[]>(
      'pods',
      ns,
      () =>
        fetchResources<k8s.V1Pod>(
          () => this.k8sApi.listNamespacedPod(ns),
          'Pods',
          { namespace: ns }
        ),
      {
        ttl: this.cacheTtl,
        description: `pods in namespace '${ns}'`,
        namespace: ns,
      }
    );
  }

  // Using the new caching pattern for services as well
  async getServices(namespace?: string): Promise<k8s.V1Service[]> {
    const ns = namespace || this.namespace;
    return cache.getOrFetch<k8s.V1Service[]>(
      'services',
      ns,
      () =>
        fetchResources<k8s.V1Service>(
          () => this.k8sApi.listNamespacedService(ns),
          'Services',
          { namespace: ns }
        ),
      {
        ttl: this.cacheTtl,
        description: `services in namespace '${ns}'`,
        namespace: ns,
      }
    );
  }

  // Updated getDeployments using cache.getOrFetch
  async getDeployments(namespace?: string): Promise<k8s.V1Deployment[]> {
    const ns = namespace || this.namespace;
    return cache.getOrFetch<k8s.V1Deployment[]>(
      'deployments',
      ns,
      () =>
        fetchResources<k8s.V1Deployment>(
          () => this.k8sAppsApi.listNamespacedDeployment(ns),
          'Deployments',
          { namespace: ns }
        ),
      {
        ttl: this.cacheTtl,
        description: `deployments in namespace '${ns}'`,
        namespace: ns,
      }
    );
  }

  // Updated getConfigMaps using cache.getOrFetch
  async getConfigMaps(namespace?: string): Promise<k8s.V1ConfigMap[]> {
    const ns = namespace || this.namespace;
    return cache.getOrFetch<k8s.V1ConfigMap[]>(
      'configmaps',
      ns,
      () =>
        fetchResources<k8s.V1ConfigMap>(
          () => this.k8sApi.listNamespacedConfigMap(ns),
          'ConfigMaps',
          { namespace: ns }
        ),
      {
        ttl: this.cacheTtl,
        description: `configmaps in namespace '${ns}'`,
        namespace: ns,
      }
    );
  }

  // Updated getSecrets using cache.getOrFetch
  async getSecrets(namespace?: string): Promise<k8s.V1Secret[]> {
    const ns = namespace || this.namespace;
    return cache.getOrFetch<k8s.V1Secret[]>(
      'secrets',
      ns,
      () =>
        fetchResources<k8s.V1Secret>(
          () => this.k8sApi.listNamespacedSecret(ns),
          'Secrets',
          { namespace: ns }
        ),
      {
        ttl: this.cacheTtl,
        description: `secrets in namespace '${ns}'`,
        namespace: ns,
      }
    );
  }

  // Updated getNodes using cache.getOrFetch with 'cluster-wide' namespace
  async getNodes(): Promise<k8s.V1Node[]> {
    return cache.getOrFetch<k8s.V1Node[]>(
      'nodes',
      'cluster-wide',
      () =>
        fetchResources<k8s.V1Node>(
          () => this.k8sApi.listNode(),
          'Nodes',
          { namespace: 'cluster-wide' }
        ),
      {
        ttl: this.cacheTtl,
        description: 'cluster nodes',
        namespace: 'cluster-wide',
      }
    );
  }

  // Special method for getting system resources using kubectl directly
  async getSystemResources(resourceType: string): Promise<any[]> {
    log(
      `Explicitly fetching ${resourceType} from system namespace via kubectl/K8s API`,
      LogLevel.INFO
    );

    // Save current namespace
    const prevNamespace = this.namespace;

    try {
      // Set namespace to eda-system for this operation
      this.setNamespace('eda-system');

      // Use kubectl directly for eda-system resources to avoid edactl
      switch (resourceType.toLowerCase()) {
        case 'pods':
          return await this.getPods('eda-system');
        case 'deployments':
          return await this.getDeployments('eda-system');
        case 'services':
          return await this.getServices('eda-system');
        case 'configmaps':
          return await this.getConfigMaps('eda-system');
        case 'secrets':
          return await this.getSecrets('eda-system');
        default:
          log(`Unknown system resource type: ${resourceType}`, LogLevel.WARN);
          return [];
      }
    } catch (error) {
      log(
        `Error fetching system resources (${resourceType}): ${error}`,
        LogLevel.ERROR
      );
      return [];
    } finally {
      // Restore previous namespace
      this.setNamespace(prevNamespace);
    }
  }

  // Get a resource in YAML format - optimized to use kubectl directly
  async getResourceYaml(
    kind: string,
    name: string,
    namespace?: string
  ): Promise<string> {
    const ns = namespace || this.namespace;

    try {
      log(
        `Getting ${kind}/${name} in namespace ${ns} using kubectl...`,
        LogLevel.DEBUG
      );

      // Use our new helper function
      return executeKubectl(
        this.kubectlPath,
        ['get', kind.toLowerCase(), name, '-n', ns, '-o', 'yaml'],
        { encoding: 'utf-8' }
      );
    } catch (error: any) {
      log(`Error getting resource YAML: ${error}`, LogLevel.ERROR);
      return `# Error loading resource: ${error.message || error}`;
    }
  }

  // Apply a Kubernetes resource using kubectl
  async applyResource(resource: any, dryRun: boolean = false): Promise<string> {
    // Validate that the resource has the required fields
    if (
      !resource.kind ||
      !resource.apiVersion ||
      !resource.metadata ||
      !resource.metadata.name
    ) {
      throw new Error(
        'Invalid resource: missing required fields (kind, apiVersion, metadata.name)'
      );
    }

    // Determine the namespace
    const namespace = resource.metadata.namespace || this.namespace;
    const isSystemNamespace = namespace === 'eda-system';

    // For system namespace, always explicitly use kubectl
    if (isSystemNamespace) {
      log(
        `Applying system resource ${resource.kind}/${resource.metadata.name} using kubectl only`,
        LogLevel.INFO
      );
    }

    // Convert resource to YAML
    const resourceYaml = yaml.dump(resource);

    // Create a temporary file with the YAML content
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `resource-${Date.now()}.yaml`);

    try {
      // Write the resource to a temporary file
      fs.writeFileSync(tmpFile, resourceYaml);

      // Use kubectl directly for applying
      let command = `${this.kubectlPath} apply -f ${tmpFile} --namespace ${namespace}`;
      if (dryRun) {
        command += ' --dry-run=server';
      }
      command += ' -o yaml';

      log(
        `Applying ${resource.kind}/${resource.metadata.name} with kubectl...`,
        LogLevel.INFO
      );
      const output = execSync(command, { encoding: 'utf-8' });

      log(
        `Successfully ${dryRun ? 'validated' : 'applied'} ${
          resource.kind
        }/${resource.metadata.name}`,
        LogLevel.INFO
      );
      return output;
    } catch (error: any) {
      log(`Error applying resource: ${error.message}`, LogLevel.ERROR, true);
      throw error;
    } finally {
      // Clean up the temporary file
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch (cleanupError) {
        log(
          `Warning: Could not delete temporary file ${tmpFile}: ${cleanupError}`,
          LogLevel.WARN
        );
      }
    }
  }

  // Delete a pod
  public async deletePod(namespace: string, podName: string): Promise<void> {
    try {
      log(`Deleting pod '${podName}' in namespace '${namespace}'`, LogLevel.INFO);
      // Use K8s API directly for better performance
      await this.k8sApi.deleteNamespacedPod(podName, namespace);
      log(`Successfully deleted pod '${podName}'`, LogLevel.INFO);
      this.resetPodCache();
    } catch (error: any) {
      const errorMsg = `Failed to delete Pod ${podName} in namespace ${namespace}: ${
        error.body?.message || error.message || error
      }`;
      log(errorMsg, LogLevel.ERROR, true);
      throw new Error(errorMsg);
    }
  }

  /**
   * Return the textual output of "kubectl describe pod -n {ns} {podName}"
   * as a string. We do not store it in a terminal; we just return it here.
   */
  public getPodDescribeOutput(namespace: string, podName: string): string {
    try {
      const cmd = `${this.kubectlPath} describe pod -n ${namespace} ${podName}`;
      const output = execSync(cmd, { encoding: 'utf-8' });
      return output;
    } catch (err: any) {
      const msg = `Failed to describe pod ${podName} in namespace ${namespace}: ${err.message}`;
      throw new Error(msg);
    }
  }

  public async getAvailableResourceTypes(namespace: string): Promise<string[]> {
    try {
      log(`Getting available resource types in namespace ${namespace}...`, LogLevel.INFO);

      // Return a static list of common resource types instead of an expensive kubectl call
      const resourceTypes = [
        'Pods',
        'Services',
        'Deployments',
        'ConfigMaps',
        'Secrets',
      ];

      log(`Using ${resourceTypes.length} common resource types`, LogLevel.DEBUG);
      return resourceTypes;
    } catch (error) {
      log(`Error getting resource types: ${error}`, LogLevel.ERROR);
      return ['Pods', 'Services', 'Deployments', 'ConfigMaps', 'Secrets']; // Fallback
    }
  }

  // Reset pod cache using the new cache system
  resetPodCache() {
    cache.clear('pods');
  }

  // Clear all caches
  clearAllCaches() {
    cache.clear('pods');
    cache.clear('services');
    cache.clear('deployments');
    cache.clear('configMaps');
    cache.clear('secrets');
    cache.clear('nodes');
  }
}
