// src/commands/resourceViewCommands.ts

import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { log, LogLevel } from '../extension';
import { serviceManager } from '../services/serviceManager';
import { KubernetesClient } from '../clients/kubernetesClient';
import { EdactlClient } from '../clients/edactlClient';
import { ResourceViewDocumentProvider } from '../providers/documents/resourceViewProvider';
import { runKubectl } from '../utils/kubectlRunner';

/**
 * Decide if the given apiVersion is an EDA group (ends with ".eda.nokia.com")
 */
function isEdaGroup(apiVersion: string | undefined): boolean {
  if (!apiVersion) return false;
  const group = apiVersion.split('/')[0];
  return group.endsWith('.eda.nokia.com');
}

export function registerResourceViewCommands(
  context: vscode.ExtensionContext,
  resourceViewProvider: ResourceViewDocumentProvider
) {
  /**
   * Main command: opens a resource in read-only YAML view.
   *  - If apiVersion ends with ".eda.nokia.com", we try `edactl get ... -o yaml`.
   *  - Otherwise we do `kubectl get ... -o yaml`.
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

        // 2) If we have an apiVersion and it looks EDA, try edactl first
        let finalYaml = '';
        const edactlClient = serviceManager.getClient<EdactlClient>('edactl');

        if (possibleApiVersion && isEdaGroup(possibleApiVersion)) {
          // If recognized as EDA, attempt an edactl fetch:
          log(`Detected EDA group from apiVersion=${possibleApiVersion}. Trying edactl...`,
              LogLevel.DEBUG);

          const edaYaml = await edactlClient.getEdaResourceYaml(resourceKind, resourceName, resourceNamespace);
          if (edaYaml) {
            finalYaml = edaYaml;
          } else {
            // If edactl returned empty, fallback to kubectl
            log(`edactl returned no YAML, falling back to kubectl get -o yaml...`, LogLevel.DEBUG);
            finalYaml = runKubectl(
              'kubectl',
              ['get', resourceKind.toLowerCase(), resourceName, '-o', 'yaml'],
              { namespace: resourceNamespace }
            );
          }
        }
        else {
          // 3) For standard K8s resources, just use kubectl
          log(`Using kubectl get -o yaml for ${resourceKind}/${resourceName}...`, LogLevel.DEBUG);
          finalYaml = runKubectl(
            'kubectl',
            ['get', resourceKind.toLowerCase(), resourceName, '-o', 'yaml'],
            { namespace: resourceNamespace }
          );
        }

        if (!finalYaml) {
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
        await vscode.window.showTextDocument(doc, { preview: false });

      } catch (error: any) {
        log(`Failed to open resource in YAML view: ${error}`, LogLevel.ERROR, true);
        vscode.window.showErrorMessage(`Error viewing resource: ${error}`);
      }
    }
  );

  context.subscriptions.push(viewResourceCmd);
}