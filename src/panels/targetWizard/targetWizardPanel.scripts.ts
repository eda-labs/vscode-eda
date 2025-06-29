export const targetWizardScripts = `
    const vscode = acquireVsCodeApi();
    const existingTargets = JSON.parse('\${targets}');
    let selectedIdx = \${selected};
    let editIndex = null;
    let currentMode = 'view'; // 'view', 'edit', 'new'



    function renderTargetsList() {
      const listContainer = document.getElementById('targetsList');
      listContainer.innerHTML = '';
      
      if (existingTargets.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.textContent = 'No targets configured yet.';
        listContainer.appendChild(emptyState);
        return;
      }
      
      existingTargets.forEach((target, idx) => {
        const item = document.createElement('div');
        item.className = 'target-item' + (idx === selectedIdx ? ' selected' : '');
        item.dataset.index = idx;
        
        const url = document.createElement('div');
        url.className = 'target-url';
        url.textContent = target.url;
        
        const meta = document.createElement('div');
        meta.className = 'target-meta';
        
        if (target.context) {
          const context = document.createElement('span');
          context.className = 'context';
          context.textContent = target.context;
          meta.appendChild(context);
        }
        
        if (idx === selectedIdx) {
          const defaultBadge = document.createElement('span');
          defaultBadge.className = 'default-badge';
          defaultBadge.textContent = 'Default';
          meta.appendChild(defaultBadge);
        }
        
        if (target.skipTlsVerify) {
          const tlsBadge = document.createElement('span');
          tlsBadge.className = 'skip-tls';
          tlsBadge.textContent = 'Skip TLS';
          meta.appendChild(tlsBadge);
        }
        
        item.appendChild(url);
        item.appendChild(meta);
        
        item.addEventListener('click', () => selectTarget(idx));
        
        listContainer.appendChild(item);
      });
    }

    function selectTarget(idx) {
      if (currentMode === 'edit' || currentMode === 'new') {
        // Don't allow selection change while editing
        return;
      }
      
      selectedIdx = idx;
      vscode.postMessage({ command: 'select', index: idx });
      renderTargetsList();
      showTargetDetails(existingTargets[idx]);
    }

    function showTargetDetails(target) {
      currentMode = 'view';
      editIndex = null;
      
      const detailsTitle = document.getElementById('detailsTitle');
      const detailsContent = document.getElementById('detailsContent');
      const formContainer = document.getElementById('formContainer');
      const setDefaultBtn = document.getElementById('setDefault');
      
      detailsTitle.textContent = 'Target Details';
      detailsContent.style.display = 'block';
      formContainer.style.display = 'none';
      
      // Show/hide set default button
      const currentIdx = existingTargets.indexOf(target);
      if (currentIdx !== selectedIdx) {
        setDefaultBtn.style.display = 'inline-block';
        setDefaultBtn.onclick = () => {
          selectedIdx = currentIdx;
          vscode.postMessage({ command: 'select', index: currentIdx });
          renderTargetsList();
          showTargetDetails(target);
        };
      } else {
        setDefaultBtn.style.display = 'none';
      }
      
      detailsContent.innerHTML = generateDetailsHTML(target);
      
      // Add event listeners for edit and delete buttons
      const editBtn = detailsContent.querySelector('.edit-btn');
      const deleteBtn = detailsContent.querySelector('.delete-btn');
      
      if (editBtn) {
        editBtn.addEventListener('click', () => editTarget(currentIdx));
      }
      
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => deleteTarget(currentIdx));
      }
    }

    function generateDetailsHTML(target) {
      return \`
        <div class="target-details">
          <div class="detail-group">
            <div class="detail-label">EDA API URL</div>
            <div class="detail-value">\${target.url}</div>
          </div>
          
          <div class="detail-group">
            <div class="detail-label">Kubernetes Context</div>
            <div class="detail-value\${!target.context ? ' empty' : ''}">\${target.context || 'None'}</div>
          </div>
          
          <div class="detail-group">
            <div class="detail-label">EDA Core Namespace</div>
            <div class="detail-value">\${target.coreNamespace || 'eda-system'}</div>
          </div>
          
          <div class="detail-group">
            <div class="detail-label">EDA Username</div>
            <div class="detail-value">\${target.edaUsername || 'admin'}</div>
          </div>
          
          <div class="detail-group">
            <div class="detail-label">EDA Password</div>
            <div class="detail-value\${!target.edaPassword ? ' empty' : ''}">\${target.edaPassword ? '••••••••' : 'Not configured'}</div>
          </div>
          
          <div class="detail-group">
            <div class="detail-label">Keycloak Admin Username</div>
            <div class="detail-value">\${target.kcUsername || 'admin'}</div>
          </div>
          
          <div class="detail-group">
            <div class="detail-label">Keycloak Admin Password</div>
            <div class="detail-value\${!target.kcPassword ? ' empty' : ''}">\${target.kcPassword ? '••••••••' : 'Not configured'}</div>
          </div>
          
          <div class="detail-group">
            <div class="detail-label">Skip TLS Verification</div>
            <div class="detail-value">\${target.skipTlsVerify ? 'Yes' : 'No'}</div>
          </div>
          
          <div class="detail-actions">
            <button class="btn btn-secondary edit-btn">Edit</button>
            <button class="btn btn-danger delete-btn">Delete</button>
          </div>
        </div>
      \`;
    }

    function showEmptyDetails() {
      const detailsTitle = document.getElementById('detailsTitle');
      const detailsContent = document.getElementById('detailsContent');
      const formContainer = document.getElementById('formContainer');
      const setDefaultBtn = document.getElementById('setDefault');
      
      detailsTitle.textContent = 'Target Details';
      detailsContent.style.display = 'block';
      formContainer.style.display = 'none';
      setDefaultBtn.style.display = 'none';
      
      detailsContent.innerHTML = '<div class="empty-details"><p class="text-gray-500">Select a target to view details, or add a new target to get started.</p></div>';
    }

    function editTarget(idx) {
      currentMode = 'edit';
      editIndex = idx;
      const target = existingTargets[idx];
      
      showForm('Edit Target');
      populateForm(target);
    }

    function addNewTarget() {
      currentMode = 'new';
      editIndex = null;
      
      showForm('Add New Target');
      clearForm();
    }

    function showForm(title) {
      const detailsTitle = document.getElementById('detailsTitle');
      const detailsContent = document.getElementById('detailsContent');
      const formContainer = document.getElementById('formContainer');
      const setDefaultBtn = document.getElementById('setDefault');
      
      detailsTitle.textContent = title;
      detailsContent.style.display = 'none';
      formContainer.style.display = 'block';
      setDefaultBtn.style.display = 'none';
    }

    function populateForm(target) {
      document.getElementById('url').value = target.url || '';
      document.getElementById('context').value = target.context || '';
      document.getElementById('coreNs').value = target.coreNamespace || 'eda-system';
      document.getElementById('edaUser').value = target.edaUsername || 'admin';
      document.getElementById('kcUser').value = target.kcUsername || 'admin';
      document.getElementById('edaPass').value = target.edaPassword || '';
      document.getElementById('kcPass').value = target.kcPassword || '';
      document.getElementById('edaPassHint').textContent = target.edaPassword ? 'Loaded from secret. Change to update.' : '';
      document.getElementById('kcPassHint').textContent = target.kcPassword ? 'Loaded from secret. Change to update.' : '';
      document.getElementById('skipTls').checked = !!target.skipTlsVerify;
    }

    function clearForm() {
      document.getElementById('url').value = '';
      document.getElementById('context').value = '';
      document.getElementById('coreNs').value = 'eda-system';
      document.getElementById('edaUser').value = 'admin';
      document.getElementById('kcUser').value = 'admin';
      document.getElementById('edaPass').value = '';
      document.getElementById('kcPass').value = '';
      document.getElementById('edaPassHint').textContent = '';
      document.getElementById('kcPassHint').textContent = '';
      document.getElementById('skipTls').checked = false;
    }

    function cancelForm() {
      currentMode = 'view';
      editIndex = null;
      
      if (existingTargets.length > 0 && selectedIdx < existingTargets.length) {
        showTargetDetails(existingTargets[selectedIdx]);
      } else {
        showEmptyDetails();
      }
    }

    function deleteTarget(idx) {
      if (confirm('Are you sure you want to delete this target?')) {
        existingTargets.splice(idx, 1);
        
        if (selectedIdx === idx) {
          selectedIdx = Math.max(0, Math.min(selectedIdx, existingTargets.length - 1));
          vscode.postMessage({ command: 'select', index: selectedIdx });
        } else if (selectedIdx > idx) {
          selectedIdx--;
          vscode.postMessage({ command: 'select', index: selectedIdx });
        }
        
        renderTargetsList();
        
        if (existingTargets.length > 0) {
          showTargetDetails(existingTargets[selectedIdx]);
        } else {
          showEmptyDetails();
        }
        
        vscode.postMessage({ command: 'commit', targets: existingTargets });
      }
    }

    function sendData(command) {
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

    function saveTarget() {
      const url = document.getElementById('url').value.trim();
      const item = {
        url,
        context: document.getElementById('context').value || undefined,
        coreNamespace: document.getElementById('coreNs').value || undefined,
        edaUsername: document.getElementById('edaUser').value || undefined,
        kcUsername: document.getElementById('kcUser').value || undefined,
        skipTlsVerify: document.getElementById('skipTls').checked || undefined,
      };
      
      if (!url) {
        alert('URL is required');
        return;
      }
      
      if (editIndex !== null) {
        // Updating existing target
        existingTargets[editIndex] = item;
        sendData('save');
      } else {
        // Adding new target
        existingTargets.push(item);
        sendData('add');
        selectedIdx = existingTargets.length - 1;
        vscode.postMessage({ command: 'select', index: selectedIdx });
      }
      
      vscode.postMessage({ command: 'commit', targets: existingTargets });
      
      renderTargetsList();
      showTargetDetails(existingTargets[selectedIdx]);
      
      document.getElementById('edaPassHint').textContent = '';
      document.getElementById('kcPassHint').textContent = '';
    }

    // Initialize the interface
    renderTargetsList();

    if (existingTargets.length > 0 && selectedIdx < existingTargets.length) {
      showTargetDetails(existingTargets[selectedIdx]);
    } else {
      showEmptyDetails();
    }

    // Event listeners
    document.getElementById('addNew').addEventListener('click', addNewTarget);
    document.getElementById('save').addEventListener('click', saveTarget);
    document.getElementById('cancel').addEventListener('click', cancelForm);

    // Enter key handling
    document.querySelectorAll('input').forEach(input => {
      input.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
          saveTarget();
        }
      });
    });

    // Password toggle functionality
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