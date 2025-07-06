export const fabricDashboardStyles = `
    :root {
      --bg-primary: var(--vscode-editor-background);
      --bg-secondary: var(--vscode-panel-background);
      --bg-hover: var(--vscode-list-hoverBackground);
      --text-primary: var(--vscode-editor-foreground);
      --text-secondary: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --accent: var(--vscode-button-background);
      --accent-hover: var(--vscode-button-hoverBackground);
      --success: #4ade80;
      --warning: #fbbf24;
      --error: #f87171;
      --info: #60a5fa;
    }

    body {
      margin: 0;
      padding: 0;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      overflow-x: hidden;
    }

    .status-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
      position: relative;
    }

    .status-indicator.active {
      background: var(--success);
      animation: pulse 2s infinite;
    }

    .status-indicator.warning {
      background: var(--warning);
    }

    .status-indicator.error {
      background: var(--error);
    }

    @keyframes pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.7);
      }
      70% {
        box-shadow: 0 0 0 8px rgba(74, 222, 128, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(74, 222, 128, 0);
      }
    }
`;
