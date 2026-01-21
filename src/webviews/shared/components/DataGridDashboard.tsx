import React, { useState, useCallback, useMemo, memo, ReactNode } from 'react';
import { shallowArrayEquals } from '../utils';
import { usePostMessage, useMessageListener, useReadySignal } from '../hooks';
import { VSCodeButton } from './VSCodeButton';

export interface DataGridAction {
  icon: string;
  title: string;
  disabled?: boolean;
  disabledTitle?: string;
  onClick: (row: unknown[]) => void;
}

export interface DataGridMessage {
  command: string;
  namespaces?: string[];
  selected?: string;
  hasKubernetesContext?: boolean;
  columns?: string[];
  rows?: unknown[][];
}

export interface DataGridDashboardProps<T extends DataGridMessage> {
  /** Function to render action buttons for each row */
  renderActions: (row: unknown[], ctx: DataGridContext) => ReactNode;
  /** Function to render cell content with optional custom styling */
  renderCell?: (value: string, column: string, colIdx: number, row: unknown[]) => ReactNode;
  /** Custom message handler for additional commands */
  onMessage?: (msg: T) => void;
  /** Initial command to send when showing in tree */
  showInTreeCommand?: string;
}

export interface DataGridContext {
  columns: string[];
  nameIdx: number;
  nsIdx: number;
  hasKubernetesContext: boolean;
  postMessage: <T>(message: T) => void;
  getColumnIndex: (name: string) => number;
}

function DataGridDashboardInner<T extends DataGridMessage>({
  renderActions,
  renderCell,
  onMessage,
  showInTreeCommand = 'showInTree'
}: DataGridDashboardProps<T>) {
  const postMessage = usePostMessage();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('All Namespaces');
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [hasKubernetesContext, setHasKubernetesContext] = useState(true);
  const [filters, setFilters] = useState<Record<number, string>>({});
  const [sortIndex, setSortIndex] = useState<number>(-1);
  const [sortAsc, setSortAsc] = useState(true);

  useReadySignal();

  const nameIdx = useMemo(() => columns.indexOf('name'), [columns]);
  const nsIdx = useMemo(() => columns.indexOf('namespace'), [columns]);

  const getColumnIndex = useCallback((name: string) => columns.indexOf(name), [columns]);

  useMessageListener<T>(useCallback((msg) => {
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
        const colsChanged = !shallowArrayEquals(prev, newColumns);
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
    onMessage?.(msg);
  }, [onMessage]));

  const handleNamespaceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const ns = e.target.value;
    setSelectedNamespace(ns);
    postMessage({ command: 'setNamespace', namespace: ns });
  }, [postMessage]);

  const handleShowInTree = useCallback(() => {
    postMessage({ command: showInTreeCommand });
  }, [postMessage, showInTreeCommand]);

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

  const context: DataGridContext = useMemo(() => ({
    columns,
    nameIdx,
    nsIdx,
    hasKubernetesContext,
    postMessage,
    getColumnIndex
  }), [columns, nameIdx, nsIdx, hasKubernetesContext, postMessage, getColumnIndex]);

  return (
    <div className="p-6 max-w-350 mx-auto">
      <header className="flex items-center justify-end mb-4 gap-2">
        <VSCodeButton onClick={handleShowInTree}>
          Show in VS Code Tree
        </VSCodeButton>
        <select
          value={selectedNamespace}
          onChange={handleNamespaceChange}
          className="px-2 py-1 bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded"
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
              <th className="border border-vscode-border px-2 py-1 bg-vscode-bg-secondary text-left">
                Actions
              </th>
              {columns.map((col, idx) => (
                <th
                  key={col}
                  className="border border-vscode-border px-2 py-1 bg-vscode-bg-secondary cursor-pointer select-none text-left"
                  onClick={() => handleSort(idx)}
                >
                  {col}
                  {sortIndex === idx && (
                    <span className="ml-1 text-xs">{sortAsc ? '\u25B2' : '\u25BC'}</span>
                  )}
                </th>
              ))}
            </tr>
            <tr className="filters">
              <td className="border border-vscode-border p-0 bg-vscode-bg-widget" />
              {columns.map((_, idx) => (
                <td key={idx} className="border border-vscode-border p-0 bg-vscode-bg-widget">
                  <input
                    type="text"
                    value={filters[idx] ?? ''}
                    onChange={(e) => handleFilterChange(idx, e.target.value)}
                    className="w-full px-1 py-0.5 bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded-sm"
                  />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedRows.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-vscode-bg-hover">
                <td className="border border-vscode-border px-2 py-1 whitespace-pre">
                  {renderActions(row, context)}
                </td>
                {columns.map((col, colIdx) => {
                  const value = row[colIdx] == null ? '' : String(row[colIdx]);
                  const content = renderCell ? renderCell(value, col, colIdx, row) : value;
                  return (
                    <td key={colIdx} className="border border-vscode-border px-2 py-1 whitespace-pre">
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pt-1 border-t border-vscode-border mt-2">
        <span>{displayStatus}</span>
      </div>
    </div>
  );
}

export const DataGridDashboard = memo(DataGridDashboardInner) as typeof DataGridDashboardInner;
