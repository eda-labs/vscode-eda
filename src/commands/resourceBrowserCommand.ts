import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

import { ResourceBrowserPanel } from '../webviews/dashboard/resource/resourceBrowserPanel';

interface ResourceTarget {
  group: string;
  kind: string;
}

async function readFileText(resource: vscode.Uri): Promise<string | undefined> {
  try {
    const data = await vscode.workspace.fs.readFile(resource);
    return Buffer.from(data).toString('utf8');
  } catch {
    return undefined;
  }
}

function getActiveEditorYamlText(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId === 'yaml') {
    return editor.document.getText();
  }
  return undefined;
}

function parseResourceTarget(text: string): ResourceTarget | undefined {
  try {
    const parsed = yaml.load(text) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    const apiVersion = parsed.apiVersion;
    const kind = parsed.kind;
    if (typeof apiVersion === 'string' && typeof kind === 'string') {
      const group = apiVersion.split('/')[0];
      return { group, kind };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function resolveResourceTarget(
  resource?: vscode.Uri
): Promise<ResourceTarget | undefined> {
  const text = resource
    ? await readFileText(resource)
    : getActiveEditorYamlText();

  return text ? parseResourceTarget(text) : undefined;
}

export function registerResourceBrowserCommand(
  context: vscode.ExtensionContext
): void {
  const cmd = vscode.commands.registerCommand(
    'vscode-eda.openResourceBrowser',
    async (resource?: vscode.Uri) => {
      const target = await resolveResourceTarget(resource);
      ResourceBrowserPanel.show(context, 'Resource Browser', target);
    }
  );
  context.subscriptions.push(cmd);
}
