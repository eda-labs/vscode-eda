import * as path from 'path';

import * as vscode from 'vscode';

import { LogLevel, log } from '../extension';

import { CoreService } from './coreService';


/**
 * Service for handling resource status information, icons, and tooltips
 */
export class ResourceStatusService extends CoreService {
  // Maps for caching status icons
  private statusIconCache: Map<string, vscode.Uri> = new Map();
  private transactionIconCache: Map<string, vscode.Uri> = new Map();

  private initialized: boolean = false;

  // Extension context for resource loading
  private extensionContext?: vscode.ExtensionContext;

  constructor() {
    super();
    log('Initializing ResourceStatusService', LogLevel.INFO);
  }

  /**
   * Initialize the service with extension context and loading CRD status schemas
   * This should be called during extension activation
   */
  public initialize(context: vscode.ExtensionContext): void {
    if (this.initialized) return;

    try {
      this.extensionContext = context;
      this.initialized = true;
      log('ResourceStatusService initialized successfully', LogLevel.INFO);
    } catch (error) {
      log(`Failed to initialize ResourceStatusService: ${error}`, LogLevel.ERROR);
    }
  }


  // --- Status Icon Methods ---

  /**
   * Get status icon based on indicator color (green, red, yellow, gray)
   * This is the primary icon function that should be used for most resources
   */
  public getStatusIcon(indicator: string): vscode.Uri {
    if (!this.extensionContext) {
      throw new Error('ResourceStatusService not properly initialized with context');
    }

    const validIndicators = ['green', 'red', 'yellow', 'gray'];
    const actualIndicator = validIndicators.includes(indicator) ? indicator : 'gray';

    // Use cached icon if available
    if (this.statusIconCache.has(actualIndicator)) {
      return this.statusIconCache.get(actualIndicator)!;
    }

    // Create and cache the icon
    const iconUri = vscode.Uri.file(
      this.extensionContext.asAbsolutePath(path.join('resources', 'status', `status-${actualIndicator}.svg`))
    );

    this.statusIconCache.set(actualIndicator, iconUri);
    return iconUri;
  }

  /**
   * Get transaction icon based on a color indicator
   */
  private getTransactionIconByColor(color: string): vscode.Uri {
    if (!this.extensionContext) {
      throw new Error('ResourceStatusService not properly initialized with context');
    }

    const valid = ['green', 'red', 'yellow'];
    const indicator = valid.includes(color) ? color : 'red';

    if (this.transactionIconCache.has(indicator)) {
      return this.transactionIconCache.get(indicator)!;
    }

    const iconUri = vscode.Uri.file(
      this.extensionContext.asAbsolutePath(path.join('resources', 'status', `transaction-${indicator}.svg`))
    );

    this.transactionIconCache.set(indicator, iconUri);
    return iconUri;
  }

  /**
   * Get transaction icon based on success/failure
   */
  public getTransactionIcon(success: boolean): vscode.Uri {
    return this.getTransactionIconByColor(success ? 'green' : 'red');
  }

  /**
   * Get transaction icon based on transaction state string
   */
  public getTransactionStatusIcon(state: string | undefined, success?: boolean): vscode.Uri {
    const s = (state || '').toLowerCase();
    if (s.includes('running')) {
      return this.getTransactionIconByColor('yellow');
    }
    if (s.includes('complete')) {
      if (success === false) {
        return this.getTransactionIconByColor('red');
      }
      return this.getTransactionIconByColor('green');
    }
    if (s.includes('success') || s.includes('succeeded')) {
      return this.getTransactionIconByColor('green');
    }
    if (s.includes('fail') || s.includes('error')) {
      return this.getTransactionIconByColor('red');
    }
    if (success !== undefined) {
      return this.getTransactionIcon(success);
    }
    return this.getTransactionIconByColor('red');
  }

