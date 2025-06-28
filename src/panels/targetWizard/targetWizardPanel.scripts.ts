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
          '<td class="px-2 py-1"><button class="edit text-blue-500" data-index="' + idx + '">Edit</button></td>';
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
          document.getElementById('edaPass').value = '';
          document.getElementById('kcPass').value = '';
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

    document.getElementById('save').addEventListener('click', () => {
      const url = document.getElementById('url').value.trim();
      if (!url) { alert('URL is required'); return; }
      const context = document.getElementById('context').value;
      const edaUsername = document.getElementById('edaUser').value;
      const edaPassword = document.getElementById('edaPass').value;
      const kcUsername = document.getElementById('kcUser').value;
      const kcPassword = document.getElementById('kcPass').value;
      const originalUrl = editIndex !== null ? existingTargets[editIndex].url : null;
      vscode.postMessage({
        command: 'save',
        url,
        context,
        edaUsername,
        edaPassword,
        kcUsername,
        kcPassword,
        originalUrl,
        index: editIndex
      });
    });

    document.querySelectorAll('input').forEach(input => {
      input.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
          document.getElementById('save').click();
        }
      });
    });
`;
