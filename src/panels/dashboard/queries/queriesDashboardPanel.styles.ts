export const queriesDashboardStyles = `
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
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .query-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }

  .query-label {
    display: flex;
    align-items: center;
  }

  .query-label .codicon {
    margin-right: 4px;
  }

  .select {
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 4px 8px;
  }

  .query-input {
    flex: 1;
    padding: 4px 8px;
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
  }

  .run-btn {
    padding: 4px 12px;
    border: none;
    background-color: var(--accent);
    color: var(--vscode-button-foreground);
    border-radius: 4px;
    cursor: pointer;
  }

  .run-btn:hover {
    background-color: var(--accent-hover);
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
    border: none;
    box-sizing: border-box;
  }

  .results-container {
    overflow: auto;
    max-height: 85vh;
  }

  .results-table {
    width: 100%;
    border-collapse: collapse;
  }

  .results-table th,
  .results-table td {
    border: 1px solid var(--border);
    padding: 4px 8px;
  }

  .results-table th {
    background-color: var(--bg-secondary);
    cursor: pointer;
    position: relative;
    user-select: none;
  }

  .header-menu {
    display: none;
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    cursor: pointer;
  }

  th:hover .header-menu {
    display: inline;
  }

  .status-bar {
    padding: 4px 0;
    border-top: 1px solid var(--border);
    margin-top: 8px;
  }
`;
