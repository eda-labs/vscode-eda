export const topologieDashboardStyles = `
  :root {
    --bg-primary: var(--vscode-editor-background);
    --text-primary: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border);
  }
  body {
    margin: 0;
    padding: 0;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  .dashboard {
    padding: 8px;
    height: 100vh;
    box-sizing: border-box;
  }
  .header {
    margin-bottom: 8px;
  }
  .select {
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 4px 8px;
  }
  #cy {
    width: 100%;
    height: calc(100% - 40px);
    border: 1px solid var(--border);
  }
`;
