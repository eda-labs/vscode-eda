export const toponodesDashboardScripts = `
  const vscode = acquireVsCodeApi();
  const nsSelect = document.getElementById('namespaceSelect');
  const headerRow = document.getElementById('headerRow');
  const resultsBody = document.getElementById('resultsBody');
  const filterRow = document.getElementById('filterRow');
  const statusEl = document.getElementById('status');

  let allRows = [];
  let columns = [];
  let sortIndex = -1;
  let sortAsc = true;

  nsSelect.addEventListener('change', () => {
    vscode.postMessage({ command: 'setNamespace', namespace: nsSelect.value });
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.command === 'init') {
      nsSelect.innerHTML = '';
      msg.namespaces.forEach(ns => {
        const opt = document.createElement('option');
        opt.value = ns;
        opt.textContent = ns;
        nsSelect.appendChild(opt);
      });
      nsSelect.value = msg.selected || msg.namespaces[0] || '';
    } else if (msg.command === 'clear') {
      columns = [];
      allRows = [];
      renderTable([]);
      statusEl.textContent = 'Loading...';
    } else if (msg.command === 'results') {
      const colsChanged = !arraysEqual(columns, msg.columns);
      columns = msg.columns;
      allRows = msg.rows;
      if (colsChanged) {
        sortIndex = -1;
        sortAsc = true;
        renderTable(allRows);
        statusEl.textContent = msg.status || '';
      } else {
        if (sortIndex >= 0) sortRows();
        applyFilters();
      }
    }
  });

  function renderTable(rows) {
    headerRow.innerHTML = '';
    resultsBody.innerHTML = '';
    filterRow.innerHTML = '';
    sortIndex = -1;
    sortAsc = true;
    if (!columns.length) return;

    columns.forEach((col, idx) => {
      const th = document.createElement('th');
      th.textContent = col;
      th.addEventListener('click', () => sortTable(idx));
      headerRow.appendChild(th);

      const filterInput = document.createElement('input');
      filterInput.dataset.idx = idx;
      filterInput.addEventListener('input', applyFilters);
      const td = document.createElement('td');
      td.appendChild(filterInput);
      filterRow.appendChild(td);
    });

    renderRows(rows);
  }

  function renderRows(rows) {
    resultsBody.innerHTML = '';
    rows.forEach(row => {
      const tr = document.createElement('tr');
      columns.forEach((_, i) => {
        const td = document.createElement('td');
        const val = row[i] == null ? '' : String(row[i]);
        td.textContent = val;
        tr.appendChild(td);
      });
      resultsBody.appendChild(tr);
    });
  }

  function applyFilters() {
    const inputs = Array.from(filterRow.querySelectorAll('input'));
    const filtered = allRows.filter(row => {
      return inputs.every(inp => {
        const idx = parseInt(inp.dataset.idx);
        const val = inp.value.toLowerCase();
        if (!val) return true;
        return String(row[idx] ?? '').toLowerCase().includes(val);
      });
    });
    renderRows(filtered);
    statusEl.textContent = \`Count: \${filtered.length}\`;
  }

  function sortTable(idx) {
    if (sortIndex === idx) {
      sortAsc = !sortAsc;
    } else {
      sortIndex = idx;
      sortAsc = true;
    }
    sortRows();
    updateSortClasses();
    applyFilters();
  }

  function sortRows() {
    if (sortIndex < 0) return;
    allRows.sort((a, b) => {
      const av = a[sortIndex] ?? '';
      const bv = b[sortIndex] ?? '';
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  function updateSortClasses() {
    Array.from(headerRow.children).forEach((el, i) => {
      el.classList.remove('asc', 'desc');
      if (i === sortIndex) {
        el.classList.add(sortAsc ? 'asc' : 'desc');
      }
    });
  }

  function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  vscode.postMessage({ command: 'ready' });
`;
