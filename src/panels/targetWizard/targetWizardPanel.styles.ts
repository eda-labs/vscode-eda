export const targetWizardStyles = `
    body { 
      font-family: var(--vscode-font-family); 
      color: var(--vscode-foreground); 
      background-color: var(--vscode-editor-background); 
      padding: 20px; 
    }
    
    .container { 
      max-width: 500px; 
      margin: auto; 
    }
    
    img { 
      display: block; 
      margin: 0 auto 16px; 
      width: 150px; 
    }
    
    h2 {
      margin-bottom: 8px;
    }
    
    p {
      color: var(--vscode-descriptionForeground);
      margin-bottom: 20px;
    }
    
    label {
      display: block;
      margin-bottom: 4px;
      font-weight: 500;
    }
    
    input, select { 
      width: 100%; 
      margin-bottom: 12px; 
      padding: 6px 8px; 
      color: var(--vscode-input-foreground); 
      background-color: var(--vscode-input-background); 
      border: 1px solid var(--vscode-input-border); 
      border-radius: 4px;
    }
    
    input:focus, select:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    
    button { 
      background-color: var(--vscode-button-background); 
      color: var(--vscode-button-foreground); 
      border: 1px solid var(--vscode-button-border); 
      padding: 8px 20px; 
      cursor: pointer; 
      border-radius: 4px;
      font-weight: 500;
      margin-top: 8px;
      width: 100%;
    }
    
    button:hover { 
      background-color: var(--vscode-button-hoverBackground); 
    }
    
    button:active {
      transform: translateY(1px);
    }
`;