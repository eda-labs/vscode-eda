export const queriesDashboardScripts = `
  const vscode = acquireVsCodeApi();
  const queryInput = document.getElementById('queryInput');
  const runButton = document.getElementById('runButton');
  const nsSelect = document.getElementById('namespaceSelect');
  const headerRow = document.getElementById('headerRow');
  const resultsBody = document.getElementById('resultsBody');
  const filtersDiv = document.getElementById('filters');
  const statusEl = document.getElementById('status');

  let allRows = [];
  let columns = [];

  runButton.addEventListener('click', () => {
    statusEl.textContent = 'Running...';
    vscode.postMessage({
      command: 'runQuery',
      query: queryInput.value,
      namespace: nsSelect.value
    });
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
      statusEl.textContent = 'Running...';
    } else if (msg.command === 'results') {
      columns = msg.columns;
      allRows = msg.rows;
      renderTable(allRows);
      statusEl.textContent = msg.status || '';
    } else if (msg.command === 'error') {
      statusEl.textContent = msg.error;
      columns = [];
      allRows = [];
      renderTable([]);
    }
  });

  function renderTable(rows) {
    headerRow.innerHTML = '';
    resultsBody.innerHTML = '';
    filtersDiv.innerHTML = '';
    if (!columns.length) return;

    columns.forEach((col, idx) => {
      const th = document.createElement('th');
      th.textContent = col;
      th.addEventListener('click', () => sortTable(idx));
      const menu = document.createElement('span');
      menu.textContent = '⋮';
      menu.className = 'header-menu';
      menu.addEventListener('click', e => {
        e.stopPropagation();
        toggleColumn(idx);
      });
      th.appendChild(menu);
      headerRow.appendChild(th);

      const filterInput = document.createElement('input');
      filterInput.dataset.idx = idx;
      filterInput.addEventListener('input', applyFilters);
      filtersDiv.appendChild(filterInput);
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
    const inputs = Array.from(filtersDiv.querySelectorAll('input'));
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
    const th = headerRow.children[idx];
    const asc = !th.classList.contains('asc');
    Array.from(headerRow.children).forEach(el => el.classList.remove('asc', 'desc'));
    th.classList.add(asc ? 'asc' : 'desc');
    allRows.sort((a, b) => {
      const av = a[idx] ?? '';
      const bv = b[idx] ?? '';
      if (av < bv) return asc ? -1 : 1;
      if (av > bv) return asc ? 1 : -1;
      return 0;
    });
    applyFilters();
  }

  function toggleColumn(idx) {
    const hide = !headerRow.children[idx].classList.contains('hidden');
    const disp = hide ? 'none' : '';
    headerRow.children[idx].style.display = disp;
    filtersDiv.children[idx].style.display = disp;
    Array.from(resultsBody.children).forEach(row => {
      row.children[idx].style.display = disp;
    });
    if (hide) headerRow.children[idx].classList.add('hidden');
    else headerRow.children[idx].classList.remove('hidden');
  }

  vscode.postMessage({ command: 'ready' });
`;
