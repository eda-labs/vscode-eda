import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import { EdgeLabelRenderer } from '@xyflow/react';

import { type Point } from '../geometry';

const RATE_LABEL_ROTATION_HANDLE_DISTANCE_PX = 18;

export interface OverlayLabelMetrics {
  compact: string;
  radius: number;
  fontSize: number;
  bubbleStrokeWidth: number;
  textStrokeWidth: number;
}

export interface LinkEdgeOverlayState {
  strokeWidth: number;
  edgeStroke: string;
  edgeOpacity: number;
  sourceLabelText: string | undefined;
  targetLabelText: string | undefined;
  sourceMetrics: OverlayLabelMetrics | null;
  targetMetrics: OverlayLabelMetrics | null;
  sourceBubbleColor: string;
  targetBubbleColor: string;
  sourceLabelPosition: Point;
  targetLabelPosition: Point;
  sourceOutBpsLabel: string | undefined;
  targetOutBpsLabel: string | undefined;
  sourceRatePosition: Point | undefined;
  targetRatePosition: Point | undefined;
  telemetryRateFontSize: number;
  telemetryRateTextStrokeWidth: number;
  hasOverlayLabels: boolean;
}

export interface RateLabelInteractionHandlers {
  startRateLabelDrag: (key: 'source' | 'target', event: ReactPointerEvent<HTMLDivElement>) => void;
  startRateLabelRotationDrag: (
    key: 'source' | 'target',
    center: Point,
    event: ReactPointerEvent<HTMLDivElement>
  ) => void;
  swallowRateLabelClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  swallowRateLabelPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

interface EdgeOverlayLabelsProps {
  overlay: LinkEdgeOverlayState;
  sourceRateRotationDeg: number;
  targetRateRotationDeg: number;
  isSourceRateSelected: boolean;
  isTargetRateSelected: boolean;
  isSourceRateDragActive: boolean;
  isTargetRateDragActive: boolean;
  interactions: RateLabelInteractionHandlers;
}

function getInterfaceLabelStyle(
  position: Point,
  metrics: OverlayLabelMetrics | null,
  bubbleColor: string
): CSSProperties {
  const baseStyle: CSSProperties = {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)`,
    pointerEvents: 'none',
  };
  if (metrics === null) return baseStyle;

  return {
    ...baseStyle,
    width: `${metrics.radius * 2}px`,
    minWidth: `${metrics.radius * 2}px`,
    height: `${metrics.radius * 2}px`,
    borderRadius: '50%',
    backgroundColor: bubbleColor,
    border: `${metrics.bubbleStrokeWidth}px solid rgba(0, 0, 0, 0.25)`,
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: `${metrics.fontSize}px`,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    padding: 0,
    textShadow: `0 0 ${metrics.textStrokeWidth}px rgba(0, 0, 0, 0.95), 0 0 ${metrics.textStrokeWidth}px rgba(0, 0, 0, 0.95)`
  };
}

function getRateLabelStyle(
  position: Point,
  rotationDeg: number,
  selected: boolean,
  dragActive: boolean,
  fontSize: number,
  textStrokeWidth: number
): CSSProperties {
  return {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px) rotate(${rotationDeg}deg)`,
    transformOrigin: 'center center',
    pointerEvents: 'all',
    color: '#ffffff',
    backgroundColor: selected ? 'rgba(96, 152, 255, 0.25)' : 'transparent',
    border: selected ? '1px solid rgba(96, 152, 255, 0.95)' : '1px solid transparent',
    borderRadius: '4px',
    fontSize: `${fontSize}px`,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    lineHeight: 1,
    textShadow: `0 0 ${textStrokeWidth}px rgba(0, 0, 0, 0.95), 0 0 ${textStrokeWidth}px rgba(0, 0, 0, 0.95)`,
    userSelect: 'none',
    touchAction: 'none',
    padding: '2px 4px',
    cursor: dragActive ? 'grabbing' : 'grab'
  };
}

