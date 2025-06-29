export const targetWizardScripts = `
    const vscode = acquireVsCodeApi();
    const twJsUri = "\${twJs}";
    const existingTargets = JSON.parse('\${targets}');
    let selectedIdx = \${selected};
    let editIndex = null;

    const loadScript = (src) => new Promise(res => { const s = document.createElement('script'); s.src = src; document.body.appendChild(s); s.onload = res; });

    function render() {
      const tbody = document.getElementById('targetsBody');
      tbody.innerHTML = '';
      
      if (existingTargets.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="8" class="empty-state">No targets configured yet. Add your first EDA target above.</td>';
        tbody.appendChild(tr);
        return;
      }
      
      existingTargets.forEach((t, idx) => {
        const tr = document.createElement('tr');
        
        const radioCell = document.createElement('td');
        radioCell.className = 'table-cell radio-cell';
        radioCell.innerHTML = '<input type="radio" name="selectedTarget" value="' + idx + '" ' + (idx === selectedIdx ? 'checked' : '') + '>';
        
        const urlCell = document.createElement('td');
        urlCell.className = 'table-cell';
        urlCell.textContent = t.url;
        urlCell.title = t.url; // Add tooltip for long URLs
        
        const contextCell = document.createElement('td');
        contextCell.className = t.context ? 'table-cell' : 'table-cell table-cell-muted';
        contextCell.textContent = t.context || 'None';

        const coreNsCell = document.createElement('td');
        coreNsCell.className = 'table-cell';
        coreNsCell.textContent = t.coreNamespace || 'eda-system';

        const edaUserCell = document.createElement('td');
        edaUserCell.className = 'table-cell';
        edaUserCell.textContent = t.edaUsername || 'admin';
        
        const kcUserCell = document.createElement('td');
        kcUserCell.className = 'table-cell';
        kcUserCell.textContent = t.kcUsername || 'admin';
        
        const tlsCell = document.createElement('td');
        tlsCell.className = 'table-cell';
        if (t.skipTlsVerify) {
          tlsCell.innerHTML = '<span class="skip-tls-indicator">Yes</span>';
        } else {
          tlsCell.innerHTML = '<span style="color: var(--vscode-descriptionForeground)">No</span>';
        }
        
        const actionsCell = document.createElement('td');
        actionsCell.className = 'table-cell';
        actionsCell.innerHTML = 
          '<div class="table-actions">' +
          '<button class="action-button action-button-edit edit" data-index="' + idx + '">Edit</button>' +
          '<button class="action-button action-button-delete delete" data-index="' + idx + '">Delete</button>' +
          '</div>';
        
        tr.appendChild(radioCell);
        tr.appendChild(urlCell);
        tr.appendChild(contextCell);
        tr.appendChild(coreNsCell);
        tr.appendChild(edaUserCell);
        tr.appendChild(kcUserCell);
        tr.appendChild(tlsCell);
        tr.appendChild(actionsCell);
        
        tbody.appendChild(tr);
      });
      
      document.querySelectorAll('button.edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-index'));
          editIndex = idx;
        const t = existingTargets[idx];
        document.getElementById('url').value = t.url;
        document.getElementById('context').value = t.context || '';
        document.getElementById('coreNs').value = t.coreNamespace || 'eda-system';
        document.getElementById('edaUser').value = t.edaUsername || 'admin';
          document.getElementById('kcUser').value = t.kcUsername || 'admin';
          document.getElementById('edaPass').value = t.edaPassword || '';
          document.getElementById('kcPass').value = t.kcPassword || '';
          document.getElementById('edaPassHint').textContent = t.edaPassword ? 'Loaded from secret. Change to update.' : '';
          document.getElementById('kcPassHint').textContent = t.kcPassword ? 'Loaded from secret. Change to update.' : '';
          document.getElementById('skipTls').checked = !!t.skipTlsVerify;
          
          // Scroll to form - check if mobile layout first
          const formContainer = document.querySelector('.form-container');
          if (window.innerWidth <= 1200) {
            // Mobile layout - scroll to top
            formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
          } else {
            // Desktop layout - just focus the URL input
            document.getElementById('url').focus();
          }
        });
      });
      
      document.querySelectorAll('button.delete').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-index'));
          existingTargets.splice(idx, 1);
          if (selectedIdx === idx) {
            selectedIdx = 0;
            vscode.postMessage({ command: 'select', index: 0 });
          } else if (selectedIdx > idx) {
            selectedIdx--;
            vscode.postMessage({ command: 'select', index: selectedIdx });
          }
          editIndex = null;
          render();
        });
      });
      
      document.querySelectorAll('input[name="selectedTarget"]').forEach(r => {
        r.addEventListener('change', () => {
          const idx = parseInt(r.value);
          selectedIdx = idx;
          vscode.postMessage({ command: 'select', index: idx });
        });
      });
    }

    loadScript(twJsUri).then(render);

    function sendData(command) {
      const url = document.getElementById('url').value.trim();
      if (!url) { alert('URL is required'); return; }
      const context = document.getElementById('context').value;
      const edaUsername = document.getElementById('edaUser').value;
      const edaPassword = document.getElementById('edaPass').value;
      const kcUsername = document.getElementById('kcUser').value;
      const kcPassword = document.getElementById('kcPass').value;
      const skipTlsVerify = document.getElementById('skipTls').checked;
      const coreNamespace = document.getElementById('coreNs').value;
      const originalUrl = editIndex !== null ? existingTargets[editIndex].url : null;
      vscode.postMessage({
        command,
        url,
        context,
        edaUsername,
        edaPassword,
        kcUsername,
        kcPassword,
        skipTlsVerify,
        coreNamespace,
        originalUrl,
        index: editIndex
      });
    }

    document.getElementById('save').addEventListener('click', () => {
      const url = document.getElementById('url').value.trim();
      const item = {
        url,
        context: document.getElementById('context').value || undefined,
        coreNamespace: document.getElementById('coreNs').value || undefined,
        edaUsername: document.getElementById('edaUser').value || undefined,
        kcUsername: document.getElementById('kcUser').value || undefined,
        skipTlsVerify: document.getElementById('skipTls').checked || undefined,
      };
      if (url) {
        if (editIndex !== null) {
          existingTargets[editIndex] = item;
        } else {
          existingTargets.push(item);
        }
      }
      if (!url && editIndex === null) {
        vscode.postMessage({ command: 'commit', targets: existingTargets });
        vscode.postMessage({ command: 'close' });
      } else {
        sendData('save');
        vscode.postMessage({ command: 'commit', targets: existingTargets });
      }
      document.getElementById('edaPassHint').textContent = '';
      document.getElementById('kcPassHint').textContent = '';
    });
    
    document.getElementById('add').addEventListener('click', () => {
      sendData('add');
      const item = {
        url: document.getElementById('url').value.trim(),
        context: document.getElementById('context').value || undefined,
        coreNamespace: document.getElementById('coreNs').value || undefined,
        edaUsername: document.getElementById('edaUser').value || undefined,
        kcUsername: document.getElementById('kcUser').value || undefined,
        skipTlsVerify: document.getElementById('skipTls').checked || undefined,
      };
      if (editIndex !== null) {
        existingTargets[editIndex] = item;
      } else {
        existingTargets.push(item);
      }
      editIndex = null;
      render();
      document.getElementById('edaPassHint').textContent = '';
      document.getElementById('kcPassHint').textContent = '';
      
      // Clear form
      document.getElementById('url').value = '';
      document.getElementById('context').value = '';
      document.getElementById('coreNs').value = 'eda-system';
      document.getElementById('edaUser').value = 'admin';
      document.getElementById('kcUser').value = 'admin';
      document.getElementById('edaPass').value = '';
      document.getElementById('kcPass').value = '';
      document.getElementById('skipTls').checked = false;
    });

    document.querySelectorAll('input').forEach(input => {
      input.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
          document.getElementById('save').click();
        }
      });
    });

    function setupToggle(id, toggleId) {
      const input = document.getElementById(id);
      const btn = document.getElementById(toggleId);
      btn.addEventListener('click', () => {
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = '🙈';
          btn.setAttribute('aria-label', 'Hide password');
        } else {
          input.type = 'password';
          btn.textContent = '👁';
          btn.setAttribute('aria-label', 'Show password');
        }
      });
    }

    setupToggle('edaPass', 'toggleEdaPass');
    setupToggle('kcPass', 'toggleKcPass');
`;