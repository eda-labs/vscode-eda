// src/commands/viewCommands.ts
import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { EdactlClient } from '../clients/edactlClient';
import { KubernetesClient } from '../clients/kubernetesClient';
import { edaOutputChannel } from '../extension';
import { CrdDefinitionFileSystemProvider } from '../providers/documents/crdDefinitionProvider';
import { TransactionDetailsDocumentProvider } from '../providers/documents/transactionDetailsProvider';
import { AlarmDetailsDocumentProvider } from '../providers/documents/alarmDetailsProvider';
import { DeviationDetailsDocumentProvider } from '../providers/documents/deviationDetailsProvider';
import { loadTemplate } from '../utils/templateLoader';

export function registerViewCommands(
  context: vscode.ExtensionContext,
  crdFsProvider: CrdDefinitionFileSystemProvider,
  transactionDetailsProvider: TransactionDetailsDocumentProvider,
  alarmDetailsProvider: AlarmDetailsDocumentProvider,
  deviationDetailsProvider: DeviationDetailsDocumentProvider
) {
  // Show transaction details command
  const showTransactionDetailsCommand = vscode.commands.registerCommand(
    'vscode-eda.showTransactionDetails',
    async (transactionId: string) => {
      if (!transactionId) {
        vscode.window.showErrorMessage('No transaction ID provided.');
        return;
      }

      try {
        // Get EdactlClient from service manager
        const edactlClient = serviceManager.getClient<EdactlClient>('edactl');

        // Retrieve text from "edactl transaction <id>"
        const detailsText = await edactlClient.getTransactionDetails(transactionId);

        // Create a "eda-transaction:" URI for read-only
        const docUri = vscode.Uri.parse(
          `eda-transaction:/${transactionId}?ts=${Date.now()}`
        );

        // Store the text in the read-only provider
        transactionDetailsProvider.setTransactionContent(docUri, detailsText);

        // Open the doc
        const doc = await vscode.workspace.openTextDocument(docUri);

        // Force syntax highlighting to "log" format
        await vscode.languages.setTextDocumentLanguage(doc, 'log');

        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (err: any) {
        const msg = `Failed to load transaction details for ID ${transactionId}: ${err.message}`;
        vscode.window.showErrorMessage(msg);
        edaOutputChannel.appendLine(msg);
      }
    }
  );

  // Show CRD Definition command
  const showCRDDefinitionCommand = vscode.commands.registerCommand(
    'vscode-eda.showCRDDefinition',
    async (treeItem: any) => {
      try {
        if (!treeItem?.resource?.kind) {
          vscode.window.showErrorMessage('No CRD instance or missing kind.');
          return;
        }
        const { kind } = treeItem.resource;
        const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');

        // Get CRD YAML
        const matchingCrds = k8sClient.getCachedCrds()
          .filter((crd: any) => crd.spec?.names?.kind === kind);

        if (!matchingCrds || matchingCrds.length === 0) {
          vscode.window.showErrorMessage(`Could not find CRD for kind "${kind}"`);
          return;
        }

        const crdYaml = JSON.stringify(matchingCrds[0], null, 2);

        // Create a unique crd: URI
        const crdUri = vscode.Uri.parse(`crd:/${kind}?ts=${Date.now()}`);

        // Store the YAML in the read-only FS
        crdFsProvider.setCrdYaml(crdUri, crdYaml);

        // Open the doc
        const doc = await vscode.workspace.openTextDocument(crdUri);

        // Force YAML highlighting
        await vscode.languages.setTextDocumentLanguage(doc, 'yaml');

        await vscode.window.showTextDocument(doc, { preview: true });
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to show CRD definition: ${error.message || error}`);
        edaOutputChannel.appendLine(`Error showing CRD definition: ${error}`);
      }
    }
  );

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
      const namespace = deviation["namespace.name"];
      const edactlClient = serviceManager.getClient<EdactlClient>('edactl');

      // Prepare base template variables
      const templateVars: Record<string, any> = {
        name: deviation.name,
        kind: deviation.kind || 'Deviation',
        apiVersion: deviation.apiVersion || 'v1',
        namespace: deviation["namespace.name"]
      };

      try {
        // Fetch the YAML for the deviation
        const resourceYaml = await edactlClient.executeEdactl(`get deviation ${name} -n ${namespace} -o yaml`);
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