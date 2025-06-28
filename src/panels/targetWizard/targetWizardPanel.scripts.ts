export const targetWizardScripts = `
    const vscode = acquireVsCodeApi();
    
    document.getElementById('save').addEventListener('click', () => {
      const url = document.getElementById('url').value.trim();
      if (!url) { 
        alert('URL is required'); 
        return; 
      }
      
      const context = document.getElementById('context').value;
      const edaUsername = document.getElementById('edaUser').value;
      const edaPassword = document.getElementById('edaPass').value;
      const kcUsername = document.getElementById('kcUser').value;
      const kcPassword = document.getElementById('kcPass').value;
      
      vscode.postMessage({
        command: 'save',
        url,
        context,
        edaUsername,
        edaPassword,
        kcUsername,
        kcPassword
      });
    });
    
    // Allow Enter key to submit
    document.querySelectorAll('input').forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          document.getElementById('save').click();
        }
      });
    });
`;