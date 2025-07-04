// src/commands/resourceViewCommands.ts
import * as vscode from 'vscode';
import { log, LogLevel } from '../extension';
import { serviceManager } from '../services/serviceManager';
import { KubernetesClient } from '../clients/kubernetesClient';
import { EdaClient } from '../clients/edaClient';
import { ResourceViewDocumentProvider } from '../providers/documents/resourceViewProvider';
import { runKubectl } from '../utils/kubectlRunner';
import * as yaml from 'js-yaml';
import { stripManagedFieldsFromYaml, sanitizeResource } from '../utils/yamlUtils';

/**
 * Decide if the given apiVersion is an EDA group (ends with ".eda.nokia.com")
 */
function isEdaGroup(apiVersion: string | undefined): boolean {
  if (!apiVersion) return false;
  const group = apiVersion.split('/')[0];
  return group.endsWith('.eda.nokia.com');
}

/**
 * Get API version based on resource kind using a pattern
 */
function getApiVersionForKind(kind: string): string {
  // Standard Kubernetes resources need specific handling
  const k8sResources: Record<string, string> = {
    'Pod': 'v1',
    'Service': 'v1',
    'Deployment': 'apps/v1',
    'ConfigMap': 'v1',
    'Secret': 'v1',
    'Node': 'v1'
  };

  // Check if it's a standard K8s resource
  if (k8sResources[kind]) {
    return k8sResources[kind];
  }
  const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
  const crds = k8sClient.getCachedCrds();

  // Case-insensitive matching
  const matchingCrd = crds.find(crd =>
    crd.spec?.names?.kind.toLowerCase() === kind.toLowerCase()
  );

  if (matchingCrd) {
    // Get actual group and version from CRD
    const group = matchingCrd.spec?.group || '';
  const version = matchingCrd.spec?.versions?.find((v: any) => v.served)?.name ||
                      matchingCrd.spec?.versions?.[0]?.name || 'v1alpha1';
    return `${group}/${version}`;
  }

  // Fallback to original behavior if nothing found
  let plural = kind.toLowerCase();
  // Plural generation logic...
  return `${plural}.eda.nokia.com/v1alpha1`;
}

