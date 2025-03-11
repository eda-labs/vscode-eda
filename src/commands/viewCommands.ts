// src/commands/viewCommands.ts (using improved template loader)
import * as vscode from 'vscode';
import { edaOutputChannel } from '../extension.js';
import { CrdDefinitionFileSystemProvider } from '../providers/documents/crdDefinitionProvider';
import { TransactionDetailsDocumentProvider } from '../providers/documents/transactionDetailsProvider';
import { alarmDetailsProvider, deviationDetailsProvider } from '../extension.js';
import { loadTemplate } from '../utils/templateLoader';
import { serviceManager } from '../services/serviceManager';
import { EdaService } from '../services/edaService';
import { CrdService } from '../services/crdService';
import { ResourceService } from '../services/resourceService';

export function registerViewCommands(
  context: vscode.ExtensionContext,
  crdFsProvider: CrdDefinitionFileSystemProvider,
  transactionDetailsProvider?: TransactionDetailsDocumentProvider
) {
  // Get services
  const edaService = serviceManager.getService<EdaService>('eda');
  const crdService = serviceManager.getService<CrdService>('crd');
  const resourceService = serviceManager.getService<ResourceService>('resource');

  // Show transaction details command (unchanged)
  const showTransactionDetailsCommand = vscode.commands.registerCommand(
    'vscode-eda.showTransactionDetails',
    async (transactionId: string) => {
      if (!transactionId) {
        vscode.window.showErrorMessage('No transaction ID provided.');
        return;
      }

      try {
        // 1) Retrieve text from "edactl transaction <id>"
        const detailsText = await edaService.getEdaTransactionDetails(transactionId);

        // If no read-only provider was given, fallback to older approach
        if (!transactionDetailsProvider) {
          // fallback: open ephemeral doc
          const doc = await vscode.workspace.openTextDocument({
            content: detailsText,
            language: 'yaml'
          });
          await vscode.window.showTextDocument(doc, { preview: false });
          return;
        }

        // 2) Create a "eda-transaction:" URI for read-only
        const docUri = vscode.Uri.parse(
          `eda-transaction:/${transactionId}?ts=${Date.now()}`
        );

        // 3) Store the text in the read-only provider
        transactionDetailsProvider.setTransactionContent(docUri, detailsText);

        // 4) Open the doc
        const doc = await vscode.workspace.openTextDocument(docUri);

        // 5) Optionally force syntax highlighting:
        // "log" is a good approximation for this multiline text
        // or "plaintext" if you prefer
        await vscode.languages.setTextDocumentLanguage(doc, 'log');

        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err: any) {
        const msg = `Failed to load transaction details for ID ${transactionId}: ${err.message}`;
        vscode.window.showErrorMessage(msg);
        edaOutputChannel.appendLine(msg);
      }
    }
  );

  // Show CRD Definition command (unchanged)
  const showCRDDefinitionCommand = vscode.commands.registerCommand('vscode-eda.showCRDDefinition', async (treeItem: any) => {
    try {
      if (!treeItem?.resource?.kind) {
        vscode.window.showErrorMessage('No CRD instance or missing kind.');
        return;
      }
      const { kind } = treeItem.resource;

      // 1) Get the YAML from crdService
      const crdYaml = await crdService.getCrdYamlForKind(kind);

      // 2) Create a unique crd: URI
      //    e.g. crd:/Interface?random=...
      //    If multiple CRDs share the same kind, we can add a random query param
      const crdUri = vscode.Uri.parse(`crd:/${kind}?ts=${Date.now()}`);

      // 3) Store the YAML in the read-only FS
      crdFsProvider.setCrdYaml(crdUri, crdYaml);

      // 4) Open the doc
      const doc = await vscode.workspace.openTextDocument(crdUri);

      // 5) Force YAML highlighting (in case VS Code doesn't auto-detect)
      await vscode.languages.setTextDocumentLanguage(doc, 'yaml');

      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to show CRD definition: ${error.message || error}`);
      edaOutputChannel.appendLine(`Error showing CRD definition: ${error}`);
    }
  });

  // Show alarm details using Handlebars template
  vscode.commands.registerCommand('vscode-eda.showAlarmDetails', async (arg: any) => {
    const alarm = arg && arg.alarm ? arg.alarm : arg;
    if (!alarm) {
      vscode.window.showErrorMessage('No alarm details available.');
      return;
    }

    try {
      // Determine severity color
      const severity = alarm.severity ? alarm.severity.toLowerCase() : 'info';
      let severityColor = '#3498DB'; // blue (default)
      switch (severity) {
        case 'critical':
          severityColor = '#E74C3C'; // red
          break;
        case 'major':
          severityColor = '#E67E22'; // orange
          break;
        case 'minor':
          severityColor = '#F1C40F'; // yellow
          break;
      }

      // Prepare variables for the template
      const templateVars = {
        name: alarm.name,
        kind: alarm.kind,
        type: alarm.type,
        severity: alarm.severity,
        severityColor,
        namespace: alarm["namespace.name"],
        group: alarm.group,
        sourceGroup: alarm.sourceGroup,
        sourceKind: alarm.sourceKind,
        sourceResource: alarm.sourceResource,
        jspath: alarm.jspath,
        parentAlarm: alarm.parentAlarm || 'N/A',
        probableCause: alarm.probableCause,
        remedialAction: alarm.remedialAction,
        description: alarm.description,
        resource: alarm.resource,
        clusterSpecific: alarm.clusterSpecific || 'N/A'
      };

      // Render the template
      const detailsText = loadTemplate('alarm', context, templateVars);

      // Create a unique URI for this alarm document
      const docUri = vscode.Uri.parse(`eda-alarm:/${alarm.name}?ts=${Date.now()}`);
      alarmDetailsProvider.setAlarmContent(docUri, detailsText);

      // Open the markdown preview
      await vscode.commands.executeCommand("markdown.showPreview", docUri);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to load alarm details: ${error.message || error}`);
    }
  });


  // Show deviation details using markdown template
  vscode.commands.registerCommand('vscode-eda.showDeviationDetails', async (deviation: any) => {
    if (!deviation) {
      vscode.window.showErrorMessage('No deviation details available.');
      return;
    }

    try {
      const name = deviation.name;
      const kind = deviation.kind || 'Deviation';
      const namespace = deviation["namespace.name"];

      // Prepare base template variables
      const templateVars: Record<string, any> = {
        name: deviation.name,
        kind: deviation.kind || 'Deviation',
        apiVersion: deviation.apiVersion || 'v1',
        namespace: deviation["namespace.name"]
      };

      try {
        // Fetch the YAML for the deviation
        const resourceYaml = await resourceService.getResourceYaml(kind, name, namespace);
        templateVars.resourceYaml = resourceYaml;
      } catch (error) {
        // Add error message if we couldn't get the YAML
        templateVars.errorMessage = error instanceof Error ? error.message : String(error);
      }

      // Load and process the template using Handlebars
      const detailsText = loadTemplate('deviation', context, templateVars);

      // Create a unique URI for this deviation document
      const docUri = vscode.Uri.parse(`eda-deviation:/${name}?ts=${Date.now()}`);
      deviationDetailsProvider.setDeviationContent(docUri, detailsText);

      // Open markdown preview
      await vscode.commands.executeCommand("markdown.showPreview", docUri);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to load deviation details: ${error.message || error}`);
    }
  });

  context.subscriptions.push(showTransactionDetailsCommand, showCRDDefinitionCommand);
}