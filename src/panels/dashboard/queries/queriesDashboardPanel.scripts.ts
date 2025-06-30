export const queriesDashboardScripts = `
  const vscode = acquireVsCodeApi();
  vscode.postMessage({ command: 'ready' });
`;
