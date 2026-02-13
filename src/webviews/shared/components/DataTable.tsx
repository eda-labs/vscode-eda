import React, { useState, useMemo, useCallback, memo } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import type { GridColDef, GridSortModel } from '@mui/x-data-grid';

import { VsCodeDataGrid } from './VsCodeDataGrid';

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

type TableRow<T> = {
  id: string;
  raw: T;
} & Record<string, unknown>;

function DataTableInner<T extends Record<string, unknown>>({
  columns,
  data,
  keyField,
  onRowClick,
  searchable = true,
  searchPlaceholder = 'Search...',
  emptyMessage = 'No data available',
  className = ''
}: Readonly<DataTableProps<T>>) {
  const [search, setSearch] = useState('');
  const [sortModel, setSortModel] = useState<GridSortModel>([]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
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

  const rows = useMemo<TableRow<T>[]>(() => {
    return filteredData.map((row, index) => {
      const gridRow: TableRow<T> = {
        id: String(row[keyField] ?? index),
        raw: row
      };
      columns.forEach((column, columnIndex) => {
        const field = `col_${columnIndex}`;
        gridRow[field] = row[column.key as keyof T];
      });
      return gridRow;
    });
  }, [filteredData, columns, keyField]);

  const gridColumns = useMemo<GridColDef<TableRow<T>>[]>(() => {
    return columns.map((column, columnIndex) => {
      const field = `col_${columnIndex}`;
      return {
        field,
        headerName: column.header,
        sortable: column.sortable !== false,
        width: 180,
        minWidth: 140,
        renderCell: (params) => {
          const value = params.row[field];
          return <>{column.render ? column.render(value, params.row.raw) : String(value ?? '')}</>;
        }
      };
    });
  }, [columns]);

  return (
    <Box className={className}>
      {searchable && (
        <Box sx={{ mb: 1.5 }}>
          <TextField
            size="small"
            fullWidth
            value={search}
            onChange={handleSearchChange}
            placeholder={searchPlaceholder}
          />
        </Box>
      )}
      <VsCodeDataGrid<TableRow<T>>
        rows={rows}
        columns={gridColumns}
        noRowsMessage={emptyMessage}
        footer={(
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Count: {rows.length}
          </Typography>
        )}
        dataGridProps={{
          sortModel,
          onSortModelChange: setSortModel,
          onRowClick: onRowClick
            ? (params) => onRowClick((params.row as TableRow<T>).raw)
            : undefined
        }}
      />
    </Box>
  );
}

// Wrap with memo using type assertion to preserve generic type
export const DataTable = memo(DataTableInner) as typeof DataTableInner;
