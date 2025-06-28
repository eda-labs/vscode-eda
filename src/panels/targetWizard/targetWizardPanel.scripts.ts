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
      existingTargets.forEach((t, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td class="px-2 py-1"><input type="radio" name="selectedTarget" value="' + idx + '" ' + (idx === selectedIdx ? 'checked' : '') + '></td>' +
          '<td class="px-2 py-1">' + t.url + '</td>' +
          '<td class="px-2 py-1">' + (t.context || '') + '</td>' +
          '<td class="px-2 py-1">' + (t.edaUsername || '') + '</td>' +
          '<td class="px-2 py-1">' + (t.kcUsername || '') + '</td>' +
          '<td class="px-2 py-1"><button class="edit text-blue-500" data-index="' + idx + '">Edit</button>' +
          '<button class="delete text-red-500 ml-2" data-index="' + idx + '">Delete</button></td>';
        tbody.appendChild(tr);
      });
      document.querySelectorAll('button.edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-index'));
          editIndex = idx;
          const t = existingTargets[idx];
          document.getElementById('url').value = t.url;
          document.getElementById('context').value = t.context || '';
          document.getElementById('edaUser').value = t.edaUsername || 'admin';
          document.getElementById('kcUser').value = t.kcUsername || 'admin';
        });
      });
      document.querySelectorAll('button.delete').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-index'));
          const url = existingTargets[idx].url;
          vscode.postMessage({ command: 'delete', url });
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
      const originalUrl = editIndex !== null ? existingTargets[editIndex].url : null;
      vscode.postMessage({
        command,
        url,
        context,
        edaUsername,
        edaPassword,
        kcUsername,
        kcPassword,
        originalUrl,
        index: editIndex
      });
    }

    document.getElementById('save').addEventListener('click', () => {
      const url = document.getElementById('url').value.trim();
      if (!url && editIndex === null) {
        vscode.postMessage({ command: 'close' });
      } else {
        sendData('save');
      }
    });
    document.getElementById('add').addEventListener('click', () => {
      sendData('add');
      const item = {
        url: document.getElementById('url').value.trim(),
        context: document.getElementById('context').value || undefined,
        edaUsername: document.getElementById('edaUser').value || undefined,
        kcUsername: document.getElementById('kcUser').value || undefined,
      };
      if (editIndex !== null) {
        existingTargets[editIndex] = item;
      } else {
        existingTargets.push(item);
      }
      editIndex = null;
      render();
    });

    document.querySelectorAll('input').forEach(input => {
      input.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
          document.getElementById('save').click();
        }
      });
    });
`;
