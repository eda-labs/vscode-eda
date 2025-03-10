// src/k8s/kubernetesService.ts - Facade implementing the original interface
//import * as k8s from '@kubernetes/client-node';
import { V1Pod, V1Service, V1Deployment, V1ConfigMap, V1Secret, V1Node, V1CustomResourceDefinition } from '@kubernetes/client-node';
import { BaseK8sService } from './baseK8sService';
import { K8sResourcesService } from './k8sResourcesService';
import { CrdService } from './crdService';
import { ToolboxService } from './toolboxService';
import { EdaService } from './edaService';
import { EdaTransaction, EdaAlarm, EdaDeviation, CrdInfo } from '../types';
import { LogLevel, log } from '../../extension.js';

export class KubernetesService extends BaseK8sService {
  private resourcesService: K8sResourcesService;
  private crdService: CrdService;
  private toolboxService: ToolboxService;
  private edaService: EdaService;

  constructor() {
    super();
    // Initialize component services
    this.resourcesService = new K8sResourcesService();
    this.crdService = new CrdService();
    this.toolboxService = new ToolboxService();
    this.edaService = new EdaService(this.toolboxService);

    log('KubernetesService initialized with all component services', LogLevel.INFO);
  }

  // Override setNamespace to propagate to all services
  public setNamespace(namespace: string): void {
    // Only log once at the main service level
    super.setNamespace(namespace, true);

    // Propagate to child services without additional logging
    this.resourcesService.setNamespace(namespace, false);
    this.crdService.setNamespace(namespace, false);
    this.toolboxService.setNamespace(namespace, false);
    this.edaService.setNamespace(namespace, false);
  }

  // ----- Delegating methods to appropriate services -----

  // Standard K8s resources - delegated to resourcesService
  async getPods(namespace?: string): Promise<V1Pod[]> {
    return this.resourcesService.getPods(namespace);
  }

  async getServices(namespace?: string): Promise<V1Service[]> {
    return this.resourcesService.getServices(namespace);
  }

  async getDeployments(namespace?: string): Promise<V1Deployment[]> {
    return this.resourcesService.getDeployments(namespace);
  }

  async getConfigMaps(namespace?: string): Promise<V1ConfigMap[]> {
    return this.resourcesService.getConfigMaps(namespace);
  }

  async getSecrets(namespace?: string): Promise<V1Secret[]> {
    return this.resourcesService.getSecrets(namespace);
  }

  async getNodes(): Promise<V1Node[]> {
    return this.resourcesService.getNodes();
  }

  async getSystemResources(resourceType: string): Promise<any[]> {
    return this.resourcesService.getSystemResources(resourceType);
  }

  public async deletePod(namespace: string, podName: string): Promise<void> {
    return this.resourcesService.deletePod(namespace, podName);
  }

  public getPodDescribeOutput(namespace: string, podName: string): string {
    return this.resourcesService.getPodDescribeOutput(namespace, podName);
  }

  // CRD-related methods - delegated to crdService
  async getAllCrds(): Promise<V1CustomResourceDefinition[]> {
    return this.crdService.getAllCrds();
  }

  public async getCrdYamlForKind(kind: string): Promise<string> {
    return this.crdService.getCrdYamlForKind(kind);
  }

  async getAvailableCrdGroups(): Promise<string[]> {
    return this.crdService.getAvailableCrdGroups();
  }

  public async getCRDs(): Promise<any[]> {
    return this.crdService.getCRDs();
  }

  async getCrdsForGroup(group: string): Promise<CrdInfo[]> {
    return this.crdService.getCrdsForGroup(group);
  }

  async batchCheckCrdInstances(namespace: string, crds: CrdInfo[]): Promise<Set<string>> {
    return this.crdService.batchCheckCrdInstances(namespace, crds);
  }

  async hasCrdInstances(namespace: string, crd: CrdInfo): Promise<boolean> {
    return this.crdService.hasCrdInstances(namespace, crd);
  }

