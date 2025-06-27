import * as vscode from 'vscode';
import { KubernetesClient } from '../clients/kubernetesClient';

export interface TargetWizardResult {
  url: string;
  context?: string;
  edaUsername: string;
  kcUsername: string;
  edaPassword: string;
  kcPassword: string;
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => possible.charAt(Math.floor(Math.random() * possible.length))).join('');
}

function getHtml(contexts: string[], nonce: string, cspSource: string): string {
  const options = contexts.map(c => `<option value="${c}">${c}</option>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background-color: var(--vscode-editor-background); padding: 20px; }
    input, select { width: 100%; margin-bottom: 12px; padding: 4px; color: var(--vscode-input-foreground); background-color: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
    button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid var(--vscode-button-border); padding: 6px 16px; cursor: pointer; }
    button:hover { background-color: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <h2>Configure EDA Target</h2>
  <label>EDA API URL</label>
  <input id="url" type="text" placeholder="https://eda.example.com">
  <label>Kubernetes Context</label>
  <select id="context">
    <option value="">None</option>
    ${options}
  </select>
  <label>EDA Username</label>
  <input id="edaUser" type="text" value="admin">
  <label>EDA Password</label>
  <input id="edaPass" type="password" value="admin">
  <label>Keycloak Admin Username</label>
  <input id="kcUser" type="text" value="admin">
  <label>Keycloak Admin Password</label>
  <input id="kcPass" type="password" value="admin">
  <button id="save">Save</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('save').addEventListener('click', () => {
      const url = (document.getElementById('url')).value.trim();
      if (!url) { alert('URL is required'); return; }
      const context = (document.getElementById('context')).value;
      const edaUsername = (document.getElementById('edaUser')).value;
      const edaPassword = (document.getElementById('edaPass')).value;
      const kcUsername = (document.getElementById('kcUser')).value;
      const kcPassword = (document.getElementById('kcPass')).value;
      vscode.postMessage({
        command: 'save',
        url,
        context,
        edaUsername,
        edaPassword,
        kcUsername,
        kcPassword
      });
    });
  </script>
</body>
</html>`;
}

export async function configureTargets(context: vscode.ExtensionContext): Promise<void> {
  const k8sClient = new KubernetesClient();
  const contexts = k8sClient.getAvailableContexts();
  const panel = vscode.window.createWebviewPanel('edaTargetWizard', 'Configure EDA Targets', vscode.ViewColumn.Active, { enableScripts: true });
  const nonce = getNonce();
  panel.webview.html = getHtml(contexts, nonce, panel.webview.cspSource);

  return new Promise(resolve => {
    panel.webview.onDidReceiveMessage(async (msg: any) => {
      if (msg.command === 'save') {
        const config = vscode.workspace.getConfiguration('vscode-eda');
        const current = config.get<Record<string, any>>('edaTargets') || {};
        current[msg.url] = {
          context: msg.context || undefined,
          edaUsername: msg.edaUsername || undefined,
          kcUsername: msg.kcUsername || undefined
        };
        await config.update('edaTargets', current, vscode.ConfigurationTarget.Global);

        const host = (() => {
          try {
            return new URL(msg.url).host;
          } catch {
            return msg.url;
          }
        })();
        await context.secrets.store(`edaPassword:${host}`, msg.edaPassword || '');
        await context.secrets.store(`kcPassword:${host}`, msg.kcPassword || '');

        vscode.window
          .showInformationMessage('EDA target saved. Reload window to apply.', 'Reload')
          .then(v => {
            if (v === 'Reload') {
              void vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
          });
        panel.dispose();
        resolve();
      }
    });
    panel.onDidDispose(() => resolve());
  });
}
