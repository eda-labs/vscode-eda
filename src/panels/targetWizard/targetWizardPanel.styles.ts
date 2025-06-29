export const targetWizardStyles = `
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
    }

    .form-container {
      max-width: 600px;
      margin: auto;
    }

    .input {
      width: 100%;
      margin-bottom: 12px;
      padding: 6px 8px;
      color: var(--vscode-input-foreground);
      background-color: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
    }

    .input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }

    .btn {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 1px solid var(--vscode-button-border);
      padding: 8px 20px;
      cursor: pointer;
      border-radius: 4px;
      font-weight: 500;
    }

    .btn:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .hint {
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      margin-top: -8px;
      margin-bottom: 8px;
      display: block;
    }

    .password-container {
      position: relative;
    }

    .password-toggle {
      position: absolute;
      top: 50%;
      right: 8px;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--vscode-input-foreground);
      cursor: pointer;
    }

    /* Table Container Styles */
    .table-container {
      max-width: 1200px;
      margin: 32px auto 0;
    }

    .table-wrapper {
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
    }

    /* Table Styles */
    .targets-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    .table-header {
      padding: 12px 16px;
      text-align: left;
      font-weight: 600;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
      background-color: var(--vscode-editorWidget-background);
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    .table-body tr {
      border-bottom: 1px solid var(--vscode-panel-border);
      transition: background-color 0.15s ease;
    }

    .table-body tr:last-child {
      border-bottom: none;
    }

    .table-body tr:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .table-cell {
      padding: 12px 16px;
      color: var(--vscode-foreground);
    }

    .table-cell-muted {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    /* Radio button styling */
    .radio-cell {
      width: 50px;
      text-align: center;
    }

    input[type="radio"] {
      cursor: pointer;
      width: 16px;
      height: 16px;
    }

    /* Action buttons in table */
    .table-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .action-button {
      padding: 4px 12px;
      font-size: 0.875rem;
      font-weight: 500;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .action-button-edit {
      color: var(--vscode-textLink-foreground);
      background-color: transparent;
    }

    .action-button-edit:hover {
      background-color: var(--vscode-textLink-activeForeground);
      color: var(--vscode-editor-background);
    }

    .action-button-delete {
      color: var(--vscode-errorForeground);
      background-color: transparent;
    }

    .action-button-delete:hover {
      background-color: var(--vscode-errorForeground);
      color: var(--vscode-editor-background);
    }

    /* Skip TLS indicator */
    .skip-tls-indicator {
      display: inline-block;
      padding: 2px 8px;
      font-size: 0.75rem;
      font-weight: 500;
      border-radius: 9999px;
      background-color: var(--vscode-editorWarning-background);
      color: var(--vscode-editorWarning-foreground);
    }

    /* Empty state */
    .empty-state {
      padding: 48px 16px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
`;