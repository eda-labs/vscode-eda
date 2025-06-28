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

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }

    th, td {
      padding: 4px 8px;
    }
`;
