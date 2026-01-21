import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { usePostMessage, useMessageListener, useReadySignal, useCopyToClipboard } from '../../shared/hooks';
import { shallowArrayEquals, mountWebview } from '../../shared/utils';
import { formatValue, pruneEmptyColumns, formatForClipboard, CopyFormat } from './queryFormatters';

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
  rows?: unknown[][];
  status?: string;
  error?: string;
  list?: string[];
  eqlQuery?: string;
  queryType?: string;
  description?: string;
  alternatives?: Alternative[];
}

type QueryType = 'eql' | 'nql' | 'emb';

// Grouped state for conversion display
interface ConversionState {
  show: boolean;
  eql: string;
  label: string;
  description: string;
  alternatives: Alternative[];
  showAlternatives: boolean;
}

const initialConversionState: ConversionState = {
  show: false,
  eql: '',
  label: 'Query converted to EQL:',
  description: '',
  alternatives: [],
  showAlternatives: false
};

// Grouped state for sort
interface SortState {
  index: number;
  ascending: boolean;
}

// Grouped state for autocomplete
interface AutocompleteState {
  list: string[];
  index: number;
}

function QueriesDashboard() {
  const postMessage = usePostMessage();
  useReadySignal();
  const { copied, copyToClipboard } = useCopyToClipboard({ successDuration: 1000 });

  // Namespace state
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');

  // Query state
  const [queryInput, setQueryInput] = useState('');
  const [queryType, setQueryType] = useState<QueryType>('eql');

  // Results state
  const [columns, setColumns] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<unknown[][]>([]);
  const [filters, setFilters] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>({ index: -1, ascending: true });
  const [status, setStatus] = useState('Ready');

  // UI state
  const [autocomplete, setAutocomplete] = useState<AutocompleteState>({ list: [], index: -1 });
  const [copyFormat, setCopyFormat] = useState<CopyFormat>('ascii');
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const [conversion, setConversion] = useState<ConversionState>(initialConversionState);

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
        setSort({ index: -1, ascending: true });
        setStatus('Running...');
        break;
      case 'results': {
        const filtered = pruneEmptyColumns(msg.columns || [], msg.rows || []);
        setColumns(prev => {
          const colsChanged = !shallowArrayEquals(prev, filtered.cols);
          if (colsChanged) {
            setSort({ index: -1, ascending: true });
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
        setAutocomplete({ list: msg.list || [], index: -1 });
        break;
      case 'convertedQuery':
        setConversion({
          show: true,
          eql: msg.eqlQuery || '',
          label: msg.queryType === 'nql' ? 'NQL converted to EQL:' : 'Natural language converted to EQL:',
          description: msg.description || '',
          alternatives: msg.alternatives || [],
          showAlternatives: false
        });
        break;
    }
  }, []));

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
    if (sort.index < 0) return allRows;
    return [...allRows].sort((a, b) => {
      const av = formatValue(a[sort.index]);
      const bv = formatValue(b[sort.index]);
      if (av < bv) return sort.ascending ? -1 : 1;
      if (av > bv) return sort.ascending ? 1 : -1;
      return 0;
    });
  }, [allRows, sort]);

  // Pre-compile regexes for filters to avoid creating them in the filter loop
  const compiledFilters = useMemo(() => {
    return filters.map(f => {
      if (!f) return null;
      try {
        return { type: 'regex' as const, pattern: new RegExp(f, 'i') };
      } catch {
        return { type: 'string' as const, pattern: f.toLowerCase() };
      }
    });
  }, [filters]);

  const filteredRows = useMemo(() => {
    return sortedRows.filter(row => {
      return compiledFilters.every((compiled, idx) => {
        if (!compiled) return true;
        const value = formatValue(row[idx]);
        if (compiled.type === 'regex') {
          return compiled.pattern.test(value);
        }
        return value.toLowerCase().includes(compiled.pattern);
      });
    });
  }, [sortedRows, compiledFilters]);

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
    setAutocomplete({ list: [], index: -1 });
  }, [postMessage, queryInput, queryType, selectedNamespace]);

  const handleQueryInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQueryInput(value);
    if (queryType === 'eql') {
      postMessage({ command: 'autocomplete', query: value });
    } else {
      setAutocomplete({ list: [], index: -1 });
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
      setAutocomplete({ list: [], index: -1 });
      setShowFormatMenu(false);
    } else if (e.key === 'Tab' && autocomplete.list.length > 0 && queryType === 'eql') {
      e.preventDefault();
      const target = autocomplete.index >= 0 ? autocomplete.list[autocomplete.index] : autocomplete.list[0];
      if (target) {
        insertAutocomplete(target);
      }
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && autocomplete.list.length > 0) {
      e.preventDefault();
      if (e.key === 'ArrowDown') {
        setAutocomplete(prev => ({
          ...prev,
          index: prev.index < prev.list.length - 1 ? prev.index + 1 : (prev.index === -1 ? 0 : prev.index)
        }));
      } else {
        setAutocomplete(prev => ({
          ...prev,
          index: prev.index === -1 ? prev.list.length - 1 : (prev.index > 0 ? prev.index - 1 : prev.index)
        }));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (autocomplete.index >= 0 && !e.metaKey && !e.ctrlKey && queryType === 'eql') {
        const item = autocomplete.list[autocomplete.index];
        if (item) {
          insertAutocomplete(item);
        }
      } else {
        handleRunQuery();
      }
    }
  }, [autocomplete, queryType, insertAutocomplete, handleRunQuery]);

  const handleSort = useCallback((idx: number) => {
    setSort(prev => ({
      index: idx,
      ascending: prev.index === idx ? !prev.ascending : true
    }));
  }, []);

  const handleFilterChange = useCallback((idx: number, value: string) => {
    setFilters(prev => {
      const newFilters = [...prev];
      newFilters[idx] = value;
      return newFilters;
    });
  }, []);

  const handleCopy = useCallback(async () => {
    const text = formatForClipboard(copyFormat, columns, filteredRows);
    const success = await copyToClipboard(text);
    if (success) {
      setStatus('Copied to clipboard');
      setTimeout(() => setStatus(`Count: ${filteredRows.length}`), 1000);
    }
  }, [copyFormat, columns, filteredRows, copyToClipboard]);

  const handleAlternativeClick = useCallback((alt: Alternative) => {
    setQueryInput(alt.query);
    setConversion(prev => ({ ...prev, eql: alt.query, showAlternatives: false }));
    setTimeout(() => handleRunQuery(), 0);
  }, [handleRunQuery]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.query-input-wrapper')) {
        setAutocomplete(prev => ({ ...prev, list: [] }));
      }
      if (!target.closest('.copy-dropdown')) {
        setShowFormatMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-2 flex-1 relative mr-2">
          <label className="flex items-center" htmlFor="queryInput">
            <span className="codicon codicon-search mr-1"></span> Query
          </label>
          <select
            className="bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded px-2 py-1 mr-2 min-w-[60px]"
            value={queryType}
            onChange={(e) => setQueryType(e.target.value as QueryType)}
          >
            <option value="eql">EQL</option>
            <option value="nql">NQL</option>
            <option value="emb">EMB</option>
          </select>
          <div className="query-input-wrapper flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              className="w-full px-2 py-1 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded"
              placeholder={queryPlaceholder}
              value={queryInput}
              onChange={handleQueryInputChange}
              onKeyDown={handleKeyDown}
            />
            {autocomplete.list.length > 0 && (
              <ul className="list-none m-0 p-0 absolute left-0 right-0 top-full bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] border-t-0 max-h-[200px] overflow-y-auto z-10">
                {autocomplete.list.map((item, idx) => (
                  <li
                    key={idx}
                    className={`px-2 py-0.5 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] ${idx === autocomplete.index ? 'bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]' : ''}`}
                    onMouseOver={() => setAutocomplete(prev => ({ ...prev, index: idx }))}
                    onClick={() => insertAutocomplete(item)}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            className="px-3 py-1 border-none bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded cursor-pointer hover:bg-[var(--vscode-button-hoverBackground)]"
            onClick={handleRunQuery}
          >
            Run
          </button>
          <div className="flex items-center gap-0.5">
            <div className="copy-dropdown relative flex">
              <button
                className={`flex items-center gap-1 px-3 py-1 pr-0 border-none rounded cursor-pointer ${copied ? 'bg-[var(--vscode-debugConsole-infoForeground)]' : 'bg-[var(--vscode-button-background)]'} text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]`}
                onClick={handleCopy}
              >
                <span>Copy</span>
                <span
                  className="flex items-center py-0 px-3 pl-1 ml-1 border-l border-[var(--vscode-panel-border)] cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFormatMenu(prev => !prev);
                  }}
                >
                  <span className="codicon codicon-chevron-down"></span>
                </span>
              </button>
              {showFormatMenu && (
                <ul className="list-none m-0 p-0 absolute right-0 top-full bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] z-10">
                  {(['ascii', 'markdown', 'json', 'yaml'] as CopyFormat[]).map(fmt => (
                    <li
                      key={fmt}
                      className="px-2 py-0.5 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)]"
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
          className="bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded px-2 py-1"
          value={selectedNamespace}
          onChange={(e) => setSelectedNamespace(e.target.value)}
        >
          {namespaces.map(ns => (
            <option key={ns} value={ns}>{ns}</option>
          ))}
        </select>
      </header>

      {queryTypeNote && (
        <div className="bg-[var(--vscode-editorHoverWidget-background)] border border-[var(--vscode-editorHoverWidget-border)] rounded mb-3 text-xs">
          <div className="flex items-center gap-2 py-2 px-3">
            <span className="text-[var(--vscode-notificationsInfoIcon-foreground)] text-sm">{'\u2139\uFE0F'}</span>
            <span className="text-[var(--vscode-notifications-foreground)] italic">{queryTypeNote}</span>
          </div>
        </div>
      )}

      {conversion.show && (
        <div className="bg-[var(--vscode-notifications-background)] border border-[var(--vscode-notifications-border)] rounded mb-4 text-sm">
          <div className="flex items-center gap-2 py-3 px-4">
            <span className="text-[var(--vscode-notificationsInfoIcon-foreground)] text-base">{'\u2139\uFE0F'}</span>
            <div className="flex-1 text-[var(--vscode-notifications-foreground)]">
              <div><span>{conversion.label}</span> <code className="bg-[var(--vscode-textBlockQuote-background)] px-1.5 py-0.5 rounded text-xs font-mono">{conversion.eql}</code></div>
              {conversion.description && (
                <div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1 italic">{conversion.description}</div>
              )}
            </div>
            {conversion.alternatives.length > 0 && (
              <button
                className={`bg-transparent border-none text-[var(--vscode-notifications-foreground)] cursor-pointer p-1 flex items-center transition-transform ${conversion.showAlternatives ? 'rotate-180' : ''}`}
                title="Show alternative queries"
                onClick={() => setConversion(prev => ({ ...prev, showAlternatives: !prev.showAlternatives }))}
              >
                <span className="codicon codicon-chevron-down"></span>
              </button>
            )}
            <button
              className="bg-transparent border-none text-[var(--vscode-notifications-foreground)] text-xl cursor-pointer p-1 opacity-70 hover:opacity-100"
              onClick={() => setConversion(initialConversionState)}
            >
              {'\u00D7'}
            </button>
          </div>
          {conversion.showAlternatives && conversion.alternatives.length > 0 && (
            <div className="px-4 pb-3 border-t border-[var(--vscode-notifications-border)]">
              <div className="my-2 font-medium text-[var(--vscode-notifications-foreground)]">Alternative queries:</div>
              <ul className="list-none m-0 p-0 max-h-[200px] overflow-y-auto">
                {conversion.alternatives.map((alt, idx) => (
                  <li
                    key={idx}
                    className="flex justify-between items-start gap-3 py-2 px-2.5 my-1 bg-[var(--vscode-textBlockQuote-background)] rounded cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)]"
                    onClick={() => handleAlternativeClick(alt)}
                  >
                    <div className="flex-1">
                      <code className="font-mono text-xs">{alt.query}</code>
                      {alt.description && (
                        <div className="text-[11px] text-[var(--vscode-descriptionForeground)] mt-0.5">
                          {alt.description}
                        </div>
                      )}
                    </div>
                    <span className="text-[11px] text-[var(--vscode-descriptionForeground)] ml-2">Score: {alt.score.toFixed(1)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="overflow-auto max-h-[85vh]">
        <table className="w-max min-w-full border-collapse rounded-lg overflow-hidden">
          <thead>
            <tr>
              {columns.map((col, idx) => (
                <th
                  key={col}
                  onClick={() => handleSort(idx)}
                  className="border border-[var(--vscode-panel-border)] px-2 py-1 bg-[var(--vscode-panel-background)] cursor-pointer select-none text-left"
                >
                  {col}
                  {sort.index === idx && (
                    <span className="ml-1">{sort.ascending ? '\u25B2' : '\u25BC'}</span>
                  )}
                </th>
              ))}
            </tr>
            <tr>
              {columns.map((_, idx) => (
                <td key={idx} className="border border-[var(--vscode-panel-border)] p-0 bg-[var(--vscode-editorWidget-background)]">
                  <input
                    value={filters[idx] || ''}
                    onChange={(e) => handleFilterChange(idx, e.target.value)}
                    className="w-full px-1 py-0.5 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border-none rounded-sm"
                  />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-[var(--vscode-list-hoverBackground)]">
                {columns.map((_, colIdx) => (
                  <td key={colIdx} className="border border-[var(--vscode-panel-border)] px-2 py-1 whitespace-pre align-top">
                    <div className="max-w-[600px] max-h-[200px] overflow-auto whitespace-pre-wrap">{formatValue(row[colIdx])}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pt-1 border-t border-[var(--vscode-panel-border)] mt-2">
        <span>{status}</span>
      </div>
    </div>
  );
}

mountWebview(QueriesDashboard);
