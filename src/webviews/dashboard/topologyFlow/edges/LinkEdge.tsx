import { memo, useMemo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type Edge,
  useInternalNode,
} from '@xyflow/react';
import { useTheme } from '@mui/material/styles';

export interface LinkEdgeData extends Record<string, unknown> {
  sourceInterface?: string;
  targetInterface?: string;
  state?: string;
  sourceState?: string;
  targetState?: string;
  pairIndex?: number;
  totalInPair?: number;
  raw?: unknown;
  rawResource?: unknown;
}

export type LinkEdge = Edge<LinkEdgeData, 'linkEdge'>;

// Cytoscape-inspired: control-point-step-size for multi-edge separation
const CONTROL_POINT_STEP = 40;
// Label offset from node (like Cytoscape's source-text-offset)
const LABEL_OFFSET = 25;

interface Point {
  x: number;
  y: number;
}

function getNodeCenter(node: { internals: { positionAbsolute: Point }; measured: { width?: number; height?: number } }): Point {
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? 80) / 2,
    y: node.internals.positionAbsolute.y + (node.measured.height ?? 80) / 2,
  };
}

function getNodeEdgePoint(
  center: Point,
  width: number,
  height: number,
  targetPoint: Point
): Point {
  // Find intersection of line from center to target with node rectangle
  const dx = targetPoint.x - center.x;
  const dy = targetPoint.y - center.y;

  if (dx === 0 && dy === 0) {
    return center;
  }

  const halfW = width / 2;
  const halfH = height / 2;

  // Calculate intersection with each edge
  let t = Infinity;

  // Right edge
  if (dx > 0) {
    const tRight = halfW / dx;
    if (Math.abs(dy * tRight) <= halfH) t = Math.min(t, tRight);
  }
  // Left edge
  if (dx < 0) {
    const tLeft = -halfW / dx;
    if (Math.abs(dy * tLeft) <= halfH) t = Math.min(t, tLeft);
  }
  // Bottom edge
  if (dy > 0) {
    const tBottom = halfH / dy;
    if (Math.abs(dx * tBottom) <= halfW) t = Math.min(t, tBottom);
  }
  // Top edge
  if (dy < 0) {
    const tTop = -halfH / dy;
    if (Math.abs(dx * tTop) <= halfW) t = Math.min(t, tTop);
  }

  return {
    x: center.x + dx * t,
    y: center.y + dy * t,
  };
}

/**
 * Cytoscape-inspired perpendicular offset calculation.
 * For multi-edges between same nodes, offset them perpendicular to the direct line.
 * Both edges curve in opposite directions (no straight line when multiple edges).
 */
function calculatePerpendicularOffset(pairIndex: number, totalInPair: number): number {
  // Single edge: straight line
  if (totalInPair <= 1) return 0;

  // Multiple edges: curve in opposite directions
  // pairIndex 0 → +step, pairIndex 1 → -step, pairIndex 2 → +2*step, etc.
  const sign = pairIndex % 2 === 0 ? 1 : -1;
  const magnitude = Math.floor(pairIndex / 2) + 1;
  return sign * magnitude * CONTROL_POINT_STEP;
}

/**
 * Simple quadratic bezier path with perpendicular offset for multi-edges.
 * Similar to Cytoscape's bezier curve-style.
 */