  /**
   * Get a ThemeIcon for a status color (for tree items that use ThemeIcon)
   */
  public getThemeStatusIcon(indicator: string): vscode.ThemeIcon {
    switch (indicator) {
      case 'red':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      case 'yellow':
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
      case 'green':
        return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
      case 'blue':
        return new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.blue'));
      case 'gray':
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }

  /**
   * Get a ThemeIcon for alarm severities (for tree items that use ThemeIcon)
   */
  public getAlarmThemeIcon(severity: string): vscode.ThemeIcon {
    const level = severity.toUpperCase();
    switch (level) {
      case 'CRITICAL':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      case 'MAJOR':
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.orange'));
      case 'WARNING':
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
      case 'MINOR':
        return new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.blue'));
      case 'INFO':
        return new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.green'));
      default:
        return new vscode.ThemeIcon('question');
    }
  }

  /**
   * Map severity/status/health to a standard indicator color
   * (green, red, yellow, gray)
   */
  public getStatusIndicator(status: string | undefined, health: number | undefined): string {
    if (!status && health === undefined) return 'gray';

    if (status) {
      const s = status.toLowerCase();
      if (['up', 'running', 'active'].includes(s)) return 'green';
      if (['down', 'failed', 'error'].includes(s)) return 'red';
      if (['degraded', 'warning'].includes(s)) return 'yellow';
    }

    if (health !== undefined) {
      if (health > 90) return 'green';
      if (health > 50) return 'yellow';
      return 'red';
    }

    return 'gray';
  }

  /**
   * Get alarm status indicator color based on severity
   */
  public getAlarmStatusIndicator(severity: string): string {
    const level = (severity || '').toUpperCase();
    switch (level) {
      case 'CRITICAL': return 'red';
      case 'MAJOR': return 'yellow';
      case 'WARNING': return 'yellow';
      case 'MINOR': return 'gray';
      case 'INFO': return 'green';
      default: return 'gray';
    }
  }

  // --- Resource Status Methods ---

  /**
   * Get status icon for a resource
   * @param resource Kubernetes resource object
   * @returns URI to the status icon
   */
  public getResourceStatusIcon(resource: any): vscode.Uri {
    const indicator = this.getResourceStatusIndicator(resource);
    return this.getStatusIcon(indicator);
  }

  /**
   * Get status icon as ThemeIcon for a resource
   * @param resource Kubernetes resource object
   * @returns ThemeIcon representing the resource status
   */
  public getResourceThemeStatusIcon(resource: any): vscode.ThemeIcon {
    const indicator = this.getResourceStatusIndicator(resource);
    return this.getThemeStatusIcon(indicator);
  }

  /**
   * Get status indicator string (green, yellow, red, gray) for a resource
   * @param resource Kubernetes resource object
   * @returns Status indicator string
   */
  public getResourceStatusIndicator(resource: any): string {
    if (!resource) return 'gray';

    const kind = resource.kind;

    // Handle standard Kubernetes resources
    if (this.isStandardK8sResource(kind)) {
      return this.getStandardK8sResourceStatus(resource);
    }

    // Handle custom resources
    return this.getCustomResourceStatus(resource);
  }

  /**
   * Get description text for status display
   * This extracts a short status description for display in tree views
   * @param resource Kubernetes resource object
   * @returns Short status description
   */
  public getStatusDescription(resource: any): string {
    if (!resource) return '';

    const kind = resource.kind;

    // Try standard K8s resource description first
    const standardDesc = this.getStandardK8sStatusDescription(kind, resource);
    if (standardDesc !== null) {
      return standardDesc;
    }

    // For custom resources
    return this.getCustomResourceStatusDescription(resource.status);
  }

  /** Get status description for standard K8s resources */
  private getStandardK8sStatusDescription(kind: string, resource: any): string | null {
    switch (kind) {
      case 'Pod':
        return resource.status?.phase || '';
      case 'Deployment':
        return this.getDeploymentStatusDescription(resource);
      case 'Service':
        return resource.spec?.type || 'ClusterIP';
      case 'ConfigMap':
        return this.getConfigMapStatusDescription(resource);
      case 'Secret':
        return resource.type || 'Opaque';
      default:
        return null;
    }
  }

  /** Get status description for Deployment resources */
  private getDeploymentStatusDescription(resource: any): string {
    const ready = resource.status?.readyReplicas || 0;
    const desired = resource.spec?.replicas || 0;
    return `${ready}/${desired}`;
  }

  /** Get status description for ConfigMap resources */
  private getConfigMapStatusDescription(resource: any): string {
    const dataCount = Object.keys(resource.data || {}).length;
    return `${dataCount} items`;
  }

  /** Get status description for custom resources */
  private getCustomResourceStatusDescription(status: any): string {
    if (!status) return '';

    const parts: string[] = [];

    if (status.operationalState) {
      parts.push(`State: ${status.operationalState}`);
    }

    if (status.health !== undefined) {
      parts.push(`Health: ${status.health}%`);
    }

    if (status.state) {
      parts.push(`State: ${status.state}`);
    }

    return parts.join(', ');
  }

  /**
   * Get tooltip text for a resource
   * @param resource Kubernetes resource object
   * @returns Tooltip text with detailed resource info
   */
  public getResourceTooltip(resource: any): string {
    if (!resource) return '';

    const kind = resource.kind;
    const name = resource.metadata?.name || 'Unnamed';
    const namespace = resource.metadata?.namespace || 'default';

    let tooltip = `Name: ${name}\nKind: ${kind}\nNamespace: ${namespace}`;

    // Add API Version if available
    if (resource.apiVersion) {
      tooltip += `\nAPI Version: ${resource.apiVersion}`;
    }

    // Add resource UID if available
    if (resource.metadata?.uid) {
      tooltip += `\nUID: ${resource.metadata.uid}`;
    }

    // Add creation timestamp if available
    if (resource.metadata?.creationTimestamp) {
      tooltip += `\nCreated: ${resource.metadata.creationTimestamp}`;
    }

    // Add status fields
    if (resource.status) {
      const statusFields = this.extractStatusFields(resource.status, kind);
      if (statusFields.length > 0) {
        tooltip += '\n\nStatus:';
        for (const field of statusFields) {
          tooltip += `\n• ${field.label}: ${field.value}`;
        }
      }
    }

    return tooltip;
  }

  /**
   * Extract relevant status fields based on resource kind and schema
   */
  private extractStatusFields(status: any, kind: string): { label: string, value: string }[] {
    if (!status) {
      return [];
    }

    switch (kind) {
      case 'Pod':
        return this.extractPodStatusFields(status);
      case 'Deployment':
        return this.extractDeploymentStatusFields(status);
      case 'Service':
        return this.extractServiceStatusFields(status);
      default:
        return this.extractCustomResourceStatusFields(status);
    }
  }

  /** Extract status fields for Pod resources */
  private extractPodStatusFields(status: any): { label: string, value: string }[] {
    const fields: { label: string, value: string }[] = [];

    if (status.phase) {
      fields.push({ label: 'Phase', value: status.phase });
    }
    if (status.podIP) {
      fields.push({ label: 'Pod IP', value: status.podIP });
    }
    if (status.hostIP) {
      fields.push({ label: 'Host IP', value: status.hostIP });
    }
    if (status.startTime) {
      fields.push({ label: 'Started', value: status.startTime });
    }

    this.extractContainerStatusFields(status, fields);
    return fields;
  }

  /** Extract container status fields from Pod status */
  private extractContainerStatusFields(status: any, fields: { label: string, value: string }[]): void {
    if (!status.containerStatuses || !Array.isArray(status.containerStatuses)) {
      return;
    }

    for (const container of status.containerStatuses) {
      const ready = container.ready ? 'Ready' : 'Not Ready';
      const restartCount = container.restartCount || 0;
      fields.push({
        label: `Container ${container.name}`,
        value: `${ready}, Restarts: ${restartCount}`
      });
    }
  }

  /** Extract status fields for Deployment resources */
  private extractDeploymentStatusFields(status: any): { label: string, value: string }[] {
    const fields: { label: string, value: string }[] = [];

    if (status.replicas !== undefined) {
      fields.push({ label: 'Replicas', value: `${status.replicas}` });
    }
    if (status.readyReplicas !== undefined) {
      fields.push({ label: 'Ready', value: `${status.readyReplicas}` });
    }
    if (status.updatedReplicas !== undefined) {
      fields.push({ label: 'Updated', value: `${status.updatedReplicas}` });
    }
    if (status.availableReplicas !== undefined) {
      fields.push({ label: 'Available', value: `${status.availableReplicas}` });
    }

    this.extractConditionFields(status, fields);
    return fields;
  }

  /** Extract condition fields from resource status */
  private extractConditionFields(status: any, fields: { label: string, value: string }[]): void {
    if (!status.conditions || !Array.isArray(status.conditions)) {
      return;
    }

    for (const condition of status.conditions) {
      fields.push({
        label: `Condition ${condition.type}`,
        value: `${condition.status} - ${condition.message || 'No message'}`
      });
    }
  }

  /** Extract status fields for Service resources */
  private extractServiceStatusFields(status: any): { label: string, value: string }[] {
    const fields: { label: string, value: string }[] = [];

    if (!status.loadBalancer?.ingress || !Array.isArray(status.loadBalancer.ingress)) {
      return fields;
    }

    for (const ingress of status.loadBalancer.ingress) {
      if (ingress.ip) {
        fields.push({ label: 'LoadBalancer IP', value: ingress.ip });
      }
      if (ingress.hostname) {
        fields.push({ label: 'LoadBalancer Hostname', value: ingress.hostname });
      }
    }

    return fields;
  }

  /** Extract status fields for custom resources */
  private extractCustomResourceStatusFields(status: any): { label: string, value: string }[] {
    const fields: { label: string, value: string }[] = [];

    for (const [key, value] of Object.entries(status)) {
      const fieldValue = this.extractFieldValue(key, value);
      if (fieldValue) {
        fields.push(fieldValue);
      }
    }

    return fields;
  }

  /** Extract a single field value from a status entry */
  private extractFieldValue(key: string, value: unknown): { label: string, value: string } | null {
    if (value === undefined || value === null) {
      return null;
    }

    // If the value is a primitive, use it directly
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      return { label: this.formatFieldName(key), value: String(value) };
    }

    // If the value is an object, try to extract a simple value
    if (typeof value === 'object') {
      return this.extractObjectFieldValue(key, value as Record<string, unknown>);
    }

    return null;
  }

