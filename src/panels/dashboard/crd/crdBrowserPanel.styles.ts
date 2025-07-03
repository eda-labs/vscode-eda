export const crdBrowserStyles = `
  :root {
    --bg-primary: var(--vscode-editor-background);
    --border: var(--vscode-panel-border);
    --text-primary: var(--vscode-editor-foreground);
    --yellow: var(--vscode-terminal-ansiYellow, #c7a000);
    --purple: var(--vscode-terminal-ansiMagenta, #b4009e);
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
    padding: 24px;
    max-width: 1400px;
    margin: 0 auto;
  }

  .header {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }

  .select,
  .filter {
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 4px 8px;
  }

  .yaml-btn {
    padding: 4px 12px;
    border: none;
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-radius: 4px;
    cursor: pointer;
  }

  .yaml-btn:hover {
    background-color: var(--vscode-button-hoverBackground);
  }

  .title {
    font-size: 1.3em;
    margin: 8px 0;
  }

  .metadata {
    background-color: var(--yellow);
    color: var(--bg-primary);
    white-space: pre;
    padding: 8px;
    margin-bottom: 8px;
  }

  .description {
    margin: 8px 0;
  }

  .schema-controls {
    margin-bottom: 8px;
  }

  .schema-btn {
    margin-right: 4px;
    padding: 2px 6px;
  }

  .schema details {
    margin-left: 16px;
  }

  .prop-name {
    font-family: monospace;
  }

  .prop-type {
    color: var(--yellow);
    margin-left: 4px;
  }

  .required {
    background-color: var(--purple);
    color: #fff;
    border-radius: 4px;
    padding: 0 4px;
    margin-left: 4px;
    font-size: 0.8em;
  }
`;