function createBezierPath(
  source: Point,
  target: Point,
  pairIndex: number,
  totalInPair: number
): { path: string; midPoint: Point; sourceLabel: Point; targetLabel: Point } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  // Perpendicular unit vector
  const perpX = -dy / len;
  const perpY = dx / len;

  // Perpendicular offset for this edge in the pair
  const offset = calculatePerpendicularOffset(pairIndex, totalInPair);

  // Control point at midpoint, offset perpendicular to the line
  // Add base curvature even for index 0 if there will be multiple edges
  const midX = (source.x + target.x) / 2 + perpX * offset;
  const midY = (source.y + target.y) / 2 + perpY * offset;

  // Quadratic bezier: M start Q control end
  const path = `M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`;

  // Label positions: offset from source/target along the curve direction
  // Use fixed offset from nodes (like Cytoscape's text-offset)
  const normDx = dx / len;
  const normDy = dy / len;

  // Source label: offset from source toward the curve
  const sourceLabelX = source.x + normDx * LABEL_OFFSET + perpX * offset * 0.3;
  const sourceLabelY = source.y + normDy * LABEL_OFFSET + perpY * offset * 0.3;

  // Target label: offset from target toward the curve
  const targetLabelX = target.x - normDx * LABEL_OFFSET + perpX * offset * 0.3;
  const targetLabelY = target.y - normDy * LABEL_OFFSET + perpY * offset * 0.3;

  return {
    path,
    midPoint: { x: midX, y: midY },
    sourceLabel: { x: sourceLabelX, y: sourceLabelY },
    targetLabel: { x: targetLabelX, y: targetLabelY },
  };
}

interface EdgeColors {
  defaultStroke: string;
  selectedStroke: string;
  upStroke: string;
  downStroke: string;
}

function getStateColor(state: string | undefined, colors: EdgeColors): string {
  if (!state) return colors.defaultStroke;
  const s = state.toLowerCase();
  if (s === 'up' || s === 'active') return colors.upStroke;
  if (s === 'down' || s === 'error' || s === 'failed') return colors.downStroke;
  return colors.defaultStroke;
}

function LinkEdgeComponent({
  id,
  source,
  target,
  data,
  selected,
}: EdgeProps<LinkEdge>) {
  const theme = useTheme();
  const edgeColors = useMemo<EdgeColors>(() => ({
    defaultStroke: theme.vscode.topology.linkStroke,
    selectedStroke: theme.vscode.topology.linkStrokeSelected,
    upStroke: theme.vscode.topology.linkUp,
    downStroke: theme.vscode.topology.linkDown,
  }), [theme]);
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const edgeData = useMemo(() => {
    if (!sourceNode || !targetNode) {
      return null;
    }

    const sourceCenter = getNodeCenter(sourceNode);
    const targetCenter = getNodeCenter(targetNode);

    // Get edge points on node boundaries
    const sourceWidth = sourceNode.measured.width ?? 80;
    const sourceHeight = sourceNode.measured.height ?? 80;
    const targetWidth = targetNode.measured.width ?? 80;
    const targetHeight = targetNode.measured.height ?? 80;

    const sourceEdge = getNodeEdgePoint(sourceCenter, sourceWidth, sourceHeight, targetCenter);
    const targetEdge = getNodeEdgePoint(targetCenter, targetWidth, targetHeight, sourceCenter);

    const pairIndex = data?.pairIndex ?? 0;
    const totalInPair = data?.totalInPair ?? 1;
    const bezier = createBezierPath(sourceEdge, targetEdge, pairIndex, totalInPair);

    return {
      ...bezier,
      stroke: getStateColor(data?.state, edgeColors),
    };
  }, [sourceNode, targetNode, data?.pairIndex, data?.totalInPair, data?.state, edgeColors]);

  if (!edgeData) return null;

  const strokeWidth = selected ? 3 : 1.5;
  const edgeStroke = selected ? edgeColors.selectedStroke : edgeData.stroke;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgeData.path}
        style={{
          stroke: edgeStroke,
          strokeWidth,
        }}
        interactionWidth={20}
      />
      {data?.sourceInterface && (
        <EdgeLabelRenderer>
          <div
            className="topology-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${edgeData.sourceLabel.x}px, ${edgeData.sourceLabel.y}px)`,
              pointerEvents: 'none',
            }}
          >
            {data.sourceInterface}
          </div>
        </EdgeLabelRenderer>
      )}
      {data?.targetInterface && (
        <EdgeLabelRenderer>
          <div
            className="topology-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${edgeData.targetLabel.x}px, ${edgeData.targetLabel.y}px)`,
              pointerEvents: 'none',
            }}
          >
            {data.targetInterface}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(LinkEdgeComponent);
