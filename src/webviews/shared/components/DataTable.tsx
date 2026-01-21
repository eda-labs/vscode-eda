import React, { useState, useMemo, useCallback } from 'react';

export interface Column<T> {
  key: keyof T | string;
  header: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
  onRowClick?: (row: T) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  rowClassName?: string | ((row: T) => string);
}

type SortDirection = 'asc' | 'desc' | null;

interface SortState {
  column: string | null;
  direction: SortDirection;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyField,
  onRowClick,
  searchable = true,
  searchPlaceholder = 'Search...',
  emptyMessage = 'No data available',
  className = '',
  rowClassName
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState>({ column: null, direction: null });

  const handleSort = useCallback((columnKey: string) => {
    setSort(prev => {
      if (prev.column !== columnKey) {
        return { column: columnKey, direction: 'asc' };
      }
      if (prev.direction === 'asc') {
        return { column: columnKey, direction: 'desc' };
      }
      return { column: null, direction: null };
    });
  }, []);

  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    const lowerSearch = search.toLowerCase();
    return data.filter(row =>
      columns.some(col => {
        const value = row[col.key as keyof T];
        return String(value ?? '').toLowerCase().includes(lowerSearch);
      })
    );
  }, [data, search, columns]);

  const sortedData = useMemo(() => {
    if (!sort.column || !sort.direction) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = a[sort.column as keyof T];
      const bVal = b[sort.column as keyof T];
      const aStr = String(aVal ?? '');
      const bStr = String(bVal ?? '');
      const cmp = aStr.localeCompare(bStr, undefined, { numeric: true });
      return sort.direction === 'asc' ? cmp : -cmp;
    });
  }, [filteredData, sort]);

  const getSortIcon = (columnKey: string) => {
    if (sort.column !== columnKey) return '↕';
    return sort.direction === 'asc' ? '↑' : '↓';
  };

  const getRowClasses = (row: T) => {
    const base = 'border-b border-[var(--vscode-widget-border)] hover:bg-[var(--vscode-list-hoverBackground)]';
    const clickable = onRowClick ? 'cursor-pointer' : '';
    const custom = typeof rowClassName === 'function' ? rowClassName(row) : (rowClassName ?? '');
    return `${base} ${clickable} ${custom}`.trim();
  };

  return (
    <div className={className}>
      {searchable && (
        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full px-3 py-1.5 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded focus:outline-none focus:border-[var(--vscode-focusBorder)]"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-[var(--vscode-widget-border)]">
              {columns.map(col => (
                <th
                  key={String(col.key)}
                  className={`px-3 py-2 font-medium text-[var(--vscode-foreground)] ${col.sortable !== false ? 'cursor-pointer select-none hover:bg-[var(--vscode-list-hoverBackground)]' : ''} ${col.className ?? ''}`}
                  onClick={col.sortable !== false ? () => handleSort(String(col.key)) : undefined}
                >
                  <span className="flex items-center gap-1">
                    {col.header}
                    {col.sortable !== false && (
                      <span className="text-xs opacity-50">{getSortIcon(String(col.key))}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-[var(--vscode-descriptionForeground)]"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedData.map(row => (
                <tr
                  key={String(row[keyField])}
                  className={getRowClasses(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map(col => {
                    const value = row[col.key as keyof T];
                    return (
                      <td
                        key={String(col.key)}
                        className={`px-3 py-2 text-[var(--vscode-foreground)] ${col.className ?? ''}`}
                      >
                        {col.render ? col.render(value, row) : String(value ?? '')}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
