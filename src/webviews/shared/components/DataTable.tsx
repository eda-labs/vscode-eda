import React, { useState, useMemo, useCallback, memo } from 'react';

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

function DataTableInner<T extends Record<string, unknown>>({
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

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

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
    const base = 'border-b border-vscode-border hover:bg-vscode-bg-hover';
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
            onChange={handleSearchChange}
            placeholder={searchPlaceholder}
            className="w-full px-3 py-1.5 bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded focus:outline-none focus:border-(--vscode-focusBorder)"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-vscode-border">
              {columns.map(col => (
                <th
                  key={String(col.key)}
                  className={`px-3 py-2 font-medium text-vscode-text-primary ${col.sortable !== false ? 'cursor-pointer select-none hover:bg-vscode-bg-hover' : ''} ${col.className ?? ''}`}
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
                  className="px-3 py-8 text-center text-vscode-text-secondary"
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
                        className={`px-3 py-2 text-vscode-text-primary ${col.className ?? ''}`}
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

// Wrap with memo using type assertion to preserve generic type
export const DataTable = memo(DataTableInner) as typeof DataTableInner;
