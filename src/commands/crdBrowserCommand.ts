import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { CrdBrowserPanel } from '../panels/dashboard/crd/crdBrowserPanel';

export function registerCrdBrowserCommand(
  context: vscode.ExtensionContext
): void {
  const cmd = vscode.commands.registerCommand(
    'vscode-eda.openCrdBrowser',
    async (resource?: vscode.Uri) => {
      let target: { group: string; kind: string } | undefined;
      let text: string | undefined;

      if (resource) {
        try {
          const data = await vscode.workspace.fs.readFile(resource);
          text = Buffer.from(data).toString('utf8');
        } catch {
          // ignore file read errors
        }
      }

      if (!text) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'yaml') {
          text = editor.document.getText();
        }
      }

      if (text) {
        try {
          const parsed = yaml.load(text) as any;
          if (parsed && typeof parsed === 'object') {
            const apiVersion = parsed.apiVersion as string | undefined;
            const kind = parsed.kind as string | undefined;
            if (apiVersion && kind) {
              const group = apiVersion.split('/')[0];
              target = { group, kind };
            }
          }
        } catch {
          // ignore parse errors
        }
      }

      CrdBrowserPanel.show(context, 'CRD Browser', target);
    }
  );
  context.subscriptions.push(cmd);
}