  async getCrdInstances(namespace: string, crd: CrdInfo): Promise<any[]> {
    return this.crdService.getCrdInstances(namespace, crd);
  }

  async isEdaCrd(kind: string): Promise<boolean> {
    return this.crdService.isEdaCrd(kind);
  }

  public async getCrdSchemaForKind(kind: string): Promise<any> {
    return this.crdService.getCrdSchemaForKind(kind);
  }

  public async getCrdDefinitionForKind(kind: string): Promise<V1CustomResourceDefinition> {
    return this.crdService.getCrdDefinitionForKind(kind);
  }

  // Toolbox methods - delegated to toolboxService
  async executeCommandInToolbox(command: string, ignoreNoResources: boolean = false): Promise<string> {
    return this.toolboxService.executeCommandInToolbox(command, ignoreNoResources);
  }

  // EDA methods - delegated to edaService
  async getEdaNamespaces(): Promise<string[]> {
    return this.edaService.getEdaNamespaces();
  }

  async getEdaAlarms(): Promise<EdaAlarm[]> {
    return this.edaService.getEdaAlarms();
  }

  async getEdaDeviations(): Promise<EdaDeviation[]> {
    return this.edaService.getEdaDeviations();
  }

  async getEdaTransactions(): Promise<EdaTransaction[]> {
    return this.edaService.getEdaTransactions();
  }

  async getEdaTransactionDetails(id: string): Promise<string> {
    return this.edaService.getEdaTransactionDetails(id);
  }

  /**
   * Clears the transaction cache to force fresh data on next request
   */
  public clearTransactionCache(): void {
    // Clear the transaction cache in EdaService
    this.edaService.clearTransactionCache();
  }

  /**
   * Revert a transaction using edactl git revert with the given commit hash
   */
  async revertTransaction(commitHash: string): Promise<string> {
    return this.edaService.revertTransaction(commitHash);
  }

  /**
   * Restore a transaction using edactl git with the given commit hash
   */
  async restoreTransaction(commitHash: string): Promise<string> {
    return this.edaService.restoreTransaction(commitHash);
  }

  async getNppPodsForNamespace(edaNamespace: string): Promise<V1Pod[]> {
    return this.edaService.getNppPodsForNamespace(edaNamespace);
  }

  public async getAvailableResourceTypes(namespace: string): Promise<string[]> {
    return this.resourcesService.getAvailableResourceTypes(namespace);
  }

  // Methods that combine services
  async getResourceYaml(kind: string, name: string, namespace?: string): Promise<string> {
    const ns = namespace || this.namespace;

    try {
      // For transaction-focused operations, use edactl (special case)
      if (kind.toLowerCase() === 'transaction') {
        return this.edaService.getEdaTransactionDetails(name);
      }

      // First, try to determine if this is an EDA CRD - if so, use edactl for it
      const isEdaCrd = await this.crdService.isEdaCrd(kind);

      if (isEdaCrd) {
        const edaYaml = await this.edaService.getEdaResourceYaml(kind, name, ns, isEdaCrd);
        if (edaYaml && edaYaml.trim().length > 0) {
          return edaYaml;
        }
      }

      // For non-EDA resources or if edactl fails, use kubectl via resourcesService
      return this.resourcesService.getResourceYaml(kind, name, ns);
    } catch (error: any) {
      log(`Error getting resource YAML: ${error}`, LogLevel.ERROR);
      return `# Error loading resource: ${error.message || error}`;
    }
  }

  async applyResource(resource: any, dryRun: boolean = false): Promise<string> {
    return this.resourcesService.applyResource(resource, dryRun);
  }

  // Cache management methods
  resetPodCache() {
    this.resourcesService.resetPodCache();
  }

  clearAllCaches() {
    this.resourcesService.clearAllCaches();
    this.crdService.clearCrdCache();
    this.toolboxService.resetToolboxCache();
    this.edaService.resetNamespaceCache();
  }
}