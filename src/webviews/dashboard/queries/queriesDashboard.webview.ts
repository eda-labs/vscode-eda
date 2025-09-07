/// <reference lib="dom" />
/* eslint-env browser */
/* eslint-disable no-undef */
declare function acquireVsCodeApi(): {
  postMessage: (msg: any) => void;
};
(function () {
  const vscode = acquireVsCodeApi();
  const queryInput = document.getElementById('queryInput') as HTMLInputElement;
  const queryTypeSelect = document.getElementById('queryTypeSelect') as HTMLSelectElement;
  const queryTypeNote = document.getElementById('queryTypeNote') as HTMLElement;
  const noteText = document.getElementById('noteText') as HTMLElement;
  const autocompleteList = document.getElementById('autocompleteList') as HTMLUListElement;
  const runButton = document.getElementById('runButton') as HTMLButtonElement;
  const nsSelect = document.getElementById('namespaceSelect') as HTMLSelectElement;
  const copyButton = document.getElementById('copyButton') as HTMLButtonElement;
  const formatToggle = document.getElementById('formatToggle') as HTMLElement;
  const formatToggleArea = document.getElementById('formatToggleArea') as HTMLElement;
  const formatMenu = document.getElementById('formatMenu') as HTMLUListElement;
  const headerRow = document.getElementById('headerRow') as HTMLTableRowElement;
  const resultsBody = document.getElementById('resultsBody') as HTMLTableSectionElement;
  const filterRow = document.getElementById('filterRow') as HTMLTableRowElement;
  const statusEl = document.getElementById('status') as HTMLElement;
  const convertedQueryInfo = document.getElementById('convertedQueryInfo') as HTMLElement;
  const convertedEQL = document.getElementById('convertedEQL') as HTMLElement;
  const conversionLabel = document.getElementById('conversionLabel') as HTMLElement;
  const dismissInfo = document.getElementById('dismissInfo') as HTMLButtonElement;
  const showAlternatives = document.getElementById('showAlternatives') as HTMLButtonElement;
  const alternativeQueries = document.getElementById('alternativeQueries') as HTMLElement;
  const alternativesList = document.getElementById('alternativesList') as HTMLUListElement;
  const convertedDescription = document.getElementById('convertedDescription') as HTMLElement;

  let allRows: any[] = [];
  let columns: string[] = [];
  let autocompleteIndex = -1;
  let sortIndex = -1;
  let sortAsc = true;
  let copyFormat: 'ascii' | 'markdown' | 'json' | 'yaml' = 'ascii';

  function formatValue(value: any): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      if (value.length === 0) return '';
      const formatted = value.map(v => formatValue(v));
      const isPrimitive = value.every(
        v => v === null || v === undefined || typeof v !== 'object'
      );
      return formatted.join(isPrimitive ? ', ' : '\n');
    }
    if (typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 0) return '';
      return entries
        .map(([k, v]) => `${k}: ${formatValue(v)}`)
        .join(', ');
    }
    return String(value);
  }

  function pruneEmptyColumns(cols: string[], rows: any[][]): {
    cols: string[];
    rows: any[][];
  } {
    if (!rows.length) {
      return { cols, rows };
    }
    const keep: number[] = [];
    cols.forEach((_, idx) => {
      const hasValue = rows.some(r => formatValue(r[idx]) !== '');
      if (hasValue) keep.push(idx);
    });
    return {
      cols: keep.map(i => cols[i]),
      rows: rows.map(r => keep.map(i => r[i]))
    };
  }


  function updateQueryInputPlaceholder(): void {
    const queryType = queryTypeSelect.value;
    switch (queryType) {
      case 'eql':
        queryInput.placeholder = 'Enter EQL expression (e.g., .namespace.node.name)';
        queryTypeNote.style.display = 'none';
        break;
      case 'nql':
        queryInput.placeholder = 'Enter natural language query (e.g., Which ports are down?)';
        noteText.textContent = 'Natural Query Language (NQL) converts your natural language questions into EQL queries using an LLM.';
        queryTypeNote.style.display = 'block';
        break;
      case 'emb':
        queryInput.placeholder = 'Enter natural language query for embedding search';
        noteText.textContent = 'Embeddings-based natural language support is an experimental way to use natural language with EQL without having to use an LLM.';
        queryTypeNote.style.display = 'block';
        break;
    }
  }

  queryTypeSelect.addEventListener('change', updateQueryInputPlaceholder);
  updateQueryInputPlaceholder(); // Set initial state

  dismissInfo.addEventListener('click', () => {
    convertedQueryInfo.style.display = 'none';
    alternativeQueries.style.display = 'none';
    showAlternatives.classList.remove('expanded');
  });

  showAlternatives.addEventListener('click', () => {
    const isExpanded = showAlternatives.classList.contains('expanded');
    if (isExpanded) {
      alternativeQueries.style.display = 'none';
      showAlternatives.classList.remove('expanded');
    } else {
      alternativeQueries.style.display = 'block';
      showAlternatives.classList.add('expanded');
    }
  });

  function insertAutocomplete(text: string): void {
    const start = queryInput.selectionStart ?? queryInput.value.length;
    const end = queryInput.selectionEnd ?? queryInput.value.length;
    const before = queryInput.value.slice(0, start);
    const after = queryInput.value.slice(end);
    const isWord = /^[a-zA-Z0-9._()-]+$/.test(text);
    let tokenStart = start;
    if (isWord) {
      const match = before.match(/[a-zA-Z0-9._()-]*$/);
      if (match) tokenStart = start - match[0].length;
    }
    const newValue = before.slice(0, tokenStart) + text + after;
    const newPos = tokenStart + text.length;
    queryInput.value = newValue;
    queryInput.setSelectionRange(newPos, newPos);
  }

  runButton.addEventListener('click', () => {
    statusEl.textContent = 'Running...';
    vscode.postMessage({
      command: 'runQuery',
      query: queryInput.value,
      queryType: queryTypeSelect.value,
      namespace: nsSelect.value
    });
    autocompleteList.innerHTML = '';
    autocompleteList.style.display = 'none';
  });

  copyButton.addEventListener('click', e => {
    if (formatToggleArea.contains(e.target as Node)) {
      toggleMenu();
      return;
    }
    copyData();
  });

  function copyData(): void {
    const rows = getFilteredRows();
    let text = '';
    if (copyFormat === 'ascii') {
      text = toAsciiTable(columns, rows);
    } else if (copyFormat === 'markdown') {
      text = toMarkdownTable(columns, rows);
    } else if (copyFormat === 'json') {
      text = toJson(columns, rows);
    } else {
      text = toYaml(columns, rows);
    }
    navigator.clipboard.writeText(text).then(() => {
      copyButton.classList.add('copy-success');
      statusEl.textContent = 'Copied to clipboard';
      setTimeout(() => {
        copyButton.classList.remove('copy-success');
        statusEl.textContent = `Count: ${rows.length}`;
      }, 1000);
    });
  }

  function toggleMenu(): void {
    formatMenu.style.display =
      formatMenu.style.display === 'block' ? 'none' : 'block';
  }

  formatToggle.addEventListener('click', e => {
    e.stopPropagation();
    toggleMenu();
  });

  Array.from(formatMenu.querySelectorAll('li')).forEach(li => {
    li.addEventListener('click', () => {
      copyFormat = (li as HTMLElement).dataset.format as any || 'ascii';
      formatMenu.style.display = 'none';
      copyData();
    });
  });

  queryInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      autocompleteList.innerHTML = '';
      autocompleteList.style.display = 'none';
      autocompleteIndex = -1;
      formatMenu.style.display = 'none';
    } else if (e.key === 'Tab' && autocompleteList.children.length > 0 && queryTypeSelect.value === 'eql') {
      e.preventDefault();
      const target =
        autocompleteIndex >= 0
          ? (autocompleteList.children[autocompleteIndex] as HTMLElement)
          : (autocompleteList.querySelector('li') as HTMLElement | null);
      if (target) {
        insertAutocomplete(target.textContent || '');
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
        if (autocompleteIndex < autocompleteList.children.length - 1) {
          autocompleteIndex++;
        } else if (autocompleteIndex === -1) {
          autocompleteIndex = 0;
        }
      } else {
        if (autocompleteIndex === -1) {
          autocompleteIndex = autocompleteList.children.length - 1;
        } else if (autocompleteIndex > 0) {
          autocompleteIndex--;
        }
      }
      highlightAutocomplete();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (autocompleteIndex >= 0 && !e.metaKey && !e.ctrlKey && queryTypeSelect.value === 'eql') {
        const item = autocompleteList.children[autocompleteIndex] as HTMLElement;
        if (item) {
          insertAutocomplete(item.textContent || '');
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
    if (e.target !== queryInput && !autocompleteList.contains(e.target as Node)) {
      autocompleteList.innerHTML = '';
      autocompleteList.style.display = 'none';
    }
    if (!copyButton.contains(e.target as Node) && !formatMenu.contains(e.target as Node)) {
      formatMenu.style.display = 'none';
    }
  });

  queryInput.addEventListener('input', () => {
    // Only provide autocomplete for EQL queries
    if (queryTypeSelect.value === 'eql') {
      vscode.postMessage({ command: 'autocomplete', query: queryInput.value });
    } else {
      autocompleteList.innerHTML = '';
      autocompleteList.style.display = 'none';
    }
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.command === 'init') {
      nsSelect.innerHTML = '';
      msg.namespaces.forEach((ns: string) => {
        const opt = document.createElement('option');
        opt.value = ns;
        opt.textContent = ns;
        nsSelect.appendChild(opt);
      });
      nsSelect.value = msg.selected || msg.namespaces[0] || '';
      if (document.activeElement !== queryInput) {
        autocompleteList.style.display = 'none';
      }
    } else if (msg.command === 'clear') {
      columns = [];
      allRows = [];
      renderTable([]);
      statusEl.textContent = 'Running...';
      if (document.activeElement !== queryInput) {
        autocompleteList.style.display = 'none';
      }
    } else if (msg.command === 'results') {
      const filtered = pruneEmptyColumns(msg.columns, msg.rows);
      const colsChanged = !arraysEqual(columns, filtered.cols);
      columns = filtered.cols;
      allRows = filtered.rows;
      if (colsChanged) {
        sortIndex = -1;
        sortAsc = true;
        renderTable(allRows);
      } else {
        if (sortIndex >= 0) sortRows();
        applyFilters();
      }
      if (msg.status) {
        statusEl.textContent = msg.status;
      }
      if (document.activeElement !== queryInput) {
        autocompleteList.style.display = 'none';
      }
    } else if (msg.command === 'error') {
      statusEl.textContent = msg.error;
      columns = [];
      allRows = [];
      renderTable([]);
      if (document.activeElement !== queryInput) {
        autocompleteList.style.display = 'none';
      }
    } else if (msg.command === 'autocomplete') {
      autocompleteList.innerHTML = '';
      autocompleteIndex = -1;
      (msg.list || []).forEach((item: string, idx: number) => {
        const li = document.createElement('li');
        li.textContent = item;
        li.dataset.index = String(idx);
        li.addEventListener('mouseover', () => {
          autocompleteIndex = idx;
          highlightAutocomplete();
        });
        li.addEventListener('click', () => {
          insertAutocomplete(item);
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
    } else if (msg.command === 'convertedQuery') {
      // Show the converted query info
      convertedEQL.textContent = msg.eqlQuery;
      convertedQueryInfo.style.display = 'block';

      // Update label based on query type
      if (msg.queryType === 'nql') {
        conversionLabel.textContent = 'NQL converted to EQL:';
        // Keep the original NQL query in the input, just show the conversion info
      } else {
        conversionLabel.textContent = 'Natural language converted to EQL:';
        // For EMB, also keep the original natural language query in the input
        // The converted EQL is already shown in the convertedEQL element
      }

      // Show description if available
      if (msg.description) {
        convertedDescription.textContent = msg.description;
        convertedDescription.style.display = 'block';
      } else {
        convertedDescription.style.display = 'none';
      }

      // Clear and populate alternatives list
      alternativesList.innerHTML = '';
      if (msg.alternatives && msg.alternatives.length > 0) {
        showAlternatives.style.display = 'flex';
        msg.alternatives.forEach((alt: any) => {
          const li = document.createElement('li');

          // Create container for query info
          const queryInfo = document.createElement('div');
          queryInfo.style.flex = '1';

          const code = document.createElement('code');
          code.textContent = alt.query;
          queryInfo.appendChild(code);

          // Add description if available
          if (alt.description) {
            const desc = document.createElement('div');
            desc.style.fontSize = '11px';
            desc.style.color = 'var(--vscode-descriptionForeground)';
            desc.style.marginTop = '2px';
            desc.textContent = alt.description;
            queryInfo.appendChild(desc);
          }


          li.appendChild(queryInfo);

          const score = document.createElement('span');
          score.className = 'score';
          score.textContent = `Score: ${alt.score.toFixed(1)}`;
          li.appendChild(score);

          li.addEventListener('click', () => {
            queryInput.value = alt.query;
            convertedEQL.textContent = alt.query;
            alternativeQueries.style.display = 'none';
            showAlternatives.classList.remove('expanded');
            runButton.click();
          });

          alternativesList.appendChild(li);
        });
      } else {
        showAlternatives.style.display = 'none';
      }
    }
  });

  function renderTable(rows: any[]): void {
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
      filterInput.dataset.idx = String(idx);
      filterInput.addEventListener('input', applyFilters);
      const td = document.createElement('td');
      td.appendChild(filterInput);
      filterRow.appendChild(td);
    });

    renderRows(rows);
  }

  function renderRows(rows: any[]): void {
    resultsBody.innerHTML = '';
    rows.forEach(row => {
      const tr = document.createElement('tr');
      columns.forEach((_, i) => {
        const td = document.createElement('td');
        const div = document.createElement('div');
        div.className = 'cell-content';
        div.textContent = formatValue(row[i]);
        td.appendChild(div);
        tr.appendChild(td);
      });
      resultsBody.appendChild(tr);
    });
  }

  function getFilteredRows(): any[] {
    const inputs = Array.from(filterRow.querySelectorAll('input')) as HTMLInputElement[];
    return allRows.filter(row => {
      return inputs.every(inp => {
        const idx = parseInt(inp.dataset.idx || '0');
        const val = inp.value;
        if (!val) return true;
        try {
          const regex = new RegExp(val, 'i');
          return regex.test(formatValue(row[idx]));
        } catch {
          return formatValue(row[idx]).toLowerCase().includes(val.toLowerCase());
        }
      });
    });
  }

  function applyFilters(): void {
    const filtered = getFilteredRows();
    renderRows(filtered);
    statusEl.textContent = `Count: ${filtered.length}`;
  }

  function sortTable(idx: number): void {
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

  function sortRows(): void {
    if (sortIndex < 0) return;
    allRows.sort((a, b) => {
      const av = formatValue(a[sortIndex]);
      const bv = formatValue(b[sortIndex]);
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  function updateSortClasses(): void {
    Array.from(headerRow.children).forEach((el, i) => {
      el.classList.remove('asc', 'desc');
      if (i === sortIndex) {
        el.classList.add(sortAsc ? 'asc' : 'desc');
      }
    });
  }

  function arraysEqual(a: string[], b: string[]): boolean {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function toMarkdownTable(cols: string[], rows: any[]): string {
    if (!cols.length) return '';
    const header = '| ' + cols.join(' | ') + ' |';
    const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
    const lines = rows.map(r =>
      '| ' +
      cols
        .map((_, i) =>
          formatValue(r[i]).replace(/[|]/g, '\\|').replace(/\n/g, '<br/>')
        )
        .join(' | ') +
      ' |'
    );
    return [header, sep, ...lines].join('\n');
  }

  function toAsciiTable(cols: string[], rows: any[]): string {
    if (!cols.length) return '';
    const widths = cols.map((c, i) =>
      Math.max(c.length, ...rows.map(r => formatValue(r[i]).length))
    );
    const hr = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
    const header =
      '|' + cols.map((c, i) => ' ' + c.padEnd(widths[i]) + ' ').join('|') + '|';
    const lines = rows.map(row =>
      '|' +
      cols
        .map((_, i) => ' ' + formatValue(row[i]).padEnd(widths[i]) + ' ')
        .join('|') +
      '|'
    );
    return [hr, header, hr, ...lines, hr].join('\n');
  }

  function toJson(cols: string[], rows: any[]): string {
    const objs = rows.map(r => {
      const obj: Record<string, any> = {};
      cols.forEach((c, i) => {
        obj[c] = r[i];
      });
      return obj;
    });
    return JSON.stringify(objs, null, 2);
  }

  function toYaml(cols: string[], rows: any[]): string {
    const objs = rows.map(r => {
      const obj: Record<string, any> = {};
      cols.forEach((c, i) => {
        obj[c] = formatValue(r[i]);
      });
      return obj;
    });
    return objs
      .map(o =>
        Object.entries(o)
          .map(([k, v]) => k + ': ' + v)
          .join('\n')
      )
      .join('\n---\n');
  }

  function highlightAutocomplete(): void {
    Array.from(autocompleteList.children).forEach((li, idx) => {
      const elem = li as HTMLElement;
      if (idx === autocompleteIndex) {
        elem.classList.add('selected');
        elem.scrollIntoView({ block: 'nearest' });
      } else {
        elem.classList.remove('selected');
      }
    });
  }

  vscode.postMessage({ command: 'ready' });
})();
