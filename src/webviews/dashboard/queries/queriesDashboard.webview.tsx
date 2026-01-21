import React from 'react';
import { createRoot } from 'react-dom/client';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { usePostMessage, useMessageListener } from '../../shared/hooks';
import { VSCodeProvider } from '../../shared/context';

interface Alternative {
  query: string;
  description?: string;
  score: number;
}

interface QueriesMessage {
  command: string;
  namespaces?: string[];
  selected?: string;
  columns?: string[];
  rows?: any[][];
  status?: string;
  error?: string;
  list?: string[];
  eqlQuery?: string;
  queryType?: string;
  description?: string;
  alternatives?: Alternative[];
}

type CopyFormat = 'ascii' | 'markdown' | 'json' | 'yaml';

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

function pruneEmptyColumns(cols: string[], rows: any[][]): { cols: string[]; rows: any[][] } {
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

function toAsciiTable(cols: string[], rows: any[][]): string {
  if (!cols.length) return '';
  const widths = cols.map((c, i) =>
    Math.max(c.length, ...rows.map(r => formatValue(r[i]).length))
  );
  const hr = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const header = '|' + cols.map((c, i) => ' ' + c.padEnd(widths[i]) + ' ').join('|') + '|';
  const lines = rows.map(row =>
    '|' + cols.map((_, i) => ' ' + formatValue(row[i]).padEnd(widths[i]) + ' ').join('|') + '|'
  );
  return [hr, header, hr, ...lines, hr].join('\n');
}

function toMarkdownTable(cols: string[], rows: any[][]): string {
  if (!cols.length) return '';
  const header = '| ' + cols.join(' | ') + ' |';
  const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
  const lines = rows.map(r =>
    '| ' +
    cols.map((_, i) =>
      formatValue(r[i]).replace(/[|]/g, '\\|').replace(/\n/g, '<br/>')
    ).join(' | ') +
    ' |'
  );
  return [header, sep, ...lines].join('\n');
}

function toJson(cols: string[], rows: any[][]): string {
  const objs = rows.map(r => {
    const obj: Record<string, any> = {};
    cols.forEach((c, i) => {
      obj[c] = r[i];
    });
    return obj;
  });
  return JSON.stringify(objs, null, 2);
}

function toYaml(cols: string[], rows: any[][]): string {
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

function QueriesDashboard() {
  const postMessage = usePostMessage();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [queryType, setQueryType] = useState<'eql' | 'nql' | 'emb'>('eql');
  const [columns, setColumns] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<any[][]>([]);
  const [filters, setFilters] = useState<string[]>([]);
  const [sortIndex, setSortIndex] = useState(-1);
  const [sortAsc, setSortAsc] = useState(true);
  const [status, setStatus] = useState('Ready');
  const [autocompleteList, setAutocompleteList] = useState<string[]>([]);
  const [autocompleteIndex, setAutocompleteIndex] = useState(-1);
  const [copyFormat, setCopyFormat] = useState<CopyFormat>('ascii');
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const [showConvertedQuery, setShowConvertedQuery] = useState(false);
  const [convertedEQL, setConvertedEQL] = useState('');
  const [conversionLabel, setConversionLabel] = useState('Query converted to EQL:');
  const [convertedDescription, setConvertedDescription] = useState('');
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [showAlternatives, setShowAlternatives] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useMessageListener<QueriesMessage>(useCallback((msg) => {
    switch (msg.command) {
      case 'init':
        setNamespaces(msg.namespaces || []);
        setSelectedNamespace(msg.selected || (msg.namespaces?.[0] || ''));
        break;
      case 'clear':
        setColumns([]);
        setAllRows([]);
        setSortIndex(-1);
        setSortAsc(true);
        setStatus('Running...');
        break;
      case 'results': {
        const filtered = pruneEmptyColumns(msg.columns || [], msg.rows || []);
        setColumns(prev => {
          const colsChanged = JSON.stringify(prev) !== JSON.stringify(filtered.cols);
          if (colsChanged) {
            setSortIndex(-1);
            setSortAsc(true);
            setFilters(new Array(filtered.cols.length).fill(''));
          }
          return filtered.cols;
        });
        setAllRows(filtered.rows);
        if (msg.status) {
          setStatus(msg.status);
        }
        break;
      }
      case 'error':
        setStatus(msg.error || 'Error');
        setColumns([]);
        setAllRows([]);
        break;
      case 'autocomplete':
        setAutocompleteList(msg.list || []);
        setAutocompleteIndex(-1);
        break;
      case 'convertedQuery':
        setConvertedEQL(msg.eqlQuery || '');
        setShowConvertedQuery(true);
        if (msg.queryType === 'nql') {
          setConversionLabel('NQL converted to EQL:');
        } else {
          setConversionLabel('Natural language converted to EQL:');
        }
        if (msg.description) {
          setConvertedDescription(msg.description);
        } else {
          setConvertedDescription('');
        }
        setAlternatives(msg.alternatives || []);
        setShowAlternatives(false);
        break;
    }
  }, []));

  useEffect(() => {
    postMessage({ command: 'ready' });
  }, [postMessage]);

  const queryTypeNote = useMemo(() => {
    switch (queryType) {
      case 'nql':
        return 'Natural Query Language (NQL) converts your natural language questions into EQL queries using an LLM.';
      case 'emb':
        return 'Embeddings-based natural language support is an experimental way to use natural language with EQL without having to use an LLM.';
      default:
        return null;
    }
  }, [queryType]);

  const queryPlaceholder = useMemo(() => {
    switch (queryType) {
      case 'eql':
        return 'Enter EQL expression (e.g., .namespace.node.name)';
      case 'nql':
        return 'Enter natural language query (e.g., Which ports are down?)';
      case 'emb':
        return 'Enter natural language query for embedding search';
    }
  }, [queryType]);

  const sortedRows = useMemo(() => {
    if (sortIndex < 0) return allRows;
    return [...allRows].sort((a, b) => {
      const av = formatValue(a[sortIndex]);
      const bv = formatValue(b[sortIndex]);
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [allRows, sortIndex, sortAsc]);

  const filteredRows = useMemo(() => {
    return sortedRows.filter(row => {
      return filters.every((f, idx) => {
        if (!f) return true;
        try {
          const regex = new RegExp(f, 'i');
          return regex.test(formatValue(row[idx]));
        } catch {
          return formatValue(row[idx]).toLowerCase().includes(f.toLowerCase());
        }
      });
    });
  }, [sortedRows, filters]);

  useEffect(() => {
    setStatus(`Count: ${filteredRows.length}`);
  }, [filteredRows.length]);

  const handleRunQuery = useCallback(() => {
    setStatus('Running...');
    postMessage({
      command: 'runQuery',
      query: queryInput,
      queryType,
      namespace: selectedNamespace
    });
    setAutocompleteList([]);
  }, [postMessage, queryInput, queryType, selectedNamespace]);

  const handleQueryInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQueryInput(value);
    if (queryType === 'eql') {
      postMessage({ command: 'autocomplete', query: value });
    } else {
      setAutocompleteList([]);
    }
  }, [postMessage, queryType]);

  const insertAutocomplete = useCallback((text: string) => {
    const input = inputRef.current;
    if (!input) return;

    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const isWord = /^[a-zA-Z0-9._()-]+$/.test(text);
    let tokenStart = start;
    if (isWord) {
      const match = before.match(/[a-zA-Z0-9._()-]*$/);
      if (match) tokenStart = start - match[0].length;
    }
    const newValue = before.slice(0, tokenStart) + text + after;
    const newPos = tokenStart + text.length;
    setQueryInput(newValue);
    setTimeout(() => {
      input.setSelectionRange(newPos, newPos);
      postMessage({ command: 'autocomplete', query: newValue });
    }, 0);
  }, [postMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setAutocompleteList([]);
      setAutocompleteIndex(-1);
      setShowFormatMenu(false);
    } else if (e.key === 'Tab' && autocompleteList.length > 0 && queryType === 'eql') {
      e.preventDefault();
      const target = autocompleteIndex >= 0 ? autocompleteList[autocompleteIndex] : autocompleteList[0];
      if (target) {
        insertAutocomplete(target);
      }
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && autocompleteList.length > 0) {
      e.preventDefault();
      if (e.key === 'ArrowDown') {
        setAutocompleteIndex(prev =>
          prev < autocompleteList.length - 1 ? prev + 1 : (prev === -1 ? 0 : prev)
        );
      } else {
        setAutocompleteIndex(prev =>
          prev === -1 ? autocompleteList.length - 1 : (prev > 0 ? prev - 1 : prev)
        );
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (autocompleteIndex >= 0 && !e.metaKey && !e.ctrlKey && queryType === 'eql') {
        const item = autocompleteList[autocompleteIndex];
        if (item) {
          insertAutocomplete(item);
        }
      } else {
        handleRunQuery();
      }
    }
  }, [autocompleteList, autocompleteIndex, queryType, insertAutocomplete, handleRunQuery]);

  const handleSort = useCallback((idx: number) => {
    if (sortIndex === idx) {
      setSortAsc(prev => !prev);
    } else {
      setSortIndex(idx);
      setSortAsc(true);
    }
  }, [sortIndex]);

  const handleFilterChange = useCallback((idx: number, value: string) => {
    setFilters(prev => {
      const newFilters = [...prev];
      newFilters[idx] = value;
      return newFilters;
    });
  }, []);

  const handleCopy = useCallback(() => {
    let text = '';
    if (copyFormat === 'ascii') {
      text = toAsciiTable(columns, filteredRows);
    } else if (copyFormat === 'markdown') {
      text = toMarkdownTable(columns, filteredRows);
    } else if (copyFormat === 'json') {
      text = toJson(columns, filteredRows);
    } else {
      text = toYaml(columns, filteredRows);
    }
    navigator.clipboard.writeText(text).then(() => {
      setCopySuccess(true);
      setStatus('Copied to clipboard');
      setTimeout(() => {
        setCopySuccess(false);
        setStatus(`Count: ${filteredRows.length}`);
      }, 1000);
    });
  }, [copyFormat, columns, filteredRows]);

  const handleAlternativeClick = useCallback((alt: Alternative) => {
    setQueryInput(alt.query);
    setConvertedEQL(alt.query);
    setShowAlternatives(false);
    setTimeout(() => handleRunQuery(), 0);
  }, [handleRunQuery]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.query-input-wrapper')) {
        setAutocompleteList([]);
      }
      if (!target.closest('.copy-dropdown')) {
        setShowFormatMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <div className="dashboard">
      <header className="header">
        <div className="query-bar">
          <label className="query-label" htmlFor="queryInput">
            <span className="codicon codicon-search"></span> Query
          </label>
          <select
            className="query-type-select"
            value={queryType}
            onChange={(e) => setQueryType(e.target.value as 'eql' | 'nql' | 'emb')}
          >
            <option value="eql">EQL</option>
            <option value="nql">NQL</option>
            <option value="emb">EMB</option>
          </select>
          <div className="query-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className="query-input"
              placeholder={queryPlaceholder}
              value={queryInput}
              onChange={handleQueryInputChange}
              onKeyDown={handleKeyDown}
            />
            {autocompleteList.length > 0 && (
              <ul className="autocomplete-list" style={{ display: 'block' }}>
                {autocompleteList.map((item, idx) => (
                  <li
                    key={idx}
                    className={idx === autocompleteIndex ? 'selected' : ''}
                    onMouseOver={() => setAutocompleteIndex(idx)}
                    onClick={() => insertAutocomplete(item)}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button className="run-btn" onClick={handleRunQuery}>Run</button>
          <div className="format-copy">
            <div className="copy-dropdown">
              <button
                className={`run-btn copy-btn ${copySuccess ? 'copy-success' : ''}`}
                onClick={handleCopy}
              >
                <span>Copy</span>
                <span
                  className="format-toggle"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFormatMenu(prev => !prev);
                  }}
                >
                  <span className="codicon codicon-chevron-down"></span>
                </span>
              </button>
              {showFormatMenu && (
                <ul className="dropdown-menu" style={{ display: 'block' }}>
                  {(['ascii', 'markdown', 'json', 'yaml'] as CopyFormat[]).map(fmt => (
                    <li
                      key={fmt}
                      data-format={fmt}
                      onClick={() => {
                        setCopyFormat(fmt);
                        setShowFormatMenu(false);
                        handleCopy();
                      }}
                    >
                      {fmt.toUpperCase()}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        <select
          className="select"
          value={selectedNamespace}
          onChange={(e) => setSelectedNamespace(e.target.value)}
        >
          {namespaces.map(ns => (
            <option key={ns} value={ns}>{ns}</option>
          ))}
        </select>
      </header>

      {queryTypeNote && (
        <div className="query-type-note">
          <div className="note-content">
            <span className="note-icon">{'\u2139\uFE0F'}</span>
            <span className="note-text">{queryTypeNote}</span>
          </div>
        </div>
      )}

      {showConvertedQuery && (
        <div className="converted-query-info">
          <div className="converted-query-main">
            <span className="info-icon">{'\u2139\uFE0F'}</span>
            <div className="info-text">
              <div><span>{conversionLabel}</span> <code>{convertedEQL}</code></div>
              {convertedDescription && (
                <div className="converted-description">{convertedDescription}</div>
              )}
            </div>
            {alternatives.length > 0 && (
              <button
                className={`show-alternatives-btn ${showAlternatives ? 'expanded' : ''}`}
                title="Show alternative queries"
                onClick={() => setShowAlternatives(prev => !prev)}
              >
                <span className="codicon codicon-chevron-down"></span>
              </button>
            )}
            <button className="dismiss-btn" onClick={() => {
              setShowConvertedQuery(false);
              setShowAlternatives(false);
            }}>{'\u00D7'}</button>
          </div>
          {showAlternatives && alternatives.length > 0 && (
            <div className="alternative-queries">
              <div className="alternatives-header">Alternative queries:</div>
              <ul className="alternatives-list">
                {alternatives.map((alt, idx) => (
                  <li key={idx} onClick={() => handleAlternativeClick(alt)}>
                    <div style={{ flex: 1 }}>
                      <code>{alt.query}</code>
                      {alt.description && (
                        <div style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px' }}>
                          {alt.description}
                        </div>
                      )}
                    </div>
                    <span className="score">Score: {alt.score.toFixed(1)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="results-container">
        <table className="results-table">
          <thead>
            <tr>
              {columns.map((col, idx) => (
                <th
                  key={col}
                  onClick={() => handleSort(idx)}
                  className={sortIndex === idx ? (sortAsc ? 'asc' : 'desc') : ''}
                >
                  {col}
                </th>
              ))}
            </tr>
            <tr className="filters">
              {columns.map((_, idx) => (
                <td key={idx}>
                  <input
                    value={filters[idx] || ''}
                    onChange={(e) => handleFilterChange(idx, e.target.value)}
                  />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {columns.map((_, colIdx) => (
                  <td key={colIdx}>
                    <div className="cell-content">{formatValue(row[colIdx])}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="status-bar">
        <span>{status}</span>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <VSCodeProvider>
      <QueriesDashboard />
    </VSCodeProvider>
  );
}
