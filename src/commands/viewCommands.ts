// src/commands/viewCommands.ts
import * as vscode from 'vscode';
import { serviceManager } from '../services/serviceManager';
import { EdaClient } from '../clients/edaClient';
import * as yaml from 'js-yaml';
const Diff: any = require('diff');
import { KubernetesClient } from '../clients/kubernetesClient';
import { edaOutputChannel } from '../extension';
import { CrdDefinitionFileSystemProvider } from '../providers/documents/crdDefinitionProvider';
import { DeviationDetailsDocumentProvider } from '../providers/documents/deviationDetailsProvider';
import { BasketTransactionDocumentProvider } from '../providers/documents/basketTransactionProvider';
import { loadTemplate } from '../utils/templateLoader';
import { TransactionDetailsPanel } from '../webviews/transactionDetails/transactionDetailsPanel';
import { AlarmDetailsPanel } from '../webviews/alarmDetails/alarmDetailsPanel';

export function registerViewCommands(
  context: vscode.ExtensionContext,
  crdFsProvider: CrdDefinitionFileSystemProvider,
  deviationDetailsProvider: DeviationDetailsDocumentProvider,
  basketProvider: BasketTransactionDocumentProvider
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
        // Get EdaClient from service manager
        const edaClient = serviceManager.getClient<EdaClient>('eda');

        // Retrieve transaction details and summary JSON
        const [detailsObj, summaryObj] = await Promise.all([
          edaClient.getTransactionDetails(transactionId),
          edaClient.getTransactionSummary(transactionId)
        ]);

        const mergedObj = { ...summaryObj, ...detailsObj } as any;

        const success = mergedObj.success ? 'Yes' : 'No';
        const successColor = mergedObj.success ? '#2ECC71' : '#E74C3C';

        const deletedInputs = Array.isArray(mergedObj.inputCrs)
          ? mergedObj.inputCrs.filter((cr: any) => cr.isDelete)
          : [];
        const deletedSummary = deletedInputs.map(
          (cr: any) =>
            `${cr.name.gvk.kind} ${cr.name.name} (namespace: ${cr.name.namespace})`
        );

        const templateVars: Record<string, any> = {
          id: mergedObj.id,
          state: mergedObj.state,
          username: mergedObj.username,
          description: mergedObj.description || 'N/A',
          deleteResources: deletedSummary,
          dryRun: mergedObj.dryRun ? 'Yes' : 'No',
          success,
          successColor,
          changedCrs: Array.isArray(mergedObj.changedCrs)
            ? mergedObj.changedCrs
            : [],
          inputCrs: Array.isArray(mergedObj.inputCrs)
            ? mergedObj.inputCrs
            : [],
          nodesWithConfigChanges: Array.isArray(mergedObj.nodesWithConfigChanges)
            ? mergedObj.nodesWithConfigChanges
            : [],
          generalErrors: mergedObj.generalErrors,
          rawJson: JSON.stringify(mergedObj, null, 2)
        };

        // Generate transaction details webview
        TransactionDetailsPanel.show(context, templateVars);
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

  // Show alarm details using a webview
  vscode.commands.registerCommand('vscode-eda.showAlarmDetails', async (arg: any) => {
    const alarm = arg && arg.alarm ? arg.alarm : arg;
    if (!alarm) {
      vscode.window.showErrorMessage('No alarm details available.');
      return;
    }

    const data = {
      name: alarm.name,
      kind: alarm.kind,
      type: alarm.type,
      severity: alarm.severity,
      namespace:
        alarm[".namespace.name"] ||
        alarm["namespace.name"] ||
        alarm.namespace,
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
      clusterSpecific: alarm.clusterSpecific || 'N/A',
      rawJson: JSON.stringify(alarm, null, 2)
    };

    AlarmDetailsPanel.show(context, data);
  });

  // Show deviation details using markdown template
  vscode.commands.registerCommand('vscode-eda.showDeviationDetails', async (deviation: any) => {
    if (!deviation) {
      vscode.window.showErrorMessage('No deviation details available.');
      return;
    }

    try {
      const name = deviation.name || deviation.metadata?.name;
      const namespace =
        deviation["namespace.name"] || deviation.namespace || deviation.metadata?.namespace;
      const edaClient = serviceManager.getClient<EdaClient>('eda');

      // Prepare base template variables
      const templateVars: Record<string, any> = {
        name,
        kind: deviation.kind || 'Deviation',
        apiVersion: deviation.apiVersion || 'v1',
        namespace
      };

      // Compute diff between intended and running values if present
      try {
        const intended = deviation.spec?.intendedValues
          ? JSON.parse(deviation.spec.intendedValues as string)
          : {};
        const running = deviation.spec?.runningValues
          ? JSON.parse(deviation.spec.runningValues as string)
          : {};

        let intendedYaml = yaml.dump(intended, { indent: 2 });
        let runningYaml = yaml.dump(running, { indent: 2 });
        if (intendedYaml.trim() === '{}') {
          intendedYaml = '';
        }
        if (runningYaml.trim() === '{}') {
          runningYaml = '';
        }
        const patch = Diff.createPatch('values', intendedYaml, runningYaml);
        const lines = patch.split('\n');
        const start = lines.findIndex((l: string) => l.startsWith('@@'));
        if (start !== -1) {
          templateVars.valueDiff = lines.slice(start).join('\n').trim();
        }
      } catch (err) {
        console.error('Failed to compute deviation diff', err);
      }

      try {
        // Fetch the YAML for the deviation
        const resourceYaml = await edaClient.getEdaResourceYaml('deviation', name, namespace);
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

  const showBasketTxCommand = vscode.commands.registerCommand('vscode-eda.showBasketTransaction', async (tx: any) => {
    if (!tx) {
      vscode.window.showErrorMessage('No transaction details available.');
      return;
    }
    const docUri = vscode.Uri.parse(`basket-tx:/${Date.now()}`);
    basketProvider.setContentForUri(docUri, JSON.stringify(tx, null, 2));
    const doc = await vscode.workspace.openTextDocument(docUri);
    await vscode.languages.setTextDocumentLanguage(doc, 'json');
    await vscode.window.showTextDocument(doc, { preview: true });
  });

  context.subscriptions.push(showTransactionDetailsCommand, showCRDDefinitionCommand, showBasketTxCommand);
}