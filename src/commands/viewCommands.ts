// src/commands/viewCommands.ts
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { createPatch } from 'diff';

import type { EdaClient } from '../clients/edaClient';
import { serviceManager } from '../services/serviceManager';
import type { KubernetesClient } from '../clients/kubernetesClient';
import { edaOutputChannel } from '../extension';
import type { CrdDefinitionFileSystemProvider } from '../providers/documents/crdDefinitionProvider';
import type { BasketTransactionDocumentProvider } from '../providers/documents/basketTransactionProvider';
import { TransactionDetailsPanel } from '../webviews/transactionDetails/transactionDetailsPanel';
import { AlarmDetailsPanel } from '../webviews/alarmDetails/alarmDetailsPanel';
import { DeviationDetailsPanel } from '../webviews/deviationDetails/deviationDetailsPanel';

// ============================================================================
// Type definitions for EDA API responses
// ============================================================================

/** Kubernetes-style metadata */
interface K8sMetadata {
  name: string;
  namespace?: string;
  uid?: string;
}

/** Resource name with GVK (Group/Version/Kind) */
interface ResourceName {
  gvk: {
    group?: string;
    version?: string;
    kind: string;
  };
  name: string;
  namespace: string;
}

/** Input CR for a transaction */
interface InputCr {
  name: ResourceName;
  isDelete?: boolean;
}

/** Changed CR in a transaction */
interface ChangedCr {
  name?: ResourceName;
  group?: string;
  version?: string;
  kind?: string;
  namespace?: string;
}

/** Node with config changes in a transaction */
interface NodeConfigChange {
  node?: string;
  namespace?: string;
}

/** Intent run in a transaction */
interface IntentRun {
  name?: string;
  status?: string;
}

/** General error in a transaction */
interface GeneralError {
  message?: string;
  code?: string;
}

/** Transaction summary response from EDA API */
interface TransactionSummary {
  id: string | number;
  state?: string;
  username?: string;
  description?: string;
  dryRun?: boolean;
  success?: boolean;
}

/** Transaction details response from EDA API */
interface TransactionDetails extends TransactionSummary {
  inputCrs?: InputCr[];
  changedCrs?: ChangedCr[];
  nodesWithConfigChanges?: NodeConfigChange[];
  intentsRun?: IntentRun[];
  generalErrors?: GeneralError[];
}

/** Deviation resource from EDA API */
interface Deviation {
  name?: string;
  kind?: string;
  apiVersion?: string;
  namespace?: string;
  'namespace.name'?: string;
  metadata?: K8sMetadata;
  spec?: {
    intendedValues?: string;
    runningValues?: string;
  };
}

/** Alarm resource from EDA API */
interface Alarm {
  name?: string;
  kind?: string;
  type?: string;
  severity?: string;
  namespace?: string;
  '.namespace.name'?: string;
  'namespace.name'?: string;
  group?: string;
  sourceGroup?: string;
  sourceKind?: string;
  sourceResource?: string;
  jspath?: string;
  parentAlarm?: string;
  probableCause?: string;
  remedialAction?: string;
  description?: string;
  resource?: string;
  clusterSpecific?: string;
}

/** Alarm argument (may wrap alarm in .alarm property) */
interface AlarmArg {
  alarm?: Alarm;
}

/** CRD spec.names structure */
interface CrdNames {
  kind: string;
  plural?: string;
  singular?: string;
}

/** CRD spec structure */
interface CrdSpec {
  names?: CrdNames;
}

/** Kubernetes CRD resource */
interface CrdResource {
  metadata?: K8sMetadata;
  spec?: CrdSpec;
}

/** Tree item with resource information */
interface ResourceTreeItem {
  resource?: {
    kind?: string;
    name?: string;
    namespace?: string;
  };
}

/**
 * Extracts deviation name and namespace from the deviation object.
 */
function extractDeviationIdentity(deviation: Deviation): { name: string; namespace: string } {
  const name = deviation.name ?? deviation.metadata?.name ?? '';
  const namespace = deviation["namespace.name"] ?? deviation.namespace ?? deviation.metadata?.namespace ?? '';
  return { name, namespace };
}

/**
 * Computes a diff between intended and running values.
 * Returns the diff string starting from the @@ markers, or undefined if no diff.
 */
