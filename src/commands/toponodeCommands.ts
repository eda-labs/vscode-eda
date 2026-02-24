import * as vscode from 'vscode';

import { serviceManager } from '../services/serviceManager';
import type { EdaClient } from '../clients/edaClient';
import type { KubernetesClient } from '../clients/kubernetesClient';
import { log, LogLevel } from '../extension';

const NODE_DETAILS_KEY = 'node-details';

interface NodeDetailsStatus {
  [NODE_DETAILS_KEY]?: string;
}

interface TopoNodeInfo {
  name?: string;
  label?: string;
  namespace?: string;
  nodeDetails?: string;
  rawResource?: { status?: NodeDetailsStatus };
  resource?: {
    metadata?: { name?: string };
    raw?: { status?: NodeDetailsStatus };
    status?: NodeDetailsStatus;
  };
}

interface NodeUserBinding {
  nodes?: string[];
  nodeSelector?: string[];
}

interface NodeUser {
  spec?: {
    username?: string;
    groupBindings?: NodeUserBinding[];
  };
  metadata?: { name?: string };
}

interface TopoNode {
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
  };
  status?: NodeDetailsStatus;
}

function extractNodeName(info: TopoNodeInfo): string | undefined {
  return info?.name || info?.label || info?.resource?.metadata?.name;
}

function extractNodeDetails(info: TopoNodeInfo): string | undefined {
  return (
    info?.nodeDetails ||
    info?.rawResource?.status?.[NODE_DETAILS_KEY] ||
    info?.resource?.raw?.status?.[NODE_DETAILS_KEY] ||
    info?.resource?.status?.[NODE_DETAILS_KEY]
  );
}

function matchesBinding(
  binding: NodeUserBinding,
  nodeName: string,
  labels: Record<string, string>
): boolean {
  if (Array.isArray(binding.nodes) && binding.nodes.includes(nodeName)) {
    return true;
  }
  if (Array.isArray(binding.nodeSelector)) {
    return binding.nodeSelector.some((sel: string) => {
      const [k, v] = sel.split('=');
      return labels[k] === v;
    });
  }
  return false;
}

function findMatchingUser(
  users: NodeUser[],
  nodeName: string,
  labels: Record<string, string>
): string | undefined {
  for (const user of users) {
    const bindings = Array.isArray(user.spec?.groupBindings)
      ? user.spec.groupBindings
      : [];
    const match = bindings.some((b) => matchesBinding(b, nodeName, labels));
    if (match) {
      return user.spec?.username || user.metadata?.name;
    }
  }
  return undefined;
}

async function determineUsername(
  edaClient: EdaClient,
  nodeNs: string,
  nodeName: string
): Promise<{ username: string; found: boolean }> {
  try {
    const [node, users] = await Promise.all([
      edaClient.getTopoNode(nodeNs, nodeName) as Promise<TopoNode>,
      edaClient.listNodeUsers(nodeNs) as Promise<NodeUser[]>
    ]);
    const labels: Record<string, string> = node?.metadata?.labels ?? {};
    const matchedUsername = findMatchingUser(users, nodeName, labels);
    if (matchedUsername) {
      return { username: matchedUsername, found: true };
    }
  } catch (err) {
    log(`Failed to fetch NodeUser for node ${nodeName}: ${err}`, LogLevel.DEBUG);
  }
  return { username: 'admin', found: false };
}

async function fetchNodeDetailsFromApi(
  edaClient: EdaClient,
  nodeNs: string,
  nodeName: string
): Promise<string | undefined> {
  try {
    const node = await edaClient.getTopoNode(nodeNs, nodeName) as TopoNode;
    const nodeDetails = node?.status?.[NODE_DETAILS_KEY];
    if (typeof nodeDetails === 'string' && nodeDetails.length > 0) {
      return nodeDetails;
    }
  } catch (err) {
    log(`Failed to fetch node details for ${nodeName}: ${err}`, LogLevel.DEBUG);
  }
  return undefined;
}

function getKubectlContext(): string {
  try {
    if (serviceManager.getClientNames().includes('kubernetes')) {
      const k8sClient = serviceManager.getClient<KubernetesClient>('kubernetes');
      const ctx = k8sClient.getCurrentContext();
      if (ctx && ctx !== 'none') {
        return `--context ${ctx}`;
      }
    }
  } catch {
    /* ignore */
  }
  return '';
}

function buildSshCommand(
  coreNs: string,
  kubectlContext: string,
  username: string,
  host: string
): string {
  const nsFlag = `-n ${coreNs}`;
  const flags = [nsFlag, kubectlContext].filter(Boolean).join(' ');
  return `kubectl ${flags} exec -it $(kubectl ${flags} get pods -l eda.nokia.com/app=eda-toolbox -o=jsonpath='{.items[0].metadata.name}') ${kubectlContext} -- ssh ${username}@${host}`;
}

export function registerTopoNodeCommands(context: vscode.ExtensionContext) {
  const sshCmd = vscode.commands.registerCommand('vscode-eda.sshTopoNode', async (info: TopoNodeInfo) => {
    const name = extractNodeName(info);

    if (!name) {
      vscode.window.showErrorMessage('No node specified.');
      return;
    }

    const edaClient = serviceManager.getClient<EdaClient>('eda');
    const coreNs = edaClient.getCoreNamespace();
    const nodeNs = info?.namespace || coreNs;
    let nodeDetails = extractNodeDetails(info);
    if (typeof nodeDetails !== 'string' || nodeDetails.length === 0) {
      nodeDetails = await fetchNodeDetailsFromApi(edaClient, nodeNs, name);
    }
    if (typeof nodeDetails !== 'string' || nodeDetails.length === 0) {
      vscode.window.showErrorMessage('No node address available for SSH.');
      return;
    }

    const { username, found } = await determineUsername(edaClient, nodeNs, name);
    if (!found) {
      log(`Could not determine username for node ${name}; using default 'admin'`, LogLevel.DEBUG);
    }

    const kubectlContext = getKubectlContext();
    const host = nodeDetails.split(':')[0];
    const cmd = buildSshCommand(coreNs, kubectlContext, username, host);

    const terminal = vscode.window.createTerminal({
      name: `SSH: ${name}`,
      shellPath: 'bash',
      shellArgs: ['-c', cmd]
    });

    terminal.show();
  });

  context.subscriptions.push(sshCmd);
}
