export const targetWizardStyles = `
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      padding-bottom: 40px;
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
      gap: 24px;
      max-width: 1400px;
      margin: 0 auto;
      align-items: flex-start;
    }

    @media (max-width: 1000px) {
      .main-container {
        flex-direction: column;
      }
    }

    /* Left Pane: Targets List */
    .targets-list-pane {
      flex: 0 0 320px;
      background-color: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    @media (max-width: 1000px) {
      .targets-list-pane {
        flex: none;
      }
    }

    .list-header {
      padding: 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background-color: var(--vscode-editorGroupHeader-tabsBackground);
    }

    .targets-list {
      flex: 1;
      padding: 8px 0;
    }

    .target-item {
      padding: 12px 16px;
      cursor: pointer;
      border-bottom: 1px solid var(--vscode-panel-border);
      transition: background-color 0.15s ease;
      position: relative;
    }

    .target-item:last-child {
      border-bottom: none;
    }

    .target-item:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .target-item.selected {
      background-color: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .target-item.selected::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background-color: var(--vscode-focusBorder);
    }

    .target-url {
      font-weight: 500;
      margin-bottom: 4px;
      word-break: break-all;
    }

    .target-meta {
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .target-meta .context {
      font-style: italic;
    }

    .target-meta .default-badge {
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 500;
    }

    .target-meta .skip-tls {
      background-color: var(--vscode-editorWarning-background);
      color: var(--vscode-editorWarning-foreground);
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 500;
    }

    .targets-list .empty-state {
      padding: 40px 16px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    /* Right Pane: Details */
    .details-pane {
      flex: 1;
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    @media (max-width: 1000px) {
      .details-pane {
        flex: none;
      }
    }

    .details-header {
      padding: 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background-color: var(--vscode-editorGroupHeader-tabsBackground);
    }

    .details-actions {
      display: flex;
      gap: 8px;
    }

    .details-content {
      padding: 24px 32px;
    }

    .empty-details {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 200px;
      text-align: center;
    }

    .form-container {
      max-width: 500px;
      padding-left: 16px;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 24px;
      margin-bottom: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    /* Target Details View */
    .target-details {
      max-width: 500px;
      padding-left: 16px;
    }

    .detail-group {
      margin-bottom: 20px;
    }

    .detail-label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }

    .detail-value {
      font-size: 0.875rem;
      padding: 8px 12px;
      background-color: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      word-break: break-all;
    }

    .detail-value.empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    .detail-actions {
      display: flex;
      gap: 12px;
      margin-top: 24px;
      margin-bottom: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    /* Form Styles */
    .input {
      width: 100%;
      padding: 8px 12px;
      color: var(--vscode-input-foreground);
      background-color: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      box-sizing: border-box;
      font-size: 0.875rem;
    }

    .input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }

    .btn {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 1px solid var(--vscode-button-border, transparent);
      padding: 8px 16px;
      cursor: pointer;
      border-radius: 4px;
      font-weight: 500;
      font-size: 0.875rem;
      transition: background-color 0.15s ease;
    }

    .btn:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .btn-primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .btn-primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-color: var(--vscode-button-border);
    }

    .btn-secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    .btn-danger {
      background-color: var(--vscode-errorForeground);
      color: var(--vscode-editor-background);
      border: none;
    }

    .btn-danger:hover {
      opacity: 0.9;
    }

    .hint {
      font-size: 0.75rem;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
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
      padding: 4px;
    }

    /* Utility classes */
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