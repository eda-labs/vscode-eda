export const toponodesDashboardStyles = `
  :root {
    --bg-primary: var(--vscode-editor-background);
    --bg-secondary: var(--vscode-panel-background);
    --border: var(--vscode-panel-border);
    --text-primary: var(--vscode-editor-foreground);
    --text-secondary: var(--vscode-descriptionForeground);
    --accent: var(--vscode-button-background);
    --accent-hover: var(--vscode-button-hoverBackground);
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
    align-items: center;
    justify-content: flex-end;
    margin-bottom: 16px;
  }

  .open-tree-btn {
    margin-right: 8px;
    padding: 4px 12px;
    border: none;
    background-color: var(--accent);
    color: var(--vscode-button-foreground);
    border-radius: 4px;
    cursor: pointer;
  }

  .open-tree-btn:hover {
    background-color: var(--accent-hover);
  }

  .icon-btn {
    margin-right: 4px;
    padding: 4px;
    border: none;
    background-color: var(--accent);
    color: var(--vscode-button-foreground);
    border-radius: 4px;
    cursor: pointer;
  }

  .icon-btn:hover {
    background-color: var(--accent-hover);
  }

  .select {
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 4px 8px;
  }

  .filters td {
    border: 1px solid var(--border);
    padding: 0;
    background-color: var(--vscode-editorWidget-background);
  }

  .filters input {
    width: 100%;
    padding: 2px 4px;
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 2px;
    box-sizing: border-box;
  }

  .results-container {
    overflow: auto;
    max-height: 85vh;
  }

  .results-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    border-radius: 8px;
    overflow: hidden;
  }

  .results-table th,
  .results-table td {
    border: 1px solid var(--border);
    padding: 4px 8px;
    white-space: pre;
  }

  .results-table th {
    background-color: var(--bg-secondary);
    cursor: pointer;
    position: relative;
    user-select: none;
  }

  .status-bar {
    padding: 4px 0;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }

  .results-table tbody tr:hover {
    background-color: var(--vscode-list-hoverBackground);
  }
`;