  /** Extract field value from an object */
  private extractObjectFieldValue(key: string, obj: Record<string, unknown>): { label: string, value: string } | null {
    // If it has a 'value' property that is primitive, use that
    if ('value' in obj && ['string', 'number', 'boolean'].includes(typeof obj.value)) {
      return { label: this.formatFieldName(key), value: String(obj.value) };
    }

    // Otherwise, if the object has only one key, use that single property
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const innerVal = obj[keys[0]];
      if (['string', 'number', 'boolean'].includes(typeof innerVal)) {
        return { label: this.formatFieldName(key), value: String(innerVal) };
      }
    }

    // Skip complex objects
    return null;
  }

  /**
   * Format a camelCase or snake_case field name to Title Case with spaces
   */
  private formatFieldName(name: string): string {
    // Handle camelCase
    const spacedName = name.replace(/([A-Z])/g, ' $1');

    // Handle snake_case
    const withoutUnderscores = spacedName.replace(/_/g, ' ');

    // Title case
    return withoutUnderscores
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Check if a resource kind is a standard Kubernetes resource
   */
  private isStandardK8sResource(kind: string): boolean {
    const standardResources = [
      'Pod', 'Service', 'Deployment', 'ConfigMap', 'Secret',
      'Node', 'Job', 'CronJob', 'DaemonSet', 'StatefulSet',
      'ReplicaSet', 'Ingress', 'PersistentVolumeClaim', 'PersistentVolume'
    ];

    return standardResources.includes(kind);
  }

  /**
   * Get status indicator for standard Kubernetes resources
   */
  private getStandardK8sResourceStatus(resource: any): string {
    if (!resource) return 'gray';

    const kind = resource.kind;
    const status = resource.status;

    if (!status) return 'gray';

    switch (kind) {
      case 'Pod':
        return this.getPodStatusIndicator(status);
      case 'Deployment':
        return this.getDeploymentStatusIndicator(resource.spec, status);
      case 'Service':
      case 'ConfigMap':
      case 'Secret':
        return 'green';
      case 'Node':
        return this.getNodeStatusIndicator(status);
      default:
        return 'gray';
    }
  }

  /** Get status indicator for Pod resources */
  private getPodStatusIndicator(status: any): string {
    const phase = status.phase?.toLowerCase();
    if (phase === 'running') return 'green';
    if (phase === 'pending') return 'yellow';
    if (['failed', 'unknown', 'error'].includes(phase)) return 'red';
    return 'gray';
  }

  /** Get status indicator for Deployment resources */
  private getDeploymentStatusIndicator(spec: any, status: any): string {
    const desired = spec?.replicas || 0;
    const ready = status.readyReplicas || 0;

    if (desired === 0) return 'gray';
    if (ready === desired) return 'green';
    if (ready > 0) return 'yellow';
    return 'red';
  }

  /** Get status indicator for Node resources */
  private getNodeStatusIndicator(status: any): string {
    const conditions = status.conditions || [];
    const readyCondition = conditions.find((c: any) => c.type === 'Ready');

    if (readyCondition && readyCondition.status === 'True') return 'green';
    return 'red';
  }

  /**
   * Get status indicator for custom resources
   */
  private getCustomResourceStatus(resource: any): string {
    if (!resource || !resource.status) {
      return 'gray';
    }

    const status = resource.status;

    // Check explicit operational indicators first
    const operationalResult = this.checkOperationalIndicators(status);
    if (operationalResult) {
      return operationalResult;
    }

    // Check common status fields in priority order
    const fieldResult = this.checkCommonStatusFields(status);
    if (fieldResult) {
      return fieldResult;
    }

    // Check conditions array if present
    const conditionResult = this.checkStatusConditions(status);
    if (conditionResult) {
      return conditionResult;
    }

    // Generic check: scan for keys containing "status" or "state"
    const genericResult = this.checkGenericStatusKeys(status);
    if (genericResult) {
      return genericResult;
    }

    // If a status exists but none of the keys provided an indicator, default to green
    return 'green';
  }

  /** Check explicit operational indicators (operational, reachable, error) */
  private checkOperationalIndicators(status: any): string | null {
    if (status.operational === true) {
      return 'green';
    }
    if (status.operational === false) {
      return 'red';
    }
    if (status.error === "" && status.reachable === true) {
      return 'green';
    }
    return null;
  }

  /** Check common status fields: operationalState, health, state, phase, ready */
  private checkCommonStatusFields(status: any): string | null {
    const operationalStateResult = this.mapStateToIndicator(status.operationalState);
    if (operationalStateResult) {
      return operationalStateResult;
    }

    if (status.health !== undefined) {
      return this.mapHealthToIndicator(Number(status.health));
    }

    const stateResult = this.mapStateToIndicator(status.state, true);
    if (stateResult) {
      return stateResult;
    }

    const phaseResult = this.mapPhaseToIndicator(status.phase);
    if (phaseResult) {
      return phaseResult;
    }

    if (status.ready === true) {
      return 'green';
    }
    if (status.ready === false) {
      return 'red';
    }

    return null;
  }

  /** Map operationalState or state field to indicator */
  private mapStateToIndicator(state: string | undefined, includeReady = false): string | null {
    if (!state) {
      return null;
    }
    const s = state.toLowerCase();
    const greenStates = includeReady ? ['up', 'running', 'active', 'ready'] : ['up', 'running', 'active'];
    const redStates = ['down', 'failed', 'error'];
    const yellowStates = includeReady ? ['degraded', 'warning', 'pending'] : ['degraded', 'warning'];

    if (greenStates.includes(s)) {
      return 'green';
    }
    if (redStates.includes(s)) {
      return 'red';
    }
    if (yellowStates.includes(s)) {
      return 'yellow';
    }
    return null;
  }

  /** Map health percentage to indicator */
  private mapHealthToIndicator(health: number): string {
    if (health > 90) {
      return 'green';
    }
    if (health > 50) {
      return 'yellow';
    }
    return 'red';
  }

  /** Map phase field to indicator */
  private mapPhaseToIndicator(phase: string | undefined): string | null {
    if (!phase) {
      return null;
    }
    const p = phase.toLowerCase();
    if (['active', 'succeeded', 'ready', 'running', 'available'].includes(p)) {
      return 'green';
    }
    if (['pending', 'initializing', 'provisioning'].includes(p)) {
      return 'yellow';
    }
    if (['failed', 'error', 'terminating'].includes(p)) {
      return 'red';
    }
    return null;
  }

  /** Check conditions array for ready/error conditions */
  private checkStatusConditions(status: any): string | null {
    if (!status.conditions || !Array.isArray(status.conditions)) {
      return null;
    }

    const readyCondition = status.conditions.find((c: any) =>
      c.type === 'Ready' || c.type === 'Available' || c.type === 'Healthy'
    );
    if (readyCondition) {
      if (readyCondition.status === 'True') {
        return 'green';
      }
      if (readyCondition.status === 'False') {
        return 'red';
      }
      return 'yellow';
    }

    const errorCondition = status.conditions.find((c: any) =>
      (c.type === 'Error' || c.type === 'Failed') && c.status === 'True'
    );
    if (errorCondition) {
      return 'red';
    }

    return null;
  }

  /** Scan generic keys containing "status" or "state" */
  private checkGenericStatusKeys(status: any): string | null {
    const genericIndicators: string[] = [];

    for (const key of Object.keys(status)) {
      const keyLower = key.toLowerCase();
      const isStatusOrStateKey = keyLower.includes("status") || keyLower.includes("state");
      const isNotDetails = !keyLower.includes("details");
      const isStringValue = typeof status[key] === "string";

      if (isStatusOrStateKey && isNotDetails && isStringValue) {
        genericIndicators.push(this.mapStatusTextToIndicator(status[key]));
      }
    }

    if (genericIndicators.length === 0) {
      return null;
    }

    // Prioritize explicit failures or warnings
    if (genericIndicators.includes('red')) {
      return 'red';
    }
    if (genericIndicators.includes('yellow')) {
      return 'yellow';
    }
    return 'green';
  }

  /**
   * Helper function that maps a status string to a standard indicator color
   */
  private mapStatusTextToIndicator(text: string): string {
    const t = text.toLowerCase();
    if (
      t.includes('ready') ||
      t.includes('up') ||
      t.includes('running') ||
      t.includes('active') ||
      t.includes('success') ||
      t.includes('available') ||
      t.includes('synced') ||
      t.includes('connected')
    ) {
      return 'green';
    }
    if (t.includes('failed') || t.includes('error') || t.includes('down')) {
      return 'red';
    }
    if (t.includes('degraded') || t.includes('warning') || t.includes('pending')) {
      return 'yellow';
    }
    return 'gray';
  }

}