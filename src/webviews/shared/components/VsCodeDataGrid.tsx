import type { ReactNode, WheelEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import {
  DataGrid,
  type DataGridProps,
  type GridValidRowModel,
  type GridColDef,
  type GridRowIdGetter
} from '@mui/x-data-grid';

interface VsCodeDataGridProps<R extends GridValidRowModel> {
  rows: R[];
  columns: GridColDef<R>[];
  getRowId?: GridRowIdGetter<R>;
  loading?: boolean;
  toolbar?: ReactNode;
  filters?: ReactNode;
  footer?: ReactNode;
  noRowsMessage?: string;
  dataGridProps?: Partial<DataGridProps<R>>;
}

const MIN_GRID_HEIGHT = 280;
const VIEWPORT_BOTTOM_PADDING = 4;

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
  toolbar,
  filters,
  footer,
  noRowsMessage = 'No rows',
  dataGridProps
}: Readonly<VsCodeDataGridProps<R>>) {
  const paperRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | undefined>(undefined);
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
