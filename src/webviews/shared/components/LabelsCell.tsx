import type { ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';

import { parseLabelsText, toLabelText, type ParsedLabel } from './labelUtils';

interface LabelsCellProps {
  value: string;
  rowId: string;
}

interface LabelChipProps {
  label: ParsedLabel;
  expanded: boolean;
  setMeasureRef?: (element: HTMLDivElement | null) => void;
}

const LABEL_CHIP_GAP_PX = 6;
const LABEL_CHIP_MAX_WIDTH_PX = 192;
const MORE_BUTTON_RESERVED_WIDTH_PX = 72;
export const LABELS_CELL_MIN_WIDTH_PX = LABEL_CHIP_MAX_WIDTH_PX + MORE_BUTTON_RESERVED_WIDTH_PX + 24;

function estimateLabelWidth(label: ParsedLabel): number {
  const textLength = toLabelText(label).length;
  const estimatedTextWidth = Math.min(textLength, 64) * 7;
  return Math.max(72, estimatedTextWidth + 28);
}

function LabelChip({ label, expanded, setMeasureRef }: Readonly<LabelChipProps>): ReactNode {
  return (
    <Box
      ref={setMeasureRef}
      title={toLabelText(label)}
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 0.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 0.75,
        bgcolor: 'action.hover',
        px: 0.75,
        py: 0.25,
        minWidth: 0,
        maxWidth: expanded ? '100%' : `${LABEL_CHIP_MAX_WIDTH_PX}px`,
        flexShrink: 0
      }}
    >
      <Typography
        variant="body2"
        component="span"
        sx={{
          fontFamily: 'monospace',
          lineHeight: 1.2,
          whiteSpace: expanded ? 'normal' : 'nowrap',
          overflow: expanded ? 'visible' : 'hidden',
          textOverflow: expanded ? 'clip' : 'ellipsis',
          wordBreak: expanded ? 'break-word' : 'normal'
        }}
      >
        {toLabelText(label)}
      </Typography>
    </Box>
  );
}

export function LabelsCell({ value, rowId }: Readonly<LabelsCellProps>): ReactNode {
  const labels = useMemo(() => parseLabelsText(value), [value]);
  const [expanded, setExpanded] = useState(false);
  const [cellWidth, setCellWidth] = useState(0);
  const [visibleCount, setVisibleCount] = useState(labels.length);
  const cellRef = useRef<HTMLDivElement | null>(null);
  const measurementRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    setExpanded(false);
  }, [rowId, value]);

  useEffect(() => {
    measurementRefs.current = measurementRefs.current.slice(0, labels.length);
  }, [labels.length]);

  useEffect(() => {
    const element = cellRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.floor(entry.contentRect.width);
        setCellWidth((previous) => (previous === width ? previous : width));
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const fitLabelsInWidth = useCallback((availableWidth: number): number => {
    if (labels.length === 0) {
      return 0;
    }
    if (availableWidth <= 0) {
      return 1;
    }

    let usedWidth = 0;
    let count = 0;
    for (let index = 0; index < labels.length; index += 1) {
      const measurement = measurementRefs.current[index];
      const measuredWidth = measurement
        ? Math.ceil(measurement.getBoundingClientRect().width)
        : estimateLabelWidth(labels[index]);
      const candidateWidth = count === 0
        ? measuredWidth
        : usedWidth + LABEL_CHIP_GAP_PX + measuredWidth;
      if (candidateWidth > availableWidth) {
        break;
      }
      usedWidth = candidateWidth;
      count += 1;
    }
    return Math.max(1, count);
  }, [labels]);

  useLayoutEffect(() => {
    if (expanded) {
      setVisibleCount(labels.length);
      return;
    }
    if (labels.length === 0) {
      setVisibleCount(0);
      return;
    }

    let count = fitLabelsInWidth(cellWidth);
    if (count < labels.length) {
      count = fitLabelsInWidth(Math.max(0, cellWidth - MORE_BUTTON_RESERVED_WIDTH_PX));
    }
    setVisibleCount((previous) => (previous === count ? previous : count));
  }, [cellWidth, expanded, fitLabelsInWidth, labels.length]);

  if (labels.length === 0) {
    return '';
  }

  const hiddenCount = Math.max(0, labels.length - visibleCount);
  const visibleLabels = expanded ? labels : labels.slice(0, visibleCount);

  if (expanded) {
    return (
      <Box ref={cellRef} sx={{ position: 'relative', width: '100%', minWidth: 0 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, py: 0.25 }}>
          {visibleLabels.map((label, index) => (
            <LabelChip
              key={`${label.key}-${label.value}-${index}`}
              label={label}
              expanded
            />
          ))}
          {labels.length > 1 && (
            <Box
              component="button"
              type="button"
              onClick={() => setExpanded(false)}
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
              Show less
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box ref={cellRef} sx={{ position: 'relative', width: '100%', minWidth: 0 }}>
      <Box sx={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', height: 0, overflow: 'hidden' }}>
        <Box sx={{ display: 'inline-flex', gap: 0.75, whiteSpace: 'nowrap' }}>
          {labels.map((label, index) => (
            <LabelChip
              key={`measure-${label.key}-${label.value}-${index}`}
              label={label}
              expanded={false}
              setMeasureRef={(element) => {
                measurementRefs.current[index] = element;
              }}
            />
          ))}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', minWidth: 0 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0, overflow: 'hidden' }}>
          {visibleLabels.map((label, index) => (
            <LabelChip
              key={`${label.key}-${label.value}-${index}`}
              label={label}
              expanded={false}
            />
          ))}
        </Box>
        {hiddenCount > 0 && (
          <Box
            component="button"
            type="button"
            onClick={() => setExpanded(true)}
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
            +{hiddenCount} more
          </Box>
        )}
      </Box>
    </Box>
  );
}
