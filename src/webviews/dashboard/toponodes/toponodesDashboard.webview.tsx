import React from 'react';
import { createRoot } from 'react-dom/client';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { usePostMessage, useMessageListener } from '../../shared/hooks';
import { VSCodeProvider } from '../../shared/context';
import { VSCodeButton } from '../../shared/components';

interface ToponodesMessage {
  command: string;
  namespaces?: string[];
  selected?: string;
  hasKubernetesContext?: boolean;
  columns?: string[];
  rows?: unknown[][];
  status?: string;
}

function ToponodesDashboard() {
  const postMessage = usePostMessage();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('All Namespaces');
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [hasKubernetesContext, setHasKubernetesContext] = useState(true);
  const [filters, setFilters] = useState<Record<number, string>>({});
  const [sortIndex, setSortIndex] = useState<number>(-1);
  const [sortAsc, setSortAsc] = useState(true);

  const nameIdx = useMemo(() => columns.indexOf('name'), [columns]);
  const nsIdx = useMemo(() => columns.indexOf('namespace'), [columns]);
  const nodeDetailsIdx = useMemo(() => columns.indexOf('node-details'), [columns]);

  useMessageListener<ToponodesMessage>(useCallback((msg) => {
    if (typeof msg.hasKubernetesContext === 'boolean') {
      setHasKubernetesContext(msg.hasKubernetesContext);
    }
    if (msg.command === 'init') {
      setNamespaces(msg.namespaces ?? []);
      setSelectedNamespace(msg.selected ?? msg.namespaces?.[0] ?? '');
    } else if (msg.command === 'clear') {
      setColumns([]);
      setRows([]);
    } else if (msg.command === 'results') {
      const newColumns = msg.columns ?? [];
      setColumns(prev => {
        const colsChanged = JSON.stringify(prev) !== JSON.stringify(newColumns);
        if (colsChanged) {
          setFilters({});
          const newNameIdx = newColumns.indexOf('name');
          if (newNameIdx >= 0) {
            setSortIndex(newNameIdx);
            setSortAsc(true);
          } else {
            setSortIndex(-1);
          }
        }
        return newColumns;
      });
      setRows(msg.rows ?? []);
    }
  }, []));

  useEffect(() => {
    postMessage({ command: 'ready' });
  }, [postMessage]);

  const handleNamespaceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const ns = e.target.value;
    setSelectedNamespace(ns);
    postMessage({ command: 'setNamespace', namespace: ns });
  }, [postMessage]);

  const handleShowInTree = useCallback(() => {
    postMessage({ command: 'showInTree' });
  }, [postMessage]);

  const handleViewConfig = useCallback((row: unknown[]) => {
    const name = nameIdx >= 0 ? row[nameIdx] : '';
    const ns = nsIdx >= 0 ? row[nsIdx] : '';
    postMessage({ command: 'viewNodeConfig', name, namespace: ns });
  }, [postMessage, nameIdx, nsIdx]);

  const handleSSH = useCallback((row: unknown[]) => {
    const name = nameIdx >= 0 ? row[nameIdx] : '';
    const ns = nsIdx >= 0 ? row[nsIdx] : '';
    const nodeDetails = nodeDetailsIdx >= 0 ? row[nodeDetailsIdx] : undefined;
    postMessage({ command: 'sshTopoNode', name, namespace: ns, nodeDetails });
  }, [postMessage, nameIdx, nsIdx, nodeDetailsIdx]);

  const handleSort = useCallback((idx: number) => {
    if (sortIndex === idx) {
      setSortAsc(!sortAsc);
    } else {
      setSortIndex(idx);
      setSortAsc(true);
    }
  }, [sortIndex, sortAsc]);

  const handleFilterChange = useCallback((idx: number, value: string) => {
    setFilters(prev => ({ ...prev, [idx]: value }));
  }, []);

  const filteredAndSortedRows = useMemo(() => {
    let result = rows;

    // Apply filters
    const activeFilters = Object.entries(filters).filter(([, v]) => v.trim());
    if (activeFilters.length > 0) {
      result = result.filter(row =>
        activeFilters.every(([idxStr, filterVal]) => {
          const idx = parseInt(idxStr);
          const val = String(row[idx] ?? '').toLowerCase();
          return val.includes(filterVal.toLowerCase());
        })
      );
    }

    // Apply sort
    if (sortIndex >= 0) {
      result = [...result].sort((a, b) => {
        const av = a[sortIndex] ?? '';
        const bv = b[sortIndex] ?? '';
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortAsc ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, filters, sortIndex, sortAsc]);

  const displayStatus = useMemo(() => {
    return `Count: ${filteredAndSortedRows.length}`;
  }, [filteredAndSortedRows.length]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <header className="flex items-center justify-end mb-4 gap-2">
        <VSCodeButton onClick={handleShowInTree}>
          Show in VS Code Tree
        </VSCodeButton>
        <select
          value={selectedNamespace}
          onChange={handleNamespaceChange}
          className="px-2 py-1 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded"
        >
          {namespaces.map(ns => (
            <option key={ns} value={ns}>{ns}</option>
          ))}
        </select>
      </header>

      <div className="overflow-auto max-h-[85vh]">
        <table className="w-full border-collapse rounded-lg overflow-hidden text-sm">
          <thead>
            <tr>
              <th className="border border-[var(--vscode-panel-border)] px-2 py-1 bg-[var(--vscode-panel-background)] text-left">
                Actions
              </th>
              {columns.map((col, idx) => (
                <th
                  key={col}
                  className="border border-[var(--vscode-panel-border)] px-2 py-1 bg-[var(--vscode-panel-background)] cursor-pointer select-none text-left"
                  onClick={() => handleSort(idx)}
                >
                  {col}
                  {sortIndex === idx && (
                    <span className="ml-1 text-xs">{sortAsc ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
            <tr className="filters">
              <td className="border border-[var(--vscode-panel-border)] p-0 bg-[var(--vscode-editorWidget-background)]" />
              {columns.map((_, idx) => (
                <td key={idx} className="border border-[var(--vscode-panel-border)] p-0 bg-[var(--vscode-editorWidget-background)]">
                  <input
                    type="text"
                    value={filters[idx] ?? ''}
                    onChange={(e) => handleFilterChange(idx, e.target.value)}
                    className="w-full px-1 py-0.5 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded-sm"
                  />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedRows.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-[var(--vscode-list-hoverBackground)]">
                <td className="border border-[var(--vscode-panel-border)] px-2 py-1 whitespace-pre">
                  <button
                    className="mr-1 p-1 border-none bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded cursor-pointer inline-flex items-center justify-center hover:bg-[var(--vscode-button-hoverBackground)]"
                    title="View Config"
                    onClick={() => handleViewConfig(row)}
                  >
                    <span className="codicon codicon-file-code" />
                  </button>
                  <button
                    className="p-1 border-none bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded cursor-pointer inline-flex items-center justify-center hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"
                    title={hasKubernetesContext ? 'SSH' : 'Kubernetes context needs to be set to enable SSH'}
                    disabled={!hasKubernetesContext}
                    onClick={() => handleSSH(row)}
                  >
                    <span className="codicon codicon-terminal" />
                  </button>
                </td>
                {columns.map((_, colIdx) => (
                  <td key={colIdx} className="border border-[var(--vscode-panel-border)] px-2 py-1 whitespace-pre">
                    {row[colIdx] == null ? '' : String(row[colIdx])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pt-1 border-t border-[var(--vscode-panel-border)] mt-2">
        <span>{displayStatus}</span>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <VSCodeProvider>
      <ToponodesDashboard />
    </VSCodeProvider>
  );
}