function computeValuesDiff(deviation: Deviation): string | undefined {
  try {
    const intended: unknown = deviation.spec?.intendedValues
      ? JSON.parse(deviation.spec.intendedValues)
      : {};
    const running: unknown = deviation.spec?.runningValues
      ? JSON.parse(deviation.spec.runningValues)
      : {};

    let intendedYaml = yaml.dump(intended, { indent: 2 });
    let runningYaml = yaml.dump(running, { indent: 2 });
    if (intendedYaml.trim() === '{}') {
      intendedYaml = '';
    }
    if (runningYaml.trim() === '{}') {
      runningYaml = '';
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- diff package types not resolving correctly with node10 moduleResolution
    const patch: string = createPatch('values', intendedYaml, runningYaml);
    const lines: string[] = patch.split('\n');
    const start = lines.findIndex((l: string) => l.startsWith('@@'));
    if (start !== -1) {
      return lines.slice(start).join('\n').trim();
    }
  } catch (err) {
    console.error('Failed to compute deviation diff', err);
  }
  return undefined;
}

/**
 * Fetches resource YAML for a deviation from the EDA API.
 */
async function fetchDeviationYaml(
  edaClient: EdaClient,
  name: string,
  namespace: string
): Promise<{ yaml?: string; error?: string }> {
  try {
    const resourceYaml = await edaClient.getEdaResourceYaml('deviation', name, namespace);
    return { yaml: resourceYaml };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerViewCommands(
  context: vscode.ExtensionContext,
  crdFsProvider: CrdDefinitionFileSystemProvider,
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
          edaClient.getTransactionDetails(transactionId) as Promise<TransactionDetails>,
          edaClient.getTransactionSummary(transactionId) as Promise<TransactionSummary>
        ]);

        const mergedObj: TransactionDetails = { ...summaryObj, ...detailsObj };

        const success = mergedObj.success ? 'Yes' : 'No';
        const successColor = mergedObj.success ? '#2ECC71' : '#E74C3C';

        const deletedInputs: InputCr[] = Array.isArray(mergedObj.inputCrs)
          ? mergedObj.inputCrs.filter((cr: InputCr) => cr.isDelete)
          : [];
        const deletedSummary = deletedInputs.map(
          (cr: InputCr) =>
            `${cr.name.gvk.kind} ${cr.name.name} (namespace: ${cr.name.namespace})`
        );

        const templateVars: Record<string, unknown> = {
          id: mergedObj.id,
          state: mergedObj.state,
          username: mergedObj.username,
          description: mergedObj.description ?? 'N/A',
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
          intentsRun: Array.isArray(mergedObj.intentsRun)
            ? mergedObj.intentsRun
            : [],
          generalErrors: mergedObj.generalErrors,
          rawJson: JSON.stringify(mergedObj, null, 2)
        };

        // Generate transaction details webview
        TransactionDetailsPanel.show(context, templateVars);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const msg = `Failed to load transaction details for ID ${transactionId}: ${errMsg}`;
        vscode.window.showErrorMessage(msg);
        edaOutputChannel.appendLine(msg);
      }
    }
  );

  // Show CRD Definition command
  const showCRDDefinitionCommand = vscode.commands.registerCommand(
    'vscode-eda.showCRDDefinition',
    async (treeItem: ResourceTreeItem) => {
      try {
        if (!treeItem?.resource?.kind) {
          vscode.window.showErrorMessage('No CRD instance or missing kind.');
          return;
        }
        const { kind } = treeItem.resource;
        const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');

        // Get CRD YAML
        const matchingCrds = (k8sClient.getCachedCrds() as CrdResource[])
          .filter((crd: CrdResource) => crd.spec?.names?.kind === kind);

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
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to show CRD definition: ${errMsg}`);
        edaOutputChannel.appendLine(`Error showing CRD definition: ${String(error)}`);
      }
    }
  );

  // Show alarm details using a webview
  vscode.commands.registerCommand('vscode-eda.showAlarmDetails', (arg: Alarm | AlarmArg) => {
    // arg may be an Alarm directly or an object wrapping it in .alarm
    const alarm: Alarm | undefined = (arg as AlarmArg).alarm ?? (arg as Alarm);
    if (!alarm) {
      vscode.window.showErrorMessage('No alarm details available.');
      return;
    }

    const data: Record<string, unknown> = {
      name: alarm.name,
      kind: alarm.kind,
      type: alarm.type,
      severity: alarm.severity,
      namespace:
        alarm[".namespace.name"] ??
        alarm["namespace.name"] ??
        alarm.namespace,
      group: alarm.group,
      sourceGroup: alarm.sourceGroup,
      sourceKind: alarm.sourceKind,
      sourceResource: alarm.sourceResource,
      jspath: alarm.jspath,
      parentAlarm: alarm.parentAlarm ?? 'N/A',
      probableCause: alarm.probableCause,
      remedialAction: alarm.remedialAction,
      description: alarm.description,
      resource: alarm.resource,
      clusterSpecific: alarm.clusterSpecific ?? 'N/A',
      rawJson: JSON.stringify(alarm, null, 2)
    };

    AlarmDetailsPanel.show(context, data);
  });

  // Show deviation details using a webview
  vscode.commands.registerCommand('vscode-eda.showDeviationDetails', async (deviation: Deviation) => {
    if (!deviation) {
      vscode.window.showErrorMessage('No deviation details available.');
      return;
    }

    try {
      const { name, namespace } = extractDeviationIdentity(deviation);
      const edaClient = serviceManager.getClient<EdaClient>('eda');

      const panelData: Record<string, unknown> = {
        name,
        kind: deviation.kind ?? 'Deviation',
        apiVersion: deviation.apiVersion ?? 'v1',
        namespace,
        status: typeof (deviation as Record<string, unknown>).status === 'string'
          ? (deviation as Record<string, unknown>).status
          : 'Unknown',
        rawJson: JSON.stringify(deviation, null, 2)
      };

      // Compute diff between intended and running values if present
      const valueDiff = computeValuesDiff(deviation);
      if (valueDiff) {
        panelData.valueDiff = valueDiff;
      }

      // Fetch the YAML for the deviation
      const yamlResult = await fetchDeviationYaml(edaClient, name, namespace);
      if (yamlResult.yaml) {
        panelData.resourceYaml = yamlResult.yaml;
      } else if (yamlResult.error) {
        panelData.errorMessage = yamlResult.error;
      }

      DeviationDetailsPanel.show(context, panelData);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to load deviation details: ${errMsg}`);
    }
  });

  const showBasketTxCommand = vscode.commands.registerCommand('vscode-eda.showBasketTransaction', async (tx: unknown) => {
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
