import type { Dispatch, ReactNode, SetStateAction, TransitionStartFunction } from 'react';
import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useTransition, memo } from 'react';
import SearchIcon from '@mui/icons-material/Search';
import { Box, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import type { GridAutosizeOptions, GridColDef, GridSortModel } from '@mui/x-data-grid';

import { shallowArrayEquals } from '../utils';
import { usePostMessage, useMessageListener, useReadySignal } from '../hooks';

import { LabelsCell, LABELS_CELL_MIN_WIDTH_PX } from './LabelsCell';
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
  /** Optional toolbar actions rendered next to built-in controls */
  renderToolbarActions?: (ctx: DataGridToolbarContext) => ReactNode;
  /** Custom message handler for additional commands */
  onMessage?: (msg: T) => void;
  /** Initial command to send when showing in tree */
  showInTreeCommand?: string;
  /** Default column name used for sorting when columns update */
  defaultSortColumn?: string;
  /** Default sort direction */
  defaultSortDirection?: 'asc' | 'desc';
  /** Enable client-side row filtering */
  enableFilter?: boolean;
  /** Placeholder text for the filter input */
  filterPlaceholder?: string;
  /** Row height for the data grid */
  rowHeight?: number | 'auto';
  /** Minimum width for data columns */
  columnMinWidth?: number;
  /** Maximum width for data columns */
  columnMaxWidth?: number;
  /** Maximum number of characters shown before inline truncation */
  longCellPreviewChars?: number;
  /** Fixed width for the actions column */
  actionColumnWidth?: number;
  /** Enable grid autosizing for this dashboard */
  autoSizeColumns?: boolean;
  /** Autosize behavior for this dashboard */
  autoSizeOptions?: GridAutosizeOptions;
}

export interface DataGridContext {
  columns: string[];
  nameIdx: number;
  nsIdx: number;
  hasKubernetesContext: boolean;
  postMessage: <T>(message: T) => void;
  getColumnIndex: (name: string) => number;
}

export interface DataGridToolbarContext extends DataGridContext {
  selectedNamespace: string;
}

interface DashboardRow {
  id: string;
  raw: unknown[];
}

interface ExpandableTextCellProps {
  value: string;
  rowId: string;
  column: string;
  previewChars: number;
  renderValue?: (value: string) => ReactNode;
  onRequestExpandWidth?: () => void;
  onRequestCollapseWidth?: () => void;
}

const DEFAULT_COLUMN_MIN_WIDTH = 96;
const DEFAULT_COLUMN_MAX_WIDTH = 280;
const DEFAULT_LONG_CELL_PREVIEW_CHARS = 24;
const INTERACTIVE_COLUMN_MAX_WIDTH = 1200;
const ALL_NAMESPACES_LABEL = 'All Namespaces';

type NumberStateSetter = Dispatch<SetStateAction<number>>;
type StringStateSetter = Dispatch<SetStateAction<string>>;
type StringArrayStateSetter = Dispatch<SetStateAction<string[]>>;
type RowArrayStateSetter = Dispatch<SetStateAction<unknown[][]>>;
type SortModelStateSetter = Dispatch<SetStateAction<GridSortModel>>;
type WidthMapStateSetter = Dispatch<SetStateAction<Record<string, number>>>;

interface GridMessageHandlerState<T extends DataGridMessage> {
  msg: T;
  setHasKubernetesContext: Dispatch<SetStateAction<boolean>>;
  setSelectedNamespace: StringStateSetter;
  setColumns: StringArrayStateSetter;
  setRows: RowArrayStateSetter;
  setRowsRevision: NumberStateSetter;
  setColumnWidthOverrides: WidthMapStateSetter;
  setExpandedColumnPreviousWidths: WidthMapStateSetter;
  setFilterText: StringStateSetter;
  setSortModel: SortModelStateSetter;
  startTransition: TransitionStartFunction;
  defaultSortColumn: string;
  defaultSortDirection: 'asc' | 'desc';
}

