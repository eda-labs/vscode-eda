export const queriesDashboardScripts = `
  const vscode = acquireVsCodeApi();
  const queryInput = document.getElementById('queryInput');
  const autocompleteList = document.getElementById('autocompleteList');
  const runButton = document.getElementById('runButton');
  const nsSelect = document.getElementById('namespaceSelect');
  const formatSelect = document.getElementById('formatSelect');
  const copyButton = document.getElementById('copyButton');
  const headerRow = document.getElementById('headerRow');
  const resultsBody = document.getElementById('resultsBody');
  const filterRow = document.getElementById('filterRow');
  const statusEl = document.getElementById('status');

  let allRows = [];
  let columns = [];
  let autocompleteIndex = -1;
  let sortIndex = -1;
  let sortAsc = true;

  runButton.addEventListener('click', () => {
    statusEl.textContent = 'Running...';
    vscode.postMessage({
      command: 'runQuery',
      query: queryInput.value,
      namespace: nsSelect.value
    });
    autocompleteList.innerHTML = '';
    autocompleteList.style.display = 'none';
  });

  copyButton.addEventListener('click', () => {
    const rows = getFilteredRows();
    const format = formatSelect.value;
    const text =
      format === 'ascii'
        ? toAsciiTable(columns, rows)
        : toMarkdownTable(columns, rows);
    navigator.clipboard.writeText(text).then(() => {
      copyButton.classList.add('copy-success');
      statusEl.textContent = 'Copied to clipboard';
      setTimeout(() => {
        copyButton.classList.remove('copy-success');
        statusEl.textContent = \`Count: \${rows.length}\`;
      }, 1000);
    });
  });

  queryInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      autocompleteList.innerHTML = '';
      autocompleteList.style.display = 'none';
      autocompleteIndex = -1;
    } else if (e.key === 'Tab' && autocompleteList.children.length > 0) {
      e.preventDefault();
      const target =
        autocompleteIndex >= 0
          ? autocompleteList.children[autocompleteIndex]
          : autocompleteList.querySelector('li');
      if (target) {
        queryInput.value = target.textContent || '';
      }
      autocompleteList.innerHTML = '';
      autocompleteList.style.display = 'block';
      autocompleteIndex = -1;
      vscode.postMessage({ command: 'autocomplete', query: queryInput.value });
    } else if (
      (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
      autocompleteList.children.length > 0
    ) {
      e.preventDefault();
      if (e.key === 'ArrowDown') {
        autocompleteIndex = (autocompleteIndex + 1) % autocompleteList.children.length;
      } else {
        autocompleteIndex =
          (autocompleteIndex - 1 + autocompleteList.children.length) %
          autocompleteList.children.length;
      }
      highlightAutocomplete();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (autocompleteIndex >= 0 && !e.metaKey && !e.ctrlKey) {
        const item = autocompleteList.children[autocompleteIndex];
        if (item) {
          queryInput.value = item.textContent || '';
        }
        autocompleteList.innerHTML = '';
        autocompleteList.style.display = 'block';
        autocompleteIndex = -1;
        vscode.postMessage({ command: 'autocomplete', query: queryInput.value });
      } else {
        runButton.click();
      }
    }
  });

  document.addEventListener('click', e => {
    if (e.target !== queryInput && !autocompleteList.contains(e.target)) {
      autocompleteList.innerHTML = '';
      autocompleteList.style.display = 'none';
    }
  });

  queryInput.addEventListener('input', () => {
    vscode.postMessage({ command: 'autocomplete', query: queryInput.value });
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
      autocompleteList.style.display = 'none';
    } else if (msg.command === 'clear') {
      columns = [];
      allRows = [];
      renderTable([]);
      statusEl.textContent = 'Running...';
      autocompleteList.style.display = 'none';
    } else if (msg.command === 'results') {
      const colsChanged = !arraysEqual(columns, msg.columns);
      columns = msg.columns;
      allRows = msg.rows;
      if (colsChanged) {
        sortIndex = -1;
        sortAsc = true;
        renderTable(allRows);
      }
      if (msg.status) {
        statusEl.textContent = msg.status;
      } else {
        if (!colsChanged && sortIndex >= 0) sortRows();
        applyFilters();
      }
      autocompleteList.style.display = 'none';
    } else if (msg.command === 'error') {
      statusEl.textContent = msg.error;
      columns = [];
      allRows = [];
      renderTable([]);
      autocompleteList.style.display = 'none';
    } else if (msg.command === 'autocomplete') {
      autocompleteList.innerHTML = '';
      autocompleteIndex = -1;
      (msg.list || []).forEach((item, idx) => {
        const li = document.createElement('li');
        li.textContent = item;
        li.dataset.index = String(idx);
        li.addEventListener('mouseover', () => {
          autocompleteIndex = idx;
          highlightAutocomplete();
        });
        li.addEventListener('click', () => {
          queryInput.value = item;
          autocompleteList.innerHTML = '';
          autocompleteList.style.display = 'block';
          autocompleteIndex = -1;
          vscode.postMessage({ command: 'autocomplete', query: queryInput.value });
        });
        autocompleteList.appendChild(li);
      });
      autocompleteList.style.display =
        msg.list && msg.list.length ? 'block' : 'none';
      highlightAutocomplete();
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
      // Previously a header menu allowed hiding columns. Removed per request.
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

  function getFilteredRows() {
    const inputs = Array.from(filterRow.querySelectorAll('input'));
    return allRows.filter(row => {
      return inputs.every(inp => {
        const idx = parseInt(inp.dataset.idx);
        const val = inp.value.toLowerCase();
        if (!val) return true;
        return String(row[idx] ?? '').toLowerCase().includes(val);
      });
    });
  }

  function applyFilters() {
    const filtered = getFilteredRows();
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

  function toMarkdownTable(cols, rows) {
    if (!cols.length) return '';
    const header = '| ' + cols.join(' | ') + ' |';
    const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
    const lines = rows.map(r =>
      '| ' +
      cols
        .map((_, i) => String(r[i] ?? '').replace(/[|]/g, '\\|'))
        .join(' | ') +
      ' |'
    );
    return [header, sep, ...lines].join('\\n');
  }

  function toAsciiTable(cols, rows) {
    if (!cols.length) return '';
    const widths = cols.map((c, i) =>
      Math.max(c.length, ...rows.map(r => String(r[i] ?? '').length))
    );
    const hr = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
    const header =
      '|' + cols.map((c, i) => ' ' + c.padEnd(widths[i]) + ' ').join('|') + '|';
    const lines = rows.map(row =>
      '|' +
      cols
        .map((_, i) => ' ' + String(row[i] ?? '').padEnd(widths[i]) + ' ')
        .join('|') +
      '|'
    );
    return [hr, header, hr, ...lines, hr].join('\\n');
  }

  function highlightAutocomplete() {
    Array.from(autocompleteList.children).forEach((li, idx) => {
      if (idx === autocompleteIndex) li.classList.add('selected');
      else li.classList.remove('selected');
    });
  }

  vscode.postMessage({ command: 'ready' });
`;
