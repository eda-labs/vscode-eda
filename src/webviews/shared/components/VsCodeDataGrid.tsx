import type { ReactNode, WheelEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import {
  DataGrid,
  useGridApiRef,
  type DataGridProps,
  type GridAutosizeOptions,
  type GridValidRowModel,
  type GridColDef,
  type GridRowIdGetter
} from '@mui/x-data-grid';

interface VsCodeDataGridProps<R extends GridValidRowModel> {
  rows: R[];
  columns: GridColDef<R>[];
  getRowId?: GridRowIdGetter<R>;
  loading?: boolean;
  autoSizeColumns?: boolean;
  autoSizeOptions?: GridAutosizeOptions;
  toolbar?: ReactNode;
  filters?: ReactNode;
  footer?: ReactNode;
  noRowsMessage?: string;
  dataGridProps?: Partial<DataGridProps<R>>;
}

const MIN_GRID_HEIGHT = 280;
const VIEWPORT_BOTTOM_PADDING = 4;
const DEFAULT_AUTOSIZE_OPTIONS: GridAutosizeOptions = {
  includeHeaders: true,
  includeOutliers: true
};

function autosizeOptionsKey(options: GridAutosizeOptions | undefined): string {
  if (!options) {
    return 'default';
  }
  const columns = options.columns?.join(',') ?? '*';
  return [
    columns,
    String(options.includeHeaders ?? ''),
    String(options.includeHeaderFilters ?? ''),
    String(options.includeOutliers ?? ''),
    String(options.outliersFactor ?? ''),
    String(options.expand ?? ''),
    String(options.disableColumnVirtualization ?? '')
  ].join('|');
}

function getAncestorBottomInset(element: HTMLElement | null): number {
  let inset = 0;
  let current = element?.parentElement ?? null;

  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    inset += Number.parseFloat(style.paddingBottom || '0') || 0;
    inset += Number.parseFloat(style.borderBottomWidth || '0') || 0;
    current = current.parentElement;
  }

  return inset;
}

function NoRowsOverlay({ message }: Readonly<{ message: string }>) {
  return (
    <Box sx={{ py: 4, textAlign: 'center' }}>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}

export function VsCodeDataGrid<R extends GridValidRowModel>({
  rows,
  columns,
  getRowId,
  loading,
  autoSizeColumns = false,
  autoSizeOptions,
  toolbar,
  filters,
  footer,
  noRowsMessage = 'No rows',
  dataGridProps
}: Readonly<VsCodeDataGridProps<R>>) {
  const apiRef = useGridApiRef();
  const paperRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const autoSizeFrameRef = useRef<number | undefined>(undefined);
  const lastAutoSizeKeyRef = useRef<string>('');
  const [gridHeight, setGridHeight] = useState(360);

  const updateGridHeight = useCallback(() => {
    const paperEl = paperRef.current;
    if (!paperEl) {
      return;
    }

    const { top } = paperEl.getBoundingClientRect();
    const ancestorBottomInset = getAncestorBottomInset(paperEl);
    const footerHeight = footerRef.current
      ? Math.ceil(footerRef.current.getBoundingClientRect().height)
      : 0;
    const nextHeight = Math.max(
      MIN_GRID_HEIGHT,
      Math.floor(window.innerHeight - top - VIEWPORT_BOTTOM_PADDING - footerHeight - ancestorBottomInset)
    );

    setGridHeight(prev => (prev === nextHeight ? prev : nextHeight));
  }, []);

  const scheduleGridHeightUpdate = useCallback(() => {
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = undefined;
      updateGridHeight();
    });
  }, [updateGridHeight]);

  useEffect(() => {
    scheduleGridHeightUpdate();

    const handleResize = () => scheduleGridHeightUpdate();
    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => scheduleGridHeightUpdate());
      if (paperRef.current) {
        resizeObserver.observe(paperRef.current);
      }
      if (footerRef.current) {
        resizeObserver.observe(footerRef.current);
      }
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      if (frameRef.current !== undefined) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
    };
  }, [scheduleGridHeightUpdate, footer]);

  useEffect(() => {
    scheduleGridHeightUpdate();
  }, [scheduleGridHeightUpdate, rows.length, columns.length]);

  const currentAutoSizeKey = useMemo(() => {
    if (!autoSizeColumns) {
      return '';
    }
    const fieldKey = columns.map((column) => column.field).join(',');
    return `${fieldKey}|${rows.length}|${autosizeOptionsKey(autoSizeOptions)}`;
  }, [autoSizeColumns, columns, rows.length, autoSizeOptions]);

  useEffect(() => {
    if (!autoSizeColumns) {
      lastAutoSizeKeyRef.current = '';
      if (autoSizeFrameRef.current !== undefined) {
        window.cancelAnimationFrame(autoSizeFrameRef.current);
        autoSizeFrameRef.current = undefined;
      }
      return;
    }
    if (loading || columns.length === 0) {
      return;
    }
    if (lastAutoSizeKeyRef.current === currentAutoSizeKey) {
      return;
    }

    lastAutoSizeKeyRef.current = currentAutoSizeKey;
    autoSizeFrameRef.current = window.requestAnimationFrame(() => {
      autoSizeFrameRef.current = undefined;
      const options = autoSizeOptions ?? DEFAULT_AUTOSIZE_OPTIONS;
      const gridApi = apiRef.current;
      if (!gridApi) {
        return;
      }
      void gridApi.autosizeColumns(options).catch(() => {});
    });

    return () => {
      if (autoSizeFrameRef.current !== undefined) {
        window.cancelAnimationFrame(autoSizeFrameRef.current);
        autoSizeFrameRef.current = undefined;
      }
    };
  }, [apiRef, autoSizeColumns, autoSizeOptions, columns.length, currentAutoSizeKey, loading]);

  const handleWheelCapture = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!event.shiftKey && Math.abs(event.deltaX) < 1) {
      return;
    }

    let horizontalDelta = 0;
    if (event.deltaX !== 0) {
      horizontalDelta = event.deltaX;
    } else if (event.shiftKey) {
      horizontalDelta = event.deltaY;
    }
    if (horizontalDelta === 0) {
      return;
    }

    const scroller = event.currentTarget.querySelector<HTMLDivElement>('.MuiDataGrid-virtualScroller');
    if (!scroller) {
      return;
    }

    scroller.scrollLeft += horizontalDelta;
    event.preventDefault();
  }, []);

  return (
    <Box sx={{ width: '100%' }}>
      {toolbar}
      {filters}
      <Paper
        ref={paperRef}
        variant="outlined"
        onWheelCapture={handleWheelCapture}
        sx={{
          boxSizing: 'border-box',
          width: '100%',
          height: `${gridHeight}px`,
          minHeight: `${MIN_GRID_HEIGHT}px`
        }}
      >
        <DataGrid
          apiRef={apiRef}
          rows={rows}
          columns={columns}
          getRowId={getRowId}
          loading={loading}
          disableRowSelectionOnClick
          density="compact"
          {...dataGridProps}
          sx={{ height: '100%', minHeight: 0 }}
          pageSizeOptions={[25, 50, 100]}
          initialState={{
            pagination: {
              paginationModel: {
                pageSize: 25,
                page: 0
              }
            }
          }}
          slots={{
            noRowsOverlay: () => <NoRowsOverlay message={noRowsMessage} />
          }}
        />
      </Paper>
      {footer && (
        <Box ref={footerRef} sx={{ pt: 1 }}>
          {footer}
        </Box>
      )}
    </Box>
  );
}
