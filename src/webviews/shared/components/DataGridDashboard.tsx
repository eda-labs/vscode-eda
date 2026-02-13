import type { ReactNode } from 'react';
import { useState, useCallback, useMemo, memo } from 'react';
import { Box, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import type { GridColDef, GridSortModel } from '@mui/x-data-grid';

import { shallowArrayEquals } from '../utils';
import { usePostMessage, useMessageListener, useReadySignal } from '../hooks';

import { VSCodeButton } from './VsCodeButton';
import { VsCodeDataGrid } from './VsCodeDataGrid';

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

interface DashboardRow {
  id: string;
  raw: unknown[];
  [key: string]: unknown;
}

function DataGridDashboardInner<T extends DataGridMessage>({
  renderActions,
  renderCell,
  onMessage,
  showInTreeCommand = 'showInTree'
}: Readonly<DataGridDashboardProps<T>>) {
  const postMessage = usePostMessage();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('All Namespaces');
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [hasKubernetesContext, setHasKubernetesContext] = useState(true);
  const [sortModel, setSortModel] = useState<GridSortModel>([]);

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
      setSortModel([]);
    } else if (msg.command === 'results') {
      const newColumns = msg.columns ?? [];
      setColumns(prev => {
        const colsChanged = !shallowArrayEquals(prev, newColumns);
        if (colsChanged) {
          const newNameIdx = newColumns.indexOf('name');
          if (newNameIdx >= 0) {
            setSortModel([{ field: `col_${newNameIdx}`, sort: 'asc' }]);
          } else {
            setSortModel([]);
          }
        }
        return newColumns;
      });
      setRows(msg.rows ?? []);
    }
    onMessage?.(msg);
  }, [onMessage]));

  const handleNamespaceChange = useCallback((ns: string) => {
    setSelectedNamespace(ns);
    postMessage({ command: 'setNamespace', namespace: ns });
  }, [postMessage]);

  const handleShowInTree = useCallback(() => {
    postMessage({ command: showInTreeCommand });
  }, [postMessage, showInTreeCommand]);

  const context: DataGridContext = useMemo(() => ({
    columns,
    nameIdx,
    nsIdx,
    hasKubernetesContext,
    postMessage,
    getColumnIndex
  }), [columns, nameIdx, nsIdx, hasKubernetesContext, postMessage, getColumnIndex]);

  const gridRows = useMemo<DashboardRow[]>(() => {
    return rows.map((row, rowIndex) => {
      const gridRow: DashboardRow = {
        id: String(rowIndex),
        raw: row
      };
      columns.forEach((_, columnIndex) => {
        gridRow[`col_${columnIndex}`] = row[columnIndex];
      });
      return gridRow;
    });
  }, [rows, columns]);

  const gridColumns = useMemo<GridColDef<DashboardRow>[]>(() => {
    const actionColumn: GridColDef<DashboardRow> = {
      field: 'actions',
      headerName: 'Actions',
      sortable: false,
      filterable: false,
      width: 120,
      renderCell: (params) => renderActions(params.row.raw, context)
    };

    const dataColumns = columns.map<GridColDef<DashboardRow>>((column, columnIndex) => {
      const field = `col_${columnIndex}`;
      return {
        field,
        headerName: column,
        width: 180,
        minWidth: 140,
        renderCell: (params) => {
          const value = String(params.row[field] ?? '');
          return <>{renderCell ? renderCell(value, column, columnIndex, params.row.raw) : value}</>;
        }
      };
    });

    return [actionColumn, ...dataColumns];
  }, [columns, renderActions, renderCell, context]);

  return (
    <Box sx={{ p: 3, maxWidth: 1600, mx: 'auto' }}>
      <Stack direction="row" spacing={1.5} justifyContent="flex-end" alignItems="center" sx={{ mb: 2 }}>
        <VSCodeButton onClick={handleShowInTree}>
          Show in VS Code Tree
        </VSCodeButton>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="namespace-label">Namespace</InputLabel>
          <Select
            labelId="namespace-label"
            value={selectedNamespace}
            label="Namespace"
            onChange={(event) => handleNamespaceChange(String(event.target.value))}
          >
            {namespaces.map(ns => (
              <MenuItem key={ns} value={ns}>{ns}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      <VsCodeDataGrid<DashboardRow>
        rows={gridRows}
        columns={gridColumns}
        noRowsMessage="No rows"
        footer={(
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Count: {gridRows.length}
          </Typography>
        )}
        dataGridProps={{
          sortModel,
          onSortModelChange: setSortModel,
          getRowHeight: () => 36
        }}
      />
    </Box>
  );
}

export const DataGridDashboard = memo(DataGridDashboardInner) as typeof DataGridDashboardInner;
