// src/services/statusService.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { CoreService } from './coreService';
import { KubernetesClient } from '../clients/kubernetesClient';
import { LogLevel, log } from '../extension';

/**
 * Service for handling resource status information, icons, and tooltips
 * Extracted from resourceStatusService.ts
 */
export class StatusService extends CoreService {
  // Maps for caching status icons
  private statusIconCache: Map<string, vscode.Uri> = new Map();
  private transactionIconCache: Map<string, vscode.Uri> = new Map();

  // Store CRD status schemas
  private crdStatusSchemas: Map<string, any> = new Map();
  private initialized: boolean = false;

  // Extension context for resource loading
  private extensionContext?: vscode.ExtensionContext;

  constructor(private k8sClient: KubernetesClient) {
    super('Status');
  }

  /**
   * Initialize the service with extension context
   * @param context VSCode extension context
   */
  public async initialize(context: vscode.ExtensionContext): Promise<void> {
    if (this.initialized) return;

    try {
      this.extensionContext = context;
      await this.loadCrdStatusSchemas();
      this.initialized = true;
      this.logWithPrefix('Initialized successfully', LogLevel.INFO);
    } catch (error) {
      this.logWithPrefix(`Failed to initialize: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Load status schemas for all CRDs
   */
  private async loadCrdStatusSchemas(): Promise<void> {
    try {
      // This will be implemented later when we have a dedicated CRD service
      // For now, we're just creating the placeholder
      this.logWithPrefix('CRD status schemas will be loaded when CRD service is implemented', LogLevel.INFO);
    } catch (error) {
      this.logWithPrefix(`Failed to load CRD status schemas: ${error}`, LogLevel.ERROR);
    }
  }

  /**
   * Get status icon based on indicator color
   * @param indicator Indicator color ('green', 'red', 'yellow', 'gray')
   * @returns URI to status icon
   */
  public getStatusIcon(indicator: string): vscode.Uri {
    if (!this.extensionContext) {
      throw new Error('StatusService not properly initialized with context');
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
   * Get transaction icon based on success/failure
   * @param success Whether the transaction was successful
   * @returns URI to transaction icon
   */
  public getTransactionIcon(success: boolean): vscode.Uri {
    if (!this.extensionContext) {
      throw new Error('StatusService not properly initialized with context');
    }

    const status = success ? 'green' : 'red';

    // Use cached icon if available
    if (this.transactionIconCache.has(status)) {
      return this.transactionIconCache.get(status)!;
    }

    // Create and cache the icon
    const iconUri = vscode.Uri.file(
      this.extensionContext.asAbsolutePath(path.join('resources', 'status', `transaction-${status}.svg`))
    );

    this.transactionIconCache.set(status, iconUri);
    return iconUri;
  }

  /**
   * Get ThemeIcon for status color
   * @param indicator Indicator color ('green', 'red', 'yellow', 'gray', 'blue')
   * @returns ThemeIcon
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
   * Get ThemeIcon for alarm severity
   * @param severity Alarm severity
   * @returns ThemeIcon
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
   * Map severity/status/health to indicator color
   * @param status Status string
   * @param health Health percentage
   * @returns Indicator color ('green', 'red', 'yellow', 'gray')
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
   * Get alarm status indicator based on severity
   * @param severity Alarm severity
   * @returns Indicator color ('green', 'red', 'yellow', 'gray')
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

  /**
   * Get status icon for a resource
   * @param resource Kubernetes resource
   * @returns URI to status icon
   */
  public getResourceStatusIcon(resource: any): vscode.Uri {
    const indicator = this.getResourceStatusIndicator(resource);
    return this.getStatusIcon(indicator);
  }

  /**
   * Get status icon as ThemeIcon for a resource
   * @param resource Kubernetes resource
   * @returns ThemeIcon
   */
  public getResourceThemeStatusIcon(resource: any): vscode.ThemeIcon {
    const indicator = this.getResourceStatusIndicator(resource);
    return this.getThemeStatusIcon(indicator);
  }

  /**
   * Get status indicator for a resource
   * @param resource Kubernetes resource
   * @returns Indicator color ('green', 'red', 'yellow', 'gray')
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
   * Get status description text for display
   * @param resource Kubernetes resource
   * @returns Status description
   */
  public getStatusDescription(resource: any): string {
    if (!resource) return '';

    const kind = resource.kind;

    switch (kind) {
      case 'Pod':
        return resource.status?.phase || '';

      case 'Deployment':
        const ready = resource.status?.readyReplicas || 0;
        const desired = resource.spec?.replicas || 0;
        return `${ready}/${desired}`;

      case 'Service':
        return resource.spec?.type || 'ClusterIP';

      case 'ConfigMap':
        const dataCount = Object.keys(resource.data || {}).length;
        return `${dataCount} items`;

      case 'Secret':
        return resource.type || 'Opaque';
    }

    // For custom resources
    if (resource.status) {
      let desc = '';

      // Common status fields for EDA resources
      if (resource.status.operationalState) {
        desc += `State: ${resource.status.operationalState}`;
      }

      if (resource.status.health !== undefined) {
        desc += (desc ? ', ' : '') + `Health: ${resource.status.health}%`;
      }

      if (resource.status.state) {
        desc += (desc ? ', ' : '') + `State: ${resource.status.state}`;
      }

      // Look for other important status fields defined in schema
      if (!desc && this.crdStatusSchemas.has(kind)) {
        const schema = this.crdStatusSchemas.get(kind);
        if (schema && schema.properties) {
          // Use priority fields if defined in schema
          const priorityFields = ['phase', 'status', 'condition', 'ready'];
          for (const field of priorityFields) {
            if (resource.status[field] !== undefined) {
              desc += (desc ? ', ' : '') + `${this.formatFieldName(field)}: ${resource.status[field]}`;
            }
          }
        }
      }

      return desc;
    }

    return '';
  }

  /**
   * Get tooltip text for a resource
   * @param resource Kubernetes resource
   * @returns Tooltip text
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
   * Extract relevant status fields
   * @param status Resource status
   * @param kind Resource kind
   * @returns List of status fields
   */
  private extractStatusFields(status: any, kind: string): { label: string, value: string }[] {
    const fields: { label: string, value: string }[] = [];
    if (!status) return fields;

    // Handle standard resource kinds
    switch (kind) {
      case 'Pod':
        if (status.phase) fields.push({ label: 'Phase', value: status.phase });
        if (status.podIP) fields.push({ label: 'Pod IP', value: status.podIP });
        if (status.hostIP) fields.push({ label: 'Host IP', value: status.hostIP });
        if (status.startTime) fields.push({ label: 'Started', value: status.startTime });
        if (status.containerStatuses && Array.isArray(status.containerStatuses)) {
          for (const container of status.containerStatuses) {
            const ready = container.ready ? 'Ready' : 'Not Ready';
            const restartCount = container.restartCount || 0;
            fields.push({
              label: `Container ${container.name}`,
              value: `${ready}, Restarts: ${restartCount}`
            });
          }
        }
        break;

      case 'Deployment':
        if (status.replicas !== undefined) fields.push({ label: 'Replicas', value: `${status.replicas}` });
        if (status.readyReplicas !== undefined) fields.push({ label: 'Ready', value: `${status.readyReplicas}` });
        if (status.updatedReplicas !== undefined) fields.push({ label: 'Updated', value: `${status.updatedReplicas}` });
        if (status.availableReplicas !== undefined) fields.push({ label: 'Available', value: `${status.availableReplicas}` });
        if (status.conditions && Array.isArray(status.conditions)) {
          for (const condition of status.conditions) {
            fields.push({
              label: `Condition ${condition.type}`,
              value: `${condition.status} - ${condition.message || 'No message'}`
            });
          }
        }
        break;

      case 'Service':
        if (status.loadBalancer?.ingress && Array.isArray(status.loadBalancer.ingress)) {
          for (const ingress of status.loadBalancer.ingress) {
            if (ingress.ip) {
              fields.push({ label: 'LoadBalancer IP', value: ingress.ip });
            }
            if (ingress.hostname) {
              fields.push({ label: 'LoadBalancer Hostname', value: ingress.hostname });
            }
          }
        }
        break;

      default:
        // For custom resources, extract only actual status values
        for (const [key, value] of Object.entries(status)) {
          if (value === undefined || value === null) {
            continue;
          }
          // If the value is a primitive, use it directly
          if (['string', 'number', 'boolean'].includes(typeof value)) {
            fields.push({ label: this.formatFieldName(key), value: String(value) });
          }
          // If the value is an object, try to extract a simple value
          else if (typeof value === 'object') {
            // If it has a 'value' property that is primitive, use that
            if ('value' in value && ['string', 'number', 'boolean'].includes(typeof (value as any).value)) {
              fields.push({ label: this.formatFieldName(key), value: String((value as any).value) });
            }
            // Otherwise, if the object has only one key, use that single property
            else if (Object.keys(value).length === 1) {
              const innerKey = Object.keys(value)[0];
              const innerVal = (value as Record<string, any>)[innerKey];
              if (['string', 'number', 'boolean'].includes(typeof innerVal)) {
                fields.push({ label: this.formatFieldName(key), value: String(innerVal) });
              }
            }
            // Otherwise, skip complex objects
          }
        }
        break;
    }

    return fields;
  }

  /**
   * Format field name for display
   * @param name Field name
   * @returns Formatted field name
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
   * @param kind Resource kind
   * @returns Whether the resource is a standard Kubernetes resource
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
   * @param resource Kubernetes resource
   * @returns Indicator color ('green', 'red', 'yellow', 'gray')
   */
  private getStandardK8sResourceStatus(resource: any): string {
    if (!resource) return 'gray';

    const kind = resource.kind;
    const status = resource.status;

    if (!status) return 'gray';

    switch (kind) {
      case 'Pod':
        const phase = status.phase?.toLowerCase();
        if (phase === 'running') return 'green';
        if (phase === 'pending') return 'yellow';
        if (['failed', 'unknown', 'error'].includes(phase)) return 'red';
        break;

      case 'Deployment':
        const desired = resource.spec?.replicas || 0;
        const ready = status.readyReplicas || 0;

        if (desired === 0) return 'gray';
        if (ready === desired) return 'green';
        if (ready > 0) return 'yellow';
        return 'red';

      case 'Service':
        // Services are typically always "green" if they exist
        return 'green';

      case 'Node':
        // Check node conditions
        const conditions = status.conditions || [];
        const readyCondition = conditions.find((c: any) => c.type === 'Ready');

        if (readyCondition && readyCondition.status === 'True') return 'green';
        return 'red';

      case 'ConfigMap':
      case 'Secret':
        // Always green for these types
        return 'green';
    }

    return 'gray';
  }

  /**
   * Get status indicator for custom resources
   * @param resource Kubernetes resource
   * @returns Indicator color ('green', 'red', 'yellow', 'gray')
   */
  private getCustomResourceStatus(resource: any): string {
    if (!resource || !resource.status) return 'gray';

    // Explicit checks for specific conditions
    if (resource.status.operational === true) {
      return 'green';
    }
    if (resource.status.operational === false) {
      return 'red';
    }
    if (resource.status.error === "" && resource.status.reachable === true) {
      return 'green';
    }

    // Specific checks
    if (resource.status.operationalState) {
      const state = resource.status.operationalState.toLowerCase();
      if (['up', 'running', 'active'].includes(state)) return 'green';
      if (['down', 'failed', 'error'].includes(state)) return 'red';
      if (['degraded', 'warning'].includes(state)) return 'yellow';
    }

    if (resource.status.health !== undefined) {
      const health = Number(resource.status.health);
      if (health > 90) return 'green';
      if (health > 50) return 'yellow';
      return 'red';
    }

    if (resource.status.state) {
      const state = resource.status.state.toLowerCase();
      if (['up', 'running', 'active', 'ready'].includes(state)) return 'green';
      if (['down', 'failed', 'error'].includes(state)) return 'red';
      if (['degraded', 'warning', 'pending'].includes(state)) return 'yellow';
    }

    if (resource.status.phase) {
      const phase = resource.status.phase.toLowerCase();
      if (['active', 'succeeded', 'ready', 'running', 'available'].includes(phase)) return 'green';
      if (['pending', 'initializing', 'provisioning'].includes(phase)) return 'yellow';
      if (['failed', 'error', 'terminating'].includes(phase)) return 'red';
    }

    if (resource.status.ready === true) return 'green';
    if (resource.status.ready === false) return 'red';

    if (resource.status.conditions && Array.isArray(resource.status.conditions)) {
      const readyCondition = resource.status.conditions.find((c: any) =>
        c.type === 'Ready' || c.type === 'Available' || c.type === 'Healthy'
      );
      if (readyCondition) {
        if (readyCondition.status === 'True') return 'green';
        if (readyCondition.status === 'False') return 'red';
        return 'yellow';
      }
      const errorCondition = resource.status.conditions.find((c: any) =>
        (c.type === 'Error' || c.type === 'Failed') && c.status === 'True'
      );
      if (errorCondition) return 'red';
    }

    // Generic check: scan for keys containing "status" or "state"
    const genericIndicators: string[] = [];
    for (const key in resource.status) {
      const keyLower = key.toLowerCase();
      if (
        (keyLower.includes("status") || keyLower.includes("state")) &&
        !keyLower.includes("details") &&
        typeof resource.status[key] === "string"
      ) {
        genericIndicators.push(this.mapStatusTextToIndicator(resource.status[key]));
      }
    }

    if (genericIndicators.length > 0) {
      // Prioritize explicit failures or warnings
      if (genericIndicators.includes('red')) {
        return 'red';
      } else if (genericIndicators.includes('yellow')) {
        return 'yellow';
      } else {
        // If no bad indicators, default to green
        return 'green';
      }
    }

    // If a status exists but none of the keys provided an indicator, default to green
    return 'green';
  }

  /**
   * Map status text to indicator color
   * @param text Status text
   * @returns Indicator color ('green', 'red', 'yellow', 'gray')
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

  /**
   * Refresh CRD status schemas
   */
  public async refreshStatusSchemas(): Promise<void> {
    this.crdStatusSchemas.clear();
    await this.loadCrdStatusSchemas();
  }
}