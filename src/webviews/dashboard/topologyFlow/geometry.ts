export interface Point {
  x: number;
  y: number;
}

// Cytoscape-inspired: control-point-step-size for multi-edge separation
export const CONTROL_POINT_STEP = 40;
// Label offset from node (like Cytoscape's source-text-offset)
export const LABEL_OFFSET = 25;

/**
 * Find intersection of line from center to target with a node rectangle boundary.
 */
export function getNodeEdgePoint(
  center: Point,
  width: number,
  height: number,
  targetPoint: Point
): Point {
  const dx = targetPoint.x - center.x;
  const dy = targetPoint.y - center.y;

  if (dx === 0 && dy === 0) {
    return center;
  }

  const halfW = width / 2;
  const halfH = height / 2;

  let t = Infinity;

  if (dx > 0) {
    const tRight = halfW / dx;
    if (Math.abs(dy * tRight) <= halfH) t = Math.min(t, tRight);
  }
  if (dx < 0) {
    const tLeft = -halfW / dx;
    if (Math.abs(dy * tLeft) <= halfH) t = Math.min(t, tLeft);
  }
  if (dy > 0) {
    const tBottom = halfH / dy;
    if (Math.abs(dx * tBottom) <= halfW) t = Math.min(t, tBottom);
  }
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
 */
export function calculatePerpendicularOffset(pairIndex: number, totalInPair: number): number {
  if (totalInPair <= 1) return 0;
  const sign = pairIndex % 2 === 0 ? 1 : -1;
  const magnitude = Math.floor(pairIndex / 2) + 1;
  return sign * magnitude * CONTROL_POINT_STEP;
}

/**
 * Simple quadratic bezier path with perpendicular offset for multi-edges.
 */
export function createBezierPath(
  source: Point,
  target: Point,
  pairIndex: number,
  totalInPair: number
): { path: string; midPoint: Point; sourceLabel: Point; targetLabel: Point } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  const perpX = -dy / len;
  const perpY = dx / len;

  const offset = calculatePerpendicularOffset(pairIndex, totalInPair);

  const midX = (source.x + target.x) / 2 + perpX * offset;
  const midY = (source.y + target.y) / 2 + perpY * offset;

  const path = `M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`;

  const normDx = dx / len;
  const normDy = dy / len;

  return {
    path,
    midPoint: { x: midX, y: midY },
    sourceLabel: {
      x: source.x + normDx * LABEL_OFFSET + perpX * offset * 0.3,
      y: source.y + normDy * LABEL_OFFSET + perpY * offset * 0.3,
    },
    targetLabel: {
      x: target.x - normDx * LABEL_OFFSET + perpX * offset * 0.3,
      y: target.y - normDy * LABEL_OFFSET + perpY * offset * 0.3,
    },
  };
}
