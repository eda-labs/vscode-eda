export const targetWizardStyles = `
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      margin: 0;
    }

    .header-container {
      display: flex;
      justify-content: center;
      align-items: center;
      margin-bottom: 32px;
      width: 100%;
    }

    .logo {
      width: 144px;
      height: auto;
      display: block;
    }

    .main-container {
      display: flex;
      gap: 32px;
      max-width: 1400px;
      margin: 0 auto;
      align-items: flex-start;
    }

    @media (max-width: 1200px) {
      .main-container {
        flex-direction: column;
        gap: 24px;
      }
    }

    .form-container {
      flex: 0 0 400px;
      min-width: 350px;
    }

    @media (max-width: 1200px) {
      .form-container {
        flex: none;
        max-width: 600px;
        margin: 0 auto;
      }
    }

    .input {
      width: 100%;
      margin-bottom: 12px;
      padding: 6px 8px;
      color: var(--vscode-input-foreground);
      background-color: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      box-sizing: border-box;
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
      flex: 1;
      min-width: 700px;
    }

    @media (max-width: 1200px) {
      .table-container {
        min-width: 0;
        max-width: 1000px;
        margin: 0 auto;
      }
    }

    .table-wrapper {
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      overflow: hidden;
      overflow-x: auto;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
    }

    /* Table Styles */
    .targets-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      min-width: 700px;
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
      white-space: nowrap;
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
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 200px;
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
      white-space: nowrap;
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

    /* Utility classes for Tailwind-like styling */
    .space-y-4 > * + * {
      margin-top: 16px;
    }

    .text-lg {
      font-size: 1.125rem;
    }

    .font-semibold {
      font-weight: 600;
    }

    .text-sm {
      font-size: 0.875rem;
    }

    .text-gray-500 {
      color: var(--vscode-descriptionForeground);
    }

    .font-medium {
      font-weight: 500;
    }

    .block {
      display: block;
    }

    .pr-8 {
      padding-right: 32px;
    }

    .mr-1 {
      margin-right: 4px;
    }

    .flex {
      display: flex;
    }

    .justify-end {
      justify-content: flex-end;
    }

    .gap-2 {
      gap: 8px;
    }

    .text-base {
      font-size: 1rem;
    }

    .mb-4 {
      margin-bottom: 16px;
    }

    .text-right {
      text-align: right;
    }
`;