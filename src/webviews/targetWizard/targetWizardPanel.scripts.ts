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
        emptyState.className = 'py-10 px-4 text-center text-[var(--vscode-descriptionForeground)] italic';
        emptyState.textContent = 'No targets configured yet.';
        listContainer.appendChild(emptyState);
        return;
      }
      
      existingTargets.forEach((target, idx) => {
        const item = document.createElement('div');
        item.className =
          'target-item cursor-pointer border-b border-[var(--vscode-panel-border)] px-4 py-3 relative transition-colors hover:bg-[var(--vscode-list-hoverBackground)]' +
          (idx === selectedIdx
            ? ' bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)] selected'
            : '');
        item.dataset.index = idx;

        const url = document.createElement('div');
        url.className = 'font-medium mb-1 break-all';
        url.textContent = target.url;

        const meta = document.createElement('div');
        meta.className = 'text-xs text-[var(--vscode-descriptionForeground)] flex items-center gap-2';

        if (target.context) {
          const context = document.createElement('span');
          context.className = 'italic';
          context.textContent = target.context;
          meta.appendChild(context);
        }
        
        if (idx === selectedIdx) {
          const defaultBadge = document.createElement('span');
          defaultBadge.className = 'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] px-2 rounded-full text-[0.7rem] font-medium';
          defaultBadge.textContent = 'Default';
          meta.appendChild(defaultBadge);
        }
        
        if (target.skipTlsVerify) {
          const tlsBadge = document.createElement('span');
          tlsBadge.className = 'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] px-2 rounded-full text-[0.7rem] font-medium';
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
      
      detailsContent.innerHTML = '';
      const detailsEl = generateDetailsElement(target);
      detailsContent.appendChild(detailsEl);

      // Add event listeners for edit and delete buttons
      const editBtn = detailsEl.querySelector('.edit-btn');
      const deleteBtn = detailsEl.querySelector('.delete-btn');
      
      if (editBtn) {
        editBtn.addEventListener('click', () => editTarget(currentIdx));
      }
      
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => requestDelete(currentIdx));
      }
    }

    function generateDetailsElement(target) {
      const container = document.createElement('div');
      container.className = 'max-w-[500px] pl-4';

      function addRow(label, value, placeholder) {
        const wrap = document.createElement('div');
        wrap.className = 'mb-5';

        const lbl = document.createElement('div');
        lbl.className = 'text-sm font-medium text-[var(--vscode-descriptionForeground)] mb-1';
        lbl.textContent = label;
        wrap.appendChild(lbl);

        const val = document.createElement('div');
        val.className = 'text-sm px-3 py-2 bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded break-all';
        if (placeholder && !value) {
          val.classList.add('text-[var(--vscode-descriptionForeground)]', 'italic');
          val.textContent = placeholder;
        } else {
          val.textContent = value ?? '';
        }
        wrap.appendChild(val);
        container.appendChild(wrap);
      }

      addRow('EDA API URL', target.url);
      addRow('Kubernetes Context', target.context, 'None');
      addRow('EDA Core Namespace', target.coreNamespace || 'eda-system');
      addRow('EDA Username', target.edaUsername || 'admin');
      addRow('EDA Password', target.edaPassword ? '••••••••' : '', 'Not configured');
      addRow('Keycloak Admin Username', target.kcUsername || 'admin');
      addRow('Keycloak Admin Password', target.kcPassword ? '••••••••' : '', 'Not configured');
      addRow('Skip TLS Verification', target.skipTlsVerify ? 'Yes' : 'No');

      const actions = document.createElement('div');
      actions.className = 'flex gap-3 pt-4 mt-6 border-t border-[var(--vscode-panel-border)]';

      const edit = document.createElement('button');
      edit.className = 'px-4 py-2 rounded font-medium text-sm cursor-pointer transition-colors bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] border border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] edit-btn';
      edit.textContent = 'Edit';
      actions.appendChild(edit);

      const del = document.createElement('button');
      del.className = 'px-4 py-2 rounded font-medium text-sm cursor-pointer transition-colors bg-[var(--vscode-errorForeground)] text-[var(--vscode-editor-background)] border-none hover:opacity-90 delete-btn';
      del.textContent = 'Delete';
      actions.appendChild(del);

      container.appendChild(actions);
      return container;
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
      
      detailsContent.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'empty-details';
      const p = document.createElement('p');
      p.className = 'text-gray-500';
      p.textContent = 'Select a target to view details, or add a new target to get started.';
      empty.appendChild(p);
      detailsContent.appendChild(empty);
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

    function requestDelete(idx) {
      vscode.postMessage({
        command: 'confirmDelete',
        index: idx,
        url: existingTargets[idx].url
      });
    }

    function performDelete(idx) {
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

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'deleteConfirmed') {
        performDelete(msg.index);
      }
    });
`;