function pruneInactiveFields(previous: Record<string, number>, activeFields: Set<string>): Record<string, number> {
  let changed = false;
  const next: Record<string, number> = {};
  for (const [field, width] of Object.entries(previous)) {
    if (activeFields.has(field)) {
      next[field] = width;
    } else {
      changed = true;
    }
  }
  return changed ? next : previous;
}

function resolveSortField(columns: string[], defaultSortColumn: string): string | undefined {
  const preferredColumns = [defaultSortColumn, 'name'];
  for (const preferredColumn of preferredColumns) {
    if (!preferredColumn) {
      continue;
    }
    const columnIndex = columns.indexOf(preferredColumn);
    if (columnIndex >= 0) {
      return `col_${columnIndex}`;
    }
  }
  return undefined;
}

function applyRowsMessage(
  msg: DataGridMessage,
  setColumns: StringArrayStateSetter,
  setRows: RowArrayStateSetter,
  setRowsRevision: NumberStateSetter,
  setSortModel: SortModelStateSetter,
  startTransition: TransitionStartFunction,
  defaultSortColumn: string,
  defaultSortDirection: 'asc' | 'desc'
): void {
  const newColumns = msg.columns ?? [];
  const newRows = msg.rows ?? [];
  startTransition(() => {
    setColumns((previousColumns) => {
      const columnsChanged = !shallowArrayEquals(previousColumns, newColumns);
      if (columnsChanged) {
        const sortField = resolveSortField(newColumns, defaultSortColumn);
        setSortModel(sortField ? [{ field: sortField, sort: defaultSortDirection }] : []);
      }
      return newColumns;
    });
    setRows(newRows);
    setRowsRevision((previous) => previous + 1);
  });
}

function resetGridState(
  setColumns: StringArrayStateSetter,
  setRows: RowArrayStateSetter,
  setRowsRevision: NumberStateSetter,
  setColumnWidthOverrides: WidthMapStateSetter,
  setExpandedColumnPreviousWidths: WidthMapStateSetter,
  setFilterText: StringStateSetter,
  setSortModel: SortModelStateSetter
): void {
  setColumns([]);
  setRows([]);
  setRowsRevision((previous) => previous + 1);
  setColumnWidthOverrides({});
  setExpandedColumnPreviousWidths({});
  setFilterText('');
  setSortModel([]);
}

function handleGridMessage<T extends DataGridMessage>({
  msg,
  setHasKubernetesContext,
  setSelectedNamespace,
  setColumns,
  setRows,
  setRowsRevision,
  setColumnWidthOverrides,
  setExpandedColumnPreviousWidths,
  setFilterText,
  setSortModel,
  startTransition,
  defaultSortColumn,
  defaultSortDirection
}: GridMessageHandlerState<T>): void {
  if (typeof msg.hasKubernetesContext === 'boolean') {
    setHasKubernetesContext(msg.hasKubernetesContext);
  }

  switch (msg.command) {
    case 'init':
    case 'namespace':
      setSelectedNamespace(msg.selected ?? ALL_NAMESPACES_LABEL);
      break;
    case 'clear':
      resetGridState(
        setColumns,
        setRows,
        setRowsRevision,
        setColumnWidthOverrides,
        setExpandedColumnPreviousWidths,
        setFilterText,
        setSortModel
      );
      break;
    case 'results':
      applyRowsMessage(
        msg,
        setColumns,
        setRows,
        setRowsRevision,
        setSortModel,
        startTransition,
        defaultSortColumn,
        defaultSortDirection
      );
      break;
    default:
      break;
  }
}

function resolveDashboardProps<T extends DataGridMessage>(props: Readonly<DataGridDashboardProps<T>>) {
  return {
    ...props,
    showInTreeCommand: props.showInTreeCommand ?? 'showInTree',
    defaultSortColumn: props.defaultSortColumn ?? 'name',
    defaultSortDirection: props.defaultSortDirection ?? 'asc',
    enableFilter: props.enableFilter ?? true,
    filterPlaceholder: props.filterPlaceholder ?? 'Filter rows',
    rowHeight: props.rowHeight ?? 36,
    columnMinWidth: props.columnMinWidth ?? DEFAULT_COLUMN_MIN_WIDTH,
    columnMaxWidth: props.columnMaxWidth ?? DEFAULT_COLUMN_MAX_WIDTH,
    longCellPreviewChars: props.longCellPreviewChars ?? DEFAULT_LONG_CELL_PREVIEW_CHARS,
    actionColumnWidth: props.actionColumnWidth ?? 120,
    autoSizeColumns: props.autoSizeColumns ?? false
  };
}

function formatGridCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '';
    }
    const formatted = value.map(item => formatGridCellValue(item));
    const primitiveOnly = value.every(
      item => item === null || item === undefined || typeof item !== 'object'
    );
    return formatted.join(primitiveOnly ? ', ' : '\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return '';
    }
    return entries
      .map(([key, childValue]) => `${key}: ${formatGridCellValue(childValue)}`)
      .join(', ');
  }
  return String(value);
}

function toFinitePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function getCollapsedCellText(value: string, previewChars: number): { text: string; truncated: boolean } {
  const collapsed = collapseWhitespace(value);
  if (!collapsed) {
    return { text: '', truncated: false };
  }
  if (collapsed.length <= previewChars) {
    return { text: collapsed, truncated: false };
  }
  const headLength = Math.max(1, previewChars - 3);
  return {
    text: `${collapsed.slice(0, headLength).trimEnd()}...`,
    truncated: true
  };
}

function estimateExpandedColumnWidth(value: string, minWidth: number, maxWidth: number): number {
  const collapsed = collapseWhitespace(value);
  if (!collapsed) {
    return minWidth;
  }
  const estimated = (Math.min(collapsed.length, 320) * 7) + 84;
  return Math.max(minWidth, Math.min(maxWidth, estimated));
}

function ExpandableTextCell({
  value,
  rowId,
  column,
  previewChars,
  renderValue,
  onRequestExpandWidth,
  onRequestCollapseWidth
}: Readonly<ExpandableTextCellProps>): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [didMeasureOverflow, setDidMeasureOverflow] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setExpanded(false);
  }, [rowId, column, value]);

  const normalizedValue = useMemo(
    () => collapseWhitespace(value),
    [value]
  );
  const isExpandable = useMemo(
    () => getCollapsedCellText(normalizedValue, previewChars).truncated,
    [normalizedValue, previewChars]
  );
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    const evaluateOverflow = () => {
      const hasOverflow = (element.scrollWidth - element.clientWidth) > 1;
      setIsOverflowing((previous) => (previous === hasOverflow ? previous : hasOverflow));
      setDidMeasureOverflow(true);
    };

    evaluateOverflow();
    const observer = new ResizeObserver(() => {
      evaluateOverflow();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [normalizedValue, rowId, column, expanded]);

  let shouldShowMore = false;
  if (!expanded) {
    shouldShowMore = didMeasureOverflow ? isOverflowing : isExpandable;
  }
  const shouldShowLess = expanded;
  const hasToggle = shouldShowMore || shouldShowLess;
  const displayValue = normalizedValue;
  const content = renderValue
    ? renderValue(displayValue)
    : (
      <Typography
        variant="body2"
        component="span"
        sx={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: expanded ? 'clip' : 'ellipsis',
          wordBreak: 'normal'
        }}
      >
        {displayValue}
      </Typography>
    );

  if (!hasToggle) {
    return (
      <Box title={value} sx={{ width: '100%', minWidth: 0, overflow: 'hidden' }}>
        {content}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: '100%',
        minWidth: 0,
        display: 'flex',
        alignItems: expanded ? 'flex-start' : 'center',
        gap: 0.75
      }}
    >
      <Box
        ref={contentRef}
        title={expanded ? undefined : value}
        sx={{
          minWidth: 0,
          flex: 1,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: expanded ? 'clip' : 'ellipsis',
          wordBreak: 'normal'
        }}
      >
        {content}
      </Box>
      <Box
        component="button"
        type="button"
        onClick={() => {
          if (expanded) {
            onRequestCollapseWidth?.();
          } else {
            onRequestExpandWidth?.();
          }
          setExpanded(previous => !previous);
        }}
        sx={{
          border: 'none',
          bgcolor: 'transparent',
          color: 'primary.main',
          p: 0,
          cursor: 'pointer',
          fontSize: '0.75rem',
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          textDecoration: 'underline'
        }}
      >
        {expanded ? 'less' : 'more'}
      </Box>
    </Box>
  );
}

