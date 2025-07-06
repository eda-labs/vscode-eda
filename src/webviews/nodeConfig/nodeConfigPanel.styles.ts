export const nodeConfigStyles = `
    body {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size);
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      padding: 0;
      margin: 0;
      overflow: hidden;
    }
    
    .container {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100vh;
    }
    
    .toolbar {
      padding: 12px;
      background-color: var(--vscode-side-bar-background);
      border-bottom: 1px solid var(--vscode-sideBar-border);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .button {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
      font-weight: 500;
      font-size: 12px;
      transition: all 0.2s ease-in-out;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }
    
    .button:hover {
      background-color: var(--vscode-button-hover-background);
      transform: translateY(-1px);
      box-shadow: 0 2px 3px rgba(0, 0, 0, 0.25);
    }
    
    .button:active {
      transform: translateY(0);
      box-shadow: 0 1px 1px rgba(0, 0, 0, 0.15);
    }
    
    .button-icon {
      font-size: 14px;
      line-height: 1;
    }

    .select {
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 4px 8px;
    }
    
    .copy-success {
      background-color: var(--vscode-debugConsole-infoForeground) !important;
    }
    
    .config-view {
      display: grid;
      overflow-y: auto;
      font-family: var(--vscode-editor-font-family, monospace);
      transition: grid-template-columns 0.3s ease-in-out;
    }
    
    /* --- Layout States --- */
    .config-view.annotations-visible {
      grid-template-columns: max-content auto 1fr;
    }
    
    .config-view.annotations-hidden {
      grid-template-columns: auto 1fr;
    }
    
    .line {
      display: contents;
    }
    
    .line > div {
      padding: 2px 10px;
      white-space: pre;
    }
    
    .line-annotation {
      color: var(--vscode-descriptionForeground);
      background-color: var(--vscode-editorWidget-background);
      text-align: right;
      cursor: default;
      user-select: none;
      border-right: 1px solid var(--vscode-sideBar-border);
      transition: background-color 0.2s ease-in-out, color 0.2s ease-in-out;
      white-space: pre;
    }

    .annotation-info {
      font-size: 0.8em;
      color: var(--vscode-editor-foreground);
    }
    
    .annotations-hidden .line-annotation {
      display: none;
    }

    .annotations-hidden .divider {
      display: none;
    }

    .annotation-extra .line-num,
    .annotation-extra .line-code {
      visibility: hidden;
    }

    .annotations-hidden .annotation-extra {
      display: none;
    }
    
    .line-num {
      text-align: right;
      color: var(--vscode-editorLineNumber-foreground);
      background-color: var(--vscode-editor-background);
      user-select: none;
    }
    
    .line-code {
      background-color: var(--vscode-editor-background);
      transition: background-color 0.2s ease-in-out;
      position: relative;
      z-index: 1;
    }
    
    /* --- Hover and Highlight Effects --- */
    .line-annotation:hover {
      color: var(--vscode-list-hoverForeground);
      background-color: var(--vscode-list-hoverBackground);
    }
    
    .line-highlight .line-code {
      background-color: var(--vscode-editor-selectionBackground);
    }
    
    .line-highlight .line-annotation {
      color: var(--vscode-list-activeSelectionForeground);
      background-color: var(--vscode-list-activeSelectionBackground);
      font-weight: bold;
    }
    
    /* --- Enhanced Syntax Highlighting --- */
    /* Main sections */
    .section-keyword {
      color: var(--vscode-charts-purple);
      font-weight: bold;
    }
    
    /* Interface types */
    .interface-type {
      color: var(--vscode-charts-purple);
      font-weight: bold;
    }
    
    /* Properties */
    .property {
      color: var(--vscode-charts-blue);
    }
    
    /* Interface names */
    .interface-name {
      color: var(--vscode-charts-green);
      font-weight: bold;
    }
    
    /* Brackets */
    .bracket {
      color: var(--vscode-editor-foreground);
    }
    
    /* Values */
    .value {
      color: var(--vscode-charts-yellow);
    }
    
    /* Boolean values */
    .boolean {
      color: var(--vscode-charts-purple);
      font-weight: bold;
    }
    
    /* Numbers */
    .number {
      color: var(--vscode-charts-red);
    }
    
    /* Strings */
    .string {
      color: var(--vscode-charts-yellow);
    }
    
    /* Special values (like IP addresses) */
    .ip-address {
      color: var(--vscode-charts-orange);
    }
    
    /* Config parameters */
    .parameter {
      color: var(--vscode-charts-blue);
    }
    
    /* Network specific keywords */
    .network-keyword {
      color: var(--vscode-charts-purple);
    }
    
    /* VLAN related */
    .vlan {
      color: var(--vscode-charts-purple);
    }
    
    /* Protocol related */
    .protocol {
      color: var(--vscode-charts-green);
    }
    
    /* BGP specific */
    .bgp {
      color: var(--vscode-charts-red);
    }
    
    /* Route related */
    .route {
      color: var(--vscode-charts-orange);
    }
    
    /* Comments */
    .comment {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    
    /* Indentation guide */
    .indentation-guide {
      display: inline-block;
      width: 8px;
      border-left: 1px solid var(--vscode-editorIndentGuide-background);
      height: 100%;
      position: absolute;
      left: 0;
      top: 0;
    }

    body.color-mode-less .section-keyword,
    body.color-mode-less .interface-type,
    body.color-mode-less .property,
    body.color-mode-less .interface-name,
    body.color-mode-less .value,
    body.color-mode-less .string,
    body.color-mode-less .ip-address,
    body.color-mode-less .parameter,
    body.color-mode-less .network-keyword,
    body.color-mode-less .vlan,
    body.color-mode-less .protocol,
    body.color-mode-less .bgp,
    body.color-mode-less .route {
      color: var(--vscode-editor-foreground);
    }

    body.color-mode-none .section-keyword,
    body.color-mode-none .interface-type,
    body.color-mode-none .property,
    body.color-mode-none .interface-name,
    body.color-mode-none .value,
    body.color-mode-none .string,
    body.color-mode-none .ip-address,
    body.color-mode-none .parameter,
    body.color-mode-none .network-keyword,
    body.color-mode-none .vlan,
    body.color-mode-none .protocol,
    body.color-mode-none .bgp,
    body.color-mode-none .route,
    body.color-mode-none .boolean,
    body.color-mode-none .number {
      color: var(--vscode-editor-foreground);
    }
    
    /* --- Toast Notification --- */
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background-color: var(--vscode-notificationToast-background);
      color: var(--vscode-notificationToast-foreground);
      padding: 10px 16px;
      border-radius: 4px;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transform: translateY(20px);
      transition: opacity 0.3s ease, transform 0.3s ease;
    }
    
    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }
    
    /* Divider for sections */
    .divider {
      border-bottom: 1px solid var(--vscode-textSeparator-foreground);
      margin: 10px 0;
    }
`;