function getRateLabelRotationHandleStyle(position: Point, rotationDeg: number): CSSProperties {
  return {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px) rotate(${rotationDeg}deg) translateY(-${RATE_LABEL_ROTATION_HANDLE_DISTANCE_PX}px)`,
    transformOrigin: 'center center',
    width: '11px',
    height: '11px',
    borderRadius: '50%',
    backgroundColor: '#6098ff',
    border: '1px solid rgba(255, 255, 255, 0.95)',
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.45)',
    pointerEvents: 'all',
    cursor: 'grab',
    touchAction: 'none'
  };
}

function EdgeInterfaceLabels({ overlay }: { overlay: LinkEdgeOverlayState }) {
  return (
    <>
      {overlay.sourceLabelText && (
        <div
          className="topology-edge-label"
          style={getInterfaceLabelStyle(
            overlay.sourceLabelPosition,
            overlay.sourceMetrics,
            overlay.sourceBubbleColor
          )}
        >
          {overlay.sourceMetrics?.compact ?? overlay.sourceLabelText}
        </div>
      )}
      {overlay.targetLabelText && (
        <div
          className="topology-edge-label"
          style={getInterfaceLabelStyle(
            overlay.targetLabelPosition,
            overlay.targetMetrics,
            overlay.targetBubbleColor
          )}
        >
          {overlay.targetMetrics?.compact ?? overlay.targetLabelText}
        </div>
      )}
    </>
  );
}

interface EdgeRateLabelProps {
  edgeSide: 'source' | 'target';
  label: string | undefined;
  position: Point | undefined;
  rotationDeg: number;
  selected: boolean;
  dragActive: boolean;
  overlay: LinkEdgeOverlayState;
  interactions: RateLabelInteractionHandlers;
}

function EdgeRateLabel({
  edgeSide,
  label,
  position,
  rotationDeg,
  selected,
  dragActive,
  overlay,
  interactions
}: EdgeRateLabelProps) {
  if (!label || !position) return null;

  return (
    <>
      <div
        className="nodrag nopan"
        onPointerDown={(event) => interactions.startRateLabelDrag(edgeSide, event)}
        onPointerUp={interactions.swallowRateLabelPointerUp}
        onClick={interactions.swallowRateLabelClick}
        title="Drag to move"
        style={getRateLabelStyle(
          position,
          rotationDeg,
          selected,
          dragActive,
          overlay.telemetryRateFontSize,
          overlay.telemetryRateTextStrokeWidth
        )}
      >
        {label}
      </div>
      {selected && (
        <div
          className="nodrag nopan"
          onPointerDown={(event) => interactions.startRateLabelRotationDrag(edgeSide, position, event)}
          onPointerUp={interactions.swallowRateLabelPointerUp}
          onClick={interactions.swallowRateLabelClick}
          title="Drag to rotate"
          style={getRateLabelRotationHandleStyle(position, rotationDeg)}
        />
      )}
    </>
  );
}

export function EdgeOverlayLabels({
  overlay,
  sourceRateRotationDeg,
  targetRateRotationDeg,
  isSourceRateSelected,
  isTargetRateSelected,
  isSourceRateDragActive,
  isTargetRateDragActive,
  interactions
}: EdgeOverlayLabelsProps) {
  if (!overlay.hasOverlayLabels) return null;

  return (
    <EdgeLabelRenderer>
      <EdgeInterfaceLabels overlay={overlay} />
      <EdgeRateLabel
        edgeSide="source"
        label={overlay.sourceOutBpsLabel}
        position={overlay.sourceRatePosition}
        rotationDeg={sourceRateRotationDeg}
        selected={isSourceRateSelected}
        dragActive={isSourceRateDragActive}
        overlay={overlay}
        interactions={interactions}
      />
      <EdgeRateLabel
        edgeSide="target"
        label={overlay.targetOutBpsLabel}
        position={overlay.targetRatePosition}
        rotationDeg={targetRateRotationDeg}
        selected={isTargetRateSelected}
        dragActive={isTargetRateDragActive}
        overlay={overlay}
        interactions={interactions}
      />
    </EdgeLabelRenderer>
  );
}