export function registerResourceViewCommands(
  context: vscode.ExtensionContext,
  resourceViewProvider: ResourceViewDocumentProvider
) {
  /**
   * Main command: opens a resource in read-only YAML view.
   *  - If apiVersion ends with ".eda.nokia.com", we fetch it via the EDA API.
   *  - Otherwise we use `kubectl get ... -o yaml`.
   */
  const viewResourceCmd = vscode.commands.registerCommand(
    'vscode-eda.viewResource',
    async (treeItem: any) => {
      try {
        log(`Processing resource view command`, LogLevel.DEBUG);

        // Debug log key properties without circular references
        if (treeItem) {
          log(`Tree item label: ${treeItem.label}`, LogLevel.DEBUG);
          log(`Tree item namespace: ${treeItem.namespace}`, LogLevel.DEBUG);
          log(`Tree item resourceType: ${treeItem.resourceType}`, LogLevel.DEBUG);
          log(`Tree item contextValue: ${treeItem.contextValue}`, LogLevel.DEBUG);
        }

        // Extract resource information safely - improved approach
        let resourceKind: string | undefined;
        let resourceName: string | undefined;
        let resourceNamespace: string | undefined;
        let possibleApiVersion: string | undefined;

        // Try multiple ways to extract resource information
        if (treeItem) {
          // First try direct properties - these are most reliable
          resourceName = typeof treeItem.label === 'string' ? treeItem.label : undefined;
          resourceNamespace = treeItem.namespace;

          // For pod, use 'Pod' as kind
          if (treeItem.contextValue === 'pod') {
            resourceKind = 'Pod';
          }
          // For other resources, use resourceType
          else if (treeItem.resourceType) {
            resourceKind = treeItem.resourceType.charAt(0).toUpperCase() + treeItem.resourceType.slice(1);
          }

          // If we have raw resource data, try to extract apiVersion and any missing info
          if (treeItem.resource?.raw) {
            possibleApiVersion = treeItem.resource.raw.apiVersion;

            // If we couldn't get kind from context or resourceType, try from raw
            if (!resourceKind && treeItem.resource.raw.kind) {
              resourceKind = treeItem.resource.raw.kind;
            }

            // If we couldn't get name from label, try from raw
            if (!resourceName && treeItem.resource.raw.metadata?.name) {
              resourceName = treeItem.resource.raw.metadata.name;
            }

            // If we couldn't get namespace, try from raw
            if (!resourceNamespace && treeItem.resource.raw.metadata?.namespace) {
              resourceNamespace = treeItem.resource.raw.metadata.namespace;
            }
          }

          log(`Resource info: ${resourceKind}/${resourceName} in ${resourceNamespace}`, LogLevel.DEBUG);
        }

        // Validate we have the minimum required information
        if (!resourceKind || !resourceName || !resourceNamespace) {
          vscode.window.showErrorMessage(`Invalid resource: missing kind, name, or namespace.
            Kind: ${resourceKind}, Name: ${resourceName}, Namespace: ${resourceNamespace}`);
          return;
        }

        // 2) If we have an apiVersion and it looks EDA, use the EDA client
        let finalYaml = '';
        const edaClient = serviceManager.getClient<EdaClient>('eda');

        if (possibleApiVersion && isEdaGroup(possibleApiVersion)) {
          // If recognized as EDA, fetch via the API
          log(`Detected EDA group from apiVersion=${possibleApiVersion}. Fetching via EDA API...`, LogLevel.DEBUG);

          try {
            const edaYaml = await edaClient.getEdaResourceYaml(resourceKind, resourceName, resourceNamespace);

            const hasApiVersion = edaYaml.includes('apiVersion:');
            if (!hasApiVersion) {
              const apiVersion = getApiVersionForKind(resourceKind);
              log(`Adding missing apiVersion: ${apiVersion} to EDA YAML`, LogLevel.INFO);
              finalYaml = `apiVersion: ${apiVersion}\n${edaYaml}`;
            } else {
              finalYaml = edaYaml;
            }
          } catch (error) {
            log(`Error fetching resource via EDA API: ${error}`, LogLevel.ERROR);
            finalYaml = `# Error fetching ${resourceKind}/${resourceName}: ${error}`;
          }
        }
        else {
          const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');

          if (resourceKind.toLowerCase() === 'artifact' && k8sClient) {
            log(`Fetching artifact ${resourceName} via Kubernetes API`, LogLevel.DEBUG);
            try {
              finalYaml = await k8sClient.getArtifactYaml(resourceName, resourceNamespace);
            } catch (error) {
              log(`Error fetching artifact via K8s API: ${error}`, LogLevel.ERROR);
              finalYaml = `# Error fetching ${resourceKind}/${resourceName}: ${error}`;
            }
          } else if (resourceKind.toLowerCase() === 'engineconfig' && k8sClient) {
            log(`Fetching engineconfig ${resourceName} via Kubernetes API`, LogLevel.DEBUG);
            try {
              finalYaml = await k8sClient.getEngineconfigYaml(resourceName, resourceNamespace);
            } catch (error) {
              log(`Error fetching engineconfig via K8s API: ${error}`, LogLevel.ERROR);
              finalYaml = `# Error fetching ${resourceKind}/${resourceName}: ${error}`;
            }
          } else {
            // 3) For standard K8s resources, just use kubectl
            log(`Using kubectl get -o yaml for ${resourceKind}/${resourceName}...`, LogLevel.DEBUG);
            try {
              finalYaml = runKubectl(
                'kubectl',
                ['get', resourceKind.toLowerCase(), resourceName, '-o', 'yaml'],
                { namespace: resourceNamespace }
              );
            } catch (error) {
              log(`Error fetching resource with kubectl: ${error}`, LogLevel.ERROR);
              finalYaml = `# Error fetching ${resourceKind}/${resourceName}:\n# ${error}`;
            }
          }
        }

        finalYaml = stripManagedFieldsFromYaml(finalYaml);

        if (!finalYaml || finalYaml.trim().length === 0) {
          finalYaml = `# No data found for ${resourceKind}/${resourceName} in namespace ${resourceNamespace}`;
        }

        // 5) Create a read-only k8s-view URI to hold the text
        const viewUri = vscode.Uri.parse(
          `k8s-view:/${resourceNamespace}/${resourceKind}/${resourceName}?ts=${Date.now()}`
        );
        // Store the content in the ResourceViewDocumentProvider
        resourceViewProvider.setResourceContent(viewUri, finalYaml);

        // 6) Show the doc in an editor with YAML highlighting
        const doc = await vscode.workspace.openTextDocument(viewUri);
        await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
        await vscode.window.showTextDocument(doc, { preview: true });

      } catch (error: any) {
        log(`Failed to open resource in YAML view: ${error}`, LogLevel.ERROR, true);
        vscode.window.showErrorMessage(`Error viewing resource: ${error}`);
      }
    }
  );

  const viewStreamItemCmd = vscode.commands.registerCommand(
    'vscode-eda.viewStreamItem',
    async (arg: any) => {
      try {
        // Handle both sanitized ResourceData objects and TreeItem objects
        const resource = arg?.raw || arg?.rawResource || arg?.resource?.raw;
        if (!resource) {
          vscode.window.showErrorMessage('No data available for this item');
          return;
        }

        const namespace =
          resource.metadata?.namespace || arg.namespace || 'default';
        const kind =
          resource.kind || arg.resourceType || arg.kind || 'Resource';
        const name = resource.metadata?.name || arg.name || arg.label || 'unknown';

        const yamlText = yaml.dump(sanitizeResource(resource), { indent: 2 });

        const viewUri = vscode.Uri.parse(
          `k8s-view:/${namespace}/${kind}/${name}?ts=${Date.now()}`
        );
        resourceViewProvider.setResourceContent(viewUri, yamlText);

        const doc = await vscode.workspace.openTextDocument(viewUri);
        await vscode.languages.setTextDocumentLanguage(doc, 'yaml');
        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (error: any) {
        log(`Failed to open stream item: ${error}`, LogLevel.ERROR, true);
        vscode.window.showErrorMessage(`Error viewing stream item: ${error}`);
      }
    }
  );

  context.subscriptions.push(viewResourceCmd, viewStreamItemCmd);
}