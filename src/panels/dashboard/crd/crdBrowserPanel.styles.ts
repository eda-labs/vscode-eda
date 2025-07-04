export const crdBrowserStyles = `
  :root {
    --bg-primary: var(--vscode-editor-background);
    --border: var(--vscode-panel-border);
    --text-primary: var(--vscode-editor-foreground);
    --yellow: var(--vscode-terminal-ansiYellow, #c7a000);
    --blue: var(--vscode-terminal-ansiBlue, #0060df);
    --card-bg: var(--vscode-editorWidget-background);
    --header-bg: var(--vscode-editorWidget-background);
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
    max-width: 1000px;
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

  .metadata-header {
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .metadata {
    background-color: var(--card-bg);
    color: var(--text-primary);
    white-space: pre;
    padding: 8px;
    margin-bottom: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
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
    background-color: var(--blue);
    color: #fff;
    border-radius: 9999px;
    padding: 0 6px;
    margin-left: 4px;
    font-size: 0.75em;
  }

  .schema-card {
    border: 1px solid var(--border);
    border-radius: 6px;
    background-color: var(--card-bg);
    margin-bottom: 6px;
    padding-left: 8px;
  }

  .schema-section {
    border: 1px solid var(--border);
    border-radius: 6px;
    background-color: var(--card-bg);
    margin-bottom: 8px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: var(--header-bg);
    padding: 4px 8px;
    cursor: pointer;
  }

  .prop-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    cursor: pointer;
  }

  .prop-desc {
    margin: 4px 8px;
  }

  .type-badge,
  .prop-type {
    font-family: monospace;
    background-color: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-radius: 4px;
    padding: 0 4px;
    margin-left: auto;
  }

  .prop-type {
    background-color: transparent;
    color: var(--yellow);
    padding: 0;
    margin-left: 4px;
  }
`;
