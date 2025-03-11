// src/services/resourceService.ts
import { V1Pod, V1Service, V1Deployment, V1ConfigMap, V1Secret, V1Node } from '@kubernetes/client-node';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CoreService } from './coreService';
import { EdaService } from './edaService';
import { CrdService } from './crdService';
import { KubernetesClient } from '../clients/kubernetesClient';
import { CacheService, CacheOptions } from './cacheService';
import { LogLevel, log } from '../extension';
import { runKubectl, getResourceYaml, deleteResource } from '../utils/kubectlRunner';

/**
 * Service for managing Kubernetes resources
 * Combines functionality from k8sResourcesService.ts and related services
 */
export class ResourceService extends CoreService {
  private cacheTtl: number = 15000; // 15s

  constructor(
    private k8sClient: KubernetesClient,
    private cacheService: CacheService
  ) {
    super('Resource');
  }

  /**
   * Get pods in a namespace
   * @param namespace Namespace (optional, uses current namespace if not provided)
   * @returns List of pods
   */
  public async getPods(namespace?: string): Promise<V1Pod[]> {
    const ns = namespace || this.namespace;
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: `pods in namespace '${ns}'`,
      namespace: ns
    };

    return this.cacheService.getOrFetch<V1Pod[]>(
      'pods',
      ns,
      async () => {
        this.logWithPrefix(`Fetching pods in namespace '${ns}'...`, LogLevel.DEBUG);

        try {
          const coreV1Api = this.k8sClient.getCoreV1Api();
          const response = await coreV1Api.listNamespacedPod({ namespace: ns });
          const pods = response.items;

          this.logWithPrefix(`Found ${pods.length} pods in namespace '${ns}'`, LogLevel.DEBUG);
          return pods;
        } catch (error) {
          this.logWithPrefix(`Error fetching pods in namespace '${ns}': ${error}`, LogLevel.ERROR);
          return [];
        }
      },
      cacheOptions
    );
  }

  /**
   * Get services in a namespace
   * @param namespace Namespace (optional, uses current namespace if not provided)
   * @returns List of services
   */
  public async getServices(namespace?: string): Promise<V1Service[]> {
    const ns = namespace || this.namespace;
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: `services in namespace '${ns}'`,
      namespace: ns
    };

    return this.cacheService.getOrFetch<V1Service[]>(
      'services',
      ns,
      async () => {
        this.logWithPrefix(`Fetching services in namespace '${ns}'...`, LogLevel.DEBUG);

        try {
          const coreV1Api = this.k8sClient.getCoreV1Api();
          const response = await coreV1Api.listNamespacedService({ namespace: ns });
          const services = response.items;

          this.logWithPrefix(`Found ${services.length} services in namespace '${ns}'`, LogLevel.DEBUG);
          return services;
        } catch (error) {
          this.logWithPrefix(`Error fetching services in namespace '${ns}': ${error}`, LogLevel.ERROR);
          return [];
        }
      },
      cacheOptions
    );
  }

  /**
   * Get deployments in a namespace
   * @param namespace Namespace (optional, uses current namespace if not provided)
   * @returns List of deployments
   */
  public async getDeployments(namespace?: string): Promise<V1Deployment[]> {
    const ns = namespace || this.namespace;
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: `deployments in namespace '${ns}'`,
      namespace: ns
    };

    return this.cacheService.getOrFetch<V1Deployment[]>(
      'deployments',
      ns,
      async () => {
        this.logWithPrefix(`Fetching deployments in namespace '${ns}'...`, LogLevel.DEBUG);

        try {
          const appsV1Api = this.k8sClient.getAppsV1Api();
          const response = await appsV1Api.listNamespacedDeployment({ namespace: ns });
          const deployments = response.items;

          this.logWithPrefix(`Found ${deployments.length} deployments in namespace '${ns}'`, LogLevel.DEBUG);
          return deployments;
        } catch (error) {
          this.logWithPrefix(`Error fetching deployments in namespace '${ns}': ${error}`, LogLevel.ERROR);
          return [];
        }
      },
      cacheOptions
    );
  }

  /**
   * Get config maps in a namespace
   * @param namespace Namespace (optional, uses current namespace if not provided)
   * @returns List of config maps
   */
  public async getConfigMaps(namespace?: string): Promise<V1ConfigMap[]> {
    const ns = namespace || this.namespace;
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: `config maps in namespace '${ns}'`,
      namespace: ns
    };

    return this.cacheService.getOrFetch<V1ConfigMap[]>(
      'configmaps',
      ns,
      async () => {
        this.logWithPrefix(`Fetching config maps in namespace '${ns}'...`, LogLevel.DEBUG);

        try {
          const coreV1Api = this.k8sClient.getCoreV1Api();
          const response = await coreV1Api.listNamespacedConfigMap({ namespace: ns });
          const configMaps = response.items;

          this.logWithPrefix(`Found ${configMaps.length} config maps in namespace '${ns}'`, LogLevel.DEBUG);
          return configMaps;
        } catch (error) {
          this.logWithPrefix(`Error fetching config maps in namespace '${ns}': ${error}`, LogLevel.ERROR);
          return [];
        }
      },
      cacheOptions
    );
  }

  /**
   * Get secrets in a namespace
   * @param namespace Namespace (optional, uses current namespace if not provided)
   * @returns List of secrets
   */
  public async getSecrets(namespace?: string): Promise<V1Secret[]> {
    const ns = namespace || this.namespace;
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: `secrets in namespace '${ns}'`,
      namespace: ns
    };

    return this.cacheService.getOrFetch<V1Secret[]>(
      'secrets',
      ns,
      async () => {
        this.logWithPrefix(`Fetching secrets in namespace '${ns}'...`, LogLevel.DEBUG);

        try {
          const coreV1Api = this.k8sClient.getCoreV1Api();
          const response = await coreV1Api.listNamespacedSecret({ namespace: ns });
          const secrets = response.items;

          this.logWithPrefix(`Found ${secrets.length} secrets in namespace '${ns}'`, LogLevel.DEBUG);
          return secrets;
        } catch (error) {
          this.logWithPrefix(`Error fetching secrets in namespace '${ns}': ${error}`, LogLevel.ERROR);
          return [];
        }
      },
      cacheOptions
    );
  }

  /**
   * Get nodes in the cluster
   * @returns List of nodes
   */
  public async getNodes(): Promise<V1Node[]> {
    const cacheOptions: CacheOptions = {
      ttl: this.cacheTtl,
      description: 'cluster nodes',
      namespace: 'cluster-wide'
    };

    return this.cacheService.getOrFetch<V1Node[]>(
      'nodes',
      'cluster-wide',
      async () => {
        this.logWithPrefix('Fetching cluster nodes...', LogLevel.DEBUG);

        try {
          const coreV1Api = this.k8sClient.getCoreV1Api();
          const response = await coreV1Api.listNode();
          const nodes = response.items;

          this.logWithPrefix(`Found ${nodes.length} nodes in the cluster`, LogLevel.DEBUG);
          return nodes;
        } catch (error) {
          this.logWithPrefix(`Error fetching cluster nodes: ${error}`, LogLevel.ERROR);
          return [];
        }
      },
      cacheOptions
    );
  }

  /**
   * Get system resources (resources in eda-system namespace)
   * @param resourceType Resource type (pods, services, deployments, etc.)
   * @returns List of resources
   */
  public async getSystemResources(resourceType: string): Promise<any[]> {
    this.logWithPrefix(
      `Explicitly fetching ${resourceType} from system namespace`,
      LogLevel.INFO
    );

    // Save current namespace
    const prevNamespace = this.namespace;

    try {
      // Set namespace to eda-system for this operation
      this.setNamespace('eda-system', false);

      // Get resources based on type
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
          this.logWithPrefix(`Unknown system resource type: ${resourceType}`, LogLevel.WARN);
          return [];
      }
    } catch (error) {
      this.logWithPrefix(
        `Error fetching system resources (${resourceType}): ${error}`,
        LogLevel.ERROR
      );
      return [];
    } finally {
      // Restore previous namespace
      this.setNamespace(prevNamespace, false);
    }
  }

  /**
   * Get resource YAML - a comprehensive method that handles different resource types
   * @param kind Resource kind
   * @param name Resource name
   * @param namespace Namespace (optional, uses current namespace if not provided)
   * @param edaService Optional EdaService for EDA-specific resources
   * @param crdService Optional CrdService for CRD validation
   * @returns Resource YAML
   */
  public async getResourceYaml(
    kind: string,
    name: string,
    namespace?: string,
    edaService?: EdaService,
    crdService?: CrdService
  ): Promise<string> {
    const ns = namespace || this.namespace;

    try {
      this.logWithPrefix(`Getting ${kind}/${name} in namespace ${ns}...`, LogLevel.DEBUG);

      // For transaction-focused operations, use edactl (special case)
      if (kind.toLowerCase() === 'transaction' && edaService) {
        return edaService.getEdaTransactionDetails(name);
      }

      // If CRD service is provided, check if this is an EDA CRD
      let isEdaCrd = false;
      if (crdService) {
        isEdaCrd = await crdService.isEdaCrd(kind);
      }

      // If it's an EDA CRD and we have an EdaService, use edactl for it
      if (isEdaCrd && edaService) {
        const edaYaml = await edaService.getEdaResourceYaml(kind, name, ns, isEdaCrd);
        if (edaYaml && edaYaml.trim().length > 0) {
          return edaYaml;
        }
      }

      // For non-EDA resources or if edactl fails, use kubectl
      const kubectlPath = this.k8sClient.getKubectlPath();
      return getResourceYaml(kubectlPath, kind, name, ns);
    } catch (error: any) {
      this.logWithPrefix(`Error getting resource YAML: ${error}`, LogLevel.ERROR);
      return `# Error loading resource: ${error.message || error}`;
    }
  }

  /**
   * Apply a Kubernetes resource
   * @param resource Resource object
   * @param dryRun Whether to use dry run mode
   * @returns Result of apply operation
   */
  public async applyResource(resource: any, dryRun: boolean = false): Promise<string> {
    // Validate required fields
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

    // Determine namespace
    const namespace = resource.metadata.namespace || this.namespace;

    // Convert resource to YAML
    const resourceYaml = yaml.dump(resource);

    // Create temporary file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `resource-${Date.now()}.yaml`);

    try {
      // Write resource to file
      fs.writeFileSync(tmpFile, resourceYaml);

      // Apply resource
      const kubectlPath = this.k8sClient.getKubectlPath();
      const args = ['apply', '-f', tmpFile, '-o', 'yaml'];

      if (dryRun) {
        args.push('--dry-run=server');
      }

      this.logWithPrefix(
        `Applying ${resource.kind}/${resource.metadata.name} with kubectl...`,
        LogLevel.INFO
      );

      const output = runKubectl(kubectlPath, args, { namespace });

      this.logWithPrefix(
        `Successfully ${dryRun ? 'validated' : 'applied'} ${resource.kind}/${resource.metadata.name}`,
        LogLevel.INFO
      );

      return output;
    } catch (error: any) {
      this.logWithPrefix(`Error applying resource: ${error.message}`, LogLevel.ERROR, true);
      throw error;
    } finally {
      // Clean up temporary file
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch (cleanupError) {
        this.logWithPrefix(
          `Warning: Could not delete temporary file ${tmpFile}: ${cleanupError}`,
          LogLevel.WARN
        );
      }
    }
  }

  /**
   * Delete a pod
   * @param podName Pod name
   * @param namespace Namespace (optional, uses current namespace if not provided)
   */
  public async deletePod(podName: string, namespace?: string): Promise<void> {
    const ns = namespace || this.namespace;

    try {
      this.logWithPrefix(`Deleting pod '${podName}' in namespace '${ns}'`, LogLevel.INFO);

      const coreV1Api = this.k8sClient.getCoreV1Api();
      await coreV1Api.deleteNamespacedPod({ name: podName, namespace: ns });

      this.logWithPrefix(`Successfully deleted pod '${podName}'`, LogLevel.INFO);

      // Clear pod cache for this namespace
      this.cacheService.remove('pods', ns, ns);
    } catch (error: any) {
      const errorMsg = `Failed to delete Pod ${podName} in namespace ${ns}: ${
        error.body?.message || error.message || error
      }`;

      this.logWithPrefix(errorMsg, LogLevel.ERROR, true);
      throw new Error(errorMsg);
    }
  }

  /**
   * Get pod describe output
   * @param podName Pod name
   * @param namespace Namespace (optional, uses current namespace if not provided)
   * @returns Pod describe output
   */
  public getPodDescribeOutput(podName: string, namespace?: string): string {
    const ns = namespace || this.namespace;

    try {
      const kubectlPath = this.k8sClient.getKubectlPath();
      const output = runKubectl(
        kubectlPath,
        ['describe', 'pod', podName],
        { namespace: ns }
      );

      return output;
    } catch (error: any) {
      const msg = `Failed to describe pod ${podName} in namespace ${ns}: ${error.message}`;
      throw new Error(msg);
    }
  }

  /**
   * Get available resource types in a namespace
   * @param namespace Namespace
   * @returns List of available resource types
   */
  public async getAvailableResourceTypes(namespace: string): Promise<string[]> {
    try {
      this.logWithPrefix(`Getting available resource types in namespace ${namespace}...`, LogLevel.INFO);

      // Return a static list of common resource types instead of an expensive kubectl call
      const resourceTypes = [
        'Pods',
        'Services',
        'Deployments',
        'ConfigMaps',
        'Secrets',
      ];

      this.logWithPrefix(`Using ${resourceTypes.length} common resource types`, LogLevel.DEBUG);
      return resourceTypes;
    } catch (error) {
      this.logWithPrefix(`Error getting resource types: ${error}`, LogLevel.ERROR);
      return ['Pods', 'Services', 'Deployments', 'ConfigMaps', 'Secrets']; // Fallback
    }
  }

  /**
   * Clear resource caches
   */
  public clearCaches(): void {
    this.cacheService.clear('pods');
    this.cacheService.clear('services');
    this.cacheService.clear('deployments');
    this.cacheService.clear('configmaps');
    this.cacheService.clear('secrets');
    this.cacheService.clear('nodes');
  }
}