function estimateColumnMinWidth(header: string, minWidth: number, maxWidth: number): number {
  const normalizedHeaderLength = Math.max(4, header.trim().length);
  const estimated = (Math.min(normalizedHeaderLength, 24) * 7) + 28;
  return Math.max(minWidth, Math.min(maxWidth, estimated));
}

function estimateColumnWidth(header: string, minWidth: number, maxWidth: number): number {
  const normalizedHeaderLength = header.trim().length;
  const estimated = (Math.min(Math.max(normalizedHeaderLength, 4), 32) * 7) + 48;
  return Math.max(minWidth, Math.min(maxWidth, estimated));
}

function DataGridDashboardInner<T extends DataGridMessage>(props: Readonly<DataGridDashboardProps<T>>) {
  const {
    renderActions,
    renderCell,
    renderToolbarActions,
    onMessage,
    showInTreeCommand,
    defaultSortColumn,
    defaultSortDirection,
    enableFilter,
    filterPlaceholder,
    rowHeight,
    columnMinWidth,
    columnMaxWidth,
    longCellPreviewChars,
    actionColumnWidth,
    autoSizeColumns,
    autoSizeOptions
  } = resolveDashboardProps(props);
  const postMessage = usePostMessage();
  const [selectedNamespace, setSelectedNamespace] = useState(ALL_NAMESPACES_LABEL);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [rowsRevision, setRowsRevision] = useState(0);
  const [columnWidthOverrides, setColumnWidthOverrides] = useState<Record<string, number>>({});
  const [expandedColumnPreviousWidths, setExpandedColumnPreviousWidths] = useState<Record<string, number>>({});
  const [filterText, setFilterText] = useState('');
  const [hasKubernetesContext, setHasKubernetesContext] = useState(true);
  const [sortModel, setSortModel] = useState<GridSortModel>([]);
  const [, startTransition] = useTransition();

  useReadySignal();

  const nameIdx = useMemo(() => columns.indexOf('name'), [columns]);
  const nsIdx = useMemo(() => columns.indexOf('namespace'), [columns]);

  const getColumnIndex = useCallback((name: string) => columns.indexOf(name), [columns]);

  useEffect(() => {
    const activeFields = new Set(columns.map((_column, index) => `col_${index}`));
    setColumnWidthOverrides((previous) => pruneInactiveFields(previous, activeFields));
    setExpandedColumnPreviousWidths((previous) => pruneInactiveFields(previous, activeFields));
  }, [columns]);

  const handleMessage = useCallback((msg: T) => {
    handleGridMessage({
      msg,
      setHasKubernetesContext,
      setSelectedNamespace,
      setColumns,
      setRows,
      setRowsRevision,
      setColumnWidthOverrides,
      setExpandedColumnPreviousWidths,
      setFilterText,
      setSortModel,
      startTransition,
      defaultSortColumn,
      defaultSortDirection
    });
    onMessage?.(msg);
  }, [onMessage, defaultSortColumn, defaultSortDirection, startTransition]);

  useMessageListener<T>(handleMessage);

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

  const toolbarContext: DataGridToolbarContext = useMemo(() => ({
    ...context,
    selectedNamespace
  }), [context, selectedNamespace]);

  const filteredRows = useMemo(() => {
    if (!enableFilter) {
      return rows;
    }
    const normalizedFilter = filterText.trim().toLowerCase();
    if (!normalizedFilter) {
      return rows;
    }
    return rows.filter((row) => row.some((cell) => formatGridCellValue(cell).toLowerCase().includes(normalizedFilter)));
  }, [enableFilter, filterText, rows]);

  const effectiveColumnMinWidth = useMemo(
    () => Math.max(64, toFinitePositiveInteger(columnMinWidth, DEFAULT_COLUMN_MIN_WIDTH)),
    [columnMinWidth]
  );
  const effectiveColumnMaxWidth = useMemo(() => {
    const parsed = toFinitePositiveInteger(columnMaxWidth, DEFAULT_COLUMN_MAX_WIDTH);
    return Math.max(parsed, effectiveColumnMinWidth);
  }, [columnMaxWidth, effectiveColumnMinWidth]);
  const interactiveColumnMaxWidth = useMemo(
    () => Math.max(effectiveColumnMaxWidth, INTERACTIVE_COLUMN_MAX_WIDTH),
    [effectiveColumnMaxWidth]
  );
  const effectiveLongCellPreviewChars = useMemo(
    () => Math.max(8, toFinitePositiveInteger(longCellPreviewChars, DEFAULT_LONG_CELL_PREVIEW_CHARS)),
    [longCellPreviewChars]
  );
  const effectiveActionColumnWidth = useMemo(
    () => Math.max(96, toFinitePositiveInteger(actionColumnWidth, 120)),
    [actionColumnWidth]
  );

  const hasLabelsColumn = useMemo(() => columns.includes('labels'), [columns]);
  const effectiveRowHeight = useMemo<number | 'auto'>(() => {
    if (hasLabelsColumn) {
      return 'auto';
    }
    return rowHeight;
  }, [hasLabelsColumn, rowHeight]);

  const handleColumnWidthChange = useCallback((params: { field?: string; colDef?: { field?: string }; width: number }) => {
    const field = params.field ?? params.colDef?.field;
    if (!field || !field.startsWith('col_')) {
      return;
    }
    const width = toFinitePositiveInteger(params.width, 1);
    setColumnWidthOverrides((previous) => (previous[field] === width
      ? previous
      : {
        ...previous,
        [field]: width
      }));
  }, []);

  const requestColumnExpand = useCallback((field: string, value: string, minWidth: number, currentWidth: number) => {
    setExpandedColumnPreviousWidths((previous) => {
      if (previous[field] !== undefined) {
        return previous;
      }
      return {
        ...previous,
        [field]: currentWidth
      };
    });

    const estimatedWidth = estimateExpandedColumnWidth(value, currentWidth, interactiveColumnMaxWidth);
    setColumnWidthOverrides((previous) => {
      const current = previous[field] ?? currentWidth;
      const targetWidth = Math.max(current + 120, estimatedWidth);
      const nextWidth = Math.max(minWidth, Math.min(interactiveColumnMaxWidth, targetWidth));
      if (previous[field] === nextWidth) {
        return previous;
      }
      return {
        ...previous,
        [field]: nextWidth
      };
    });
  }, [interactiveColumnMaxWidth]);

  const requestColumnCollapse = useCallback((field: string, fallbackWidth: number, minWidth: number) => {
    const previousWidth = expandedColumnPreviousWidths[field];
    const targetWidth = previousWidth ?? fallbackWidth;
    const nextWidth = Math.max(minWidth, Math.min(interactiveColumnMaxWidth, targetWidth));

    setColumnWidthOverrides((previous) => (previous[field] === nextWidth
      ? previous
      : {
        ...previous,
        [field]: nextWidth
      }));
    setExpandedColumnPreviousWidths((previous) => {
      if (previous[field] === undefined) {
        return previous;
      }
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }, [expandedColumnPreviousWidths, interactiveColumnMaxWidth]);

  const gridRows = useMemo<DashboardRow[]>(() => {
    return filteredRows.map((row, rowIndex) => ({
      id: `${rowsRevision}-${rowIndex}`,
      raw: row
    }));
  }, [filteredRows, rowsRevision]);

  const columnMinWidths = useMemo<number[]>(
    () => columns.map((column) => estimateColumnMinWidth(column, effectiveColumnMinWidth, effectiveColumnMaxWidth)),
    [columns, effectiveColumnMaxWidth, effectiveColumnMinWidth]
  );
  const columnWidths = useMemo<number[]>(
    () => columns.map((column, index) => estimateColumnWidth(column, columnMinWidths[index], effectiveColumnMaxWidth)),
    [columns, columnMinWidths, effectiveColumnMaxWidth]
  );

  const gridColumns = useMemo<GridColDef<DashboardRow>[]>(() => {
    const actionColumn: GridColDef<DashboardRow> = {
      field: 'actions',
      headerName: 'Actions',
      sortable: false,
      filterable: false,
      resizable: false,
      width: effectiveActionColumnWidth,
      minWidth: effectiveActionColumnWidth,
      maxWidth: effectiveActionColumnWidth,
      renderCell: (params) => renderActions(params.row.raw, context)
    };

    const dataColumns = columns.map<GridColDef<DashboardRow>>((column, columnIndex) => {
      const field = `col_${columnIndex}`;
      const isLabelsColumn = column === 'labels';
      const minWidth = isLabelsColumn
        ? Math.max(columnMinWidths[columnIndex], LABELS_CELL_MIN_WIDTH_PX)
        : columnMinWidths[columnIndex];
      const maxWidth = Math.max(interactiveColumnMaxWidth, minWidth);
      const widthOverride = columnWidthOverrides[field];
      const width = widthOverride
        ? Math.max(minWidth, Math.min(maxWidth, widthOverride))
        : Math.max(minWidth, columnWidths[columnIndex]);

      return {
        field,
        headerName: column,
        width,
        minWidth,
        maxWidth,
        valueGetter: (_value, row) => row.raw[columnIndex],
        renderCell: (params) => {
          const value = formatGridCellValue(params.row.raw[columnIndex]);
          if (isLabelsColumn) {
            return <LabelsCell value={value} rowId={params.row.id} />;
          }
          return (
            <ExpandableTextCell
              value={value}
              rowId={params.row.id}
              column={column}
              previewChars={effectiveLongCellPreviewChars}
              onRequestExpandWidth={() => requestColumnExpand(field, value, minWidth, width)}
              onRequestCollapseWidth={() => requestColumnCollapse(field, Math.max(minWidth, columnWidths[columnIndex]), minWidth)}
              renderValue={renderCell
                ? (displayValue) => renderCell(displayValue, column, columnIndex, params.row.raw)
                : undefined}
            />
          );
        }
      };
    });

    return [actionColumn, ...dataColumns];
  }, [
    columns,
    renderActions,
    renderCell,
    context,
    effectiveActionColumnWidth,
    columnWidths,
    columnMinWidths,
    effectiveLongCellPreviewChars,
    columnWidthOverrides,
    interactiveColumnMaxWidth,
    requestColumnExpand,
    requestColumnCollapse
  ]);

  return (
    <Box sx={{ p: 3, maxWidth: 1600, mx: 'auto' }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
        {enableFilter && (
          <TextField
            size="small"
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder={filterPlaceholder}
            sx={{ flex: 1, minWidth: 0 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                )
              }
            }}
          />
        )}
        {!enableFilter && (
          <Box sx={{ flex: 1 }} />
        )}
        {renderToolbarActions?.(toolbarContext)}
        <Typography variant="caption" color="text.secondary">
          Namespace: {selectedNamespace}
        </Typography>
        <VSCodeButton onClick={handleShowInTree}>
          Show in VS Code Tree
        </VSCodeButton>
      </Stack>

      <VsCodeDataGrid<DashboardRow>
        rows={gridRows}
        columns={gridColumns}
        autoSizeColumns={autoSizeColumns}
        autoSizeOptions={autoSizeOptions}
        noRowsMessage="No rows"
        footer={(
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Count: {gridRows.length}{enableFilter && filterText.trim() ? `/${rows.length}` : ''}
          </Typography>
        )}
        dataGridProps={{
          sortModel,
          onSortModelChange: setSortModel,
          onColumnWidthChange: handleColumnWidthChange,
          getRowHeight: () => effectiveRowHeight
        }}
      />
    </Box>
  );
}

export const DataGridDashboard = memo(DataGridDashboardInner) as typeof DataGridDashboardInner;
