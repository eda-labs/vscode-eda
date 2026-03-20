import { memo, useMemo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type Edge,
  useStore,
  useInternalNode,
} from '@xyflow/react';
import { useTheme } from '@mui/material/styles';

import { type Point, getNodeEdgePoint, createBezierPath } from '../geometry';
import {
  clampTelemetryNodeSizePx,
  clampTelemetryInterfaceScale,
  getAutoCompactInterfaceLabel,
  getTelemetryLabelMetrics
} from '../telemetryAppearance';

export interface LinkEdgeData extends Record<string, unknown> {
  sourceInterface?: string;
  targetInterface?: string;
  sourceEndpoint?: string;
  targetEndpoint?: string;
  state?: string;
  sourceState?: string;
  targetState?: string;
  highlighted?: boolean;
  pairIndex?: number;
  totalInPair?: number;
  edgeLabelsVisible?: boolean;
  appearanceMode?: 'default' | 'telemetry';
  telemetryNodeSizePx?: number;
  telemetryInterfaceScale?: number;
  raw?: unknown;
  rawResource?: unknown;
}

export type LinkEdge = Edge<LinkEdgeData, 'linkEdge'>;

interface EdgeColors {
  defaultStroke: string;
  selectedStroke: string;
  upStroke: string;
  downStroke: string;
}

type InterfaceState = 'up' | 'down' | 'unknown';

interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EndpointVector {
  dx: number;
  dy: number;
  samples: number;
}

type InterfaceSide = 'top' | 'right' | 'bottom' | 'left';

interface InterfaceAnchor {
  x: number;
  y: number;
}

interface EndpointAssignment {
  endpoint: string;
  sortKey: number;
  radius: number;
}

type NodeInterfaceAnchorMap = Map<string, Map<string, InterfaceAnchor>>;

interface InternalNodeLike {
  internals: { positionAbsolute: Point };
}

type NodeLookupLike = Map<string, InternalNodeLike>;

interface InterfaceAnchorCache {
  edgesRef: LinkEdge[] | null;
  nodeLookupRef: NodeLookupLike | null;
  nodeSizePx: number;
  interfaceScale: number;
  anchors: NodeInterfaceAnchorMap | null;
}

const HORIZONTAL_SLOPE_THRESHOLD = 0.25;

let interfaceAnchorCache: InterfaceAnchorCache = {
  edgesRef: null,
  nodeLookupRef: null,
  nodeSizePx: 80,
  interfaceScale: 1,
  anchors: null
};

function getStateColor(state: string | undefined, colors: EdgeColors): string {
  if (!state) return colors.defaultStroke;
  const s = state.toLowerCase();
  if (s === 'up' || s === 'active') return colors.upStroke;
  if (s === 'down' || s === 'error' || s === 'failed') return colors.downStroke;
  return colors.defaultStroke;
}

function normalizeInterfaceState(state: string | undefined): InterfaceState {
  if (!state) return 'unknown';
  const normalized = state.trim().toLowerCase();
  if (normalized === 'up' || normalized === 'active') return 'up';
  if (normalized === 'down' || normalized === 'error' || normalized === 'failed') return 'down';
  return 'unknown';
}

function getTelemetryInterfaceBubbleColor(state: string | undefined, colors: EdgeColors): string {
  const normalizedState = normalizeInterfaceState(state);
  if (normalizedState === 'up') return colors.upStroke;
  if (normalizedState === 'down') return colors.downStroke;
  return '#bec8d2';
}

function normalizeLabelValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed != null && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeEndpoint(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveInterfaceEndpointKey(
  endpoint: string | undefined,
  fallbackInterface: string | undefined
): string | null {
  return normalizeEndpoint(endpoint) ?? normalizeEndpoint(fallbackInterface);
}

function getRectCenter(rect: NodeRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

function getNodeRect(node: InternalNodeLike, nodeSizePx: number): NodeRect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: nodeSizePx,
    height: nodeSizePx
  };
}

function getMeasuredNodeRect(
  node: { internals: { positionAbsolute: Point }; measured: { width?: number; height?: number } },
  fallbackSize: number
): NodeRect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width: node.measured.width ?? fallbackSize,
    height: node.measured.height ?? fallbackSize
  };
}

function resolveEdgePointsWithInterfaceAnchors(
  sourceRect: NodeRect,
  targetRect: NodeRect,
  sourceAnchor: InterfaceAnchor | undefined,
  targetAnchor: InterfaceAnchor | undefined
): { sx: number; sy: number; tx: number; ty: number } {
  if (sourceAnchor && targetAnchor) {
    return { sx: sourceAnchor.x, sy: sourceAnchor.y, tx: targetAnchor.x, ty: targetAnchor.y };
  }

  if (sourceAnchor) {
    const targetCenter = getRectCenter(targetRect);
    const targetPoint = getNodeEdgePoint(targetCenter, targetRect.width, targetRect.height, sourceAnchor);
    return { sx: sourceAnchor.x, sy: sourceAnchor.y, tx: targetPoint.x, ty: targetPoint.y };
  }

  if (targetAnchor) {
    const sourceCenter = getRectCenter(sourceRect);
    const sourcePoint = getNodeEdgePoint(sourceCenter, sourceRect.width, sourceRect.height, targetAnchor);
    return { sx: sourcePoint.x, sy: sourcePoint.y, tx: targetAnchor.x, ty: targetAnchor.y };
  }

  const sourceCenter = getRectCenter(sourceRect);
  const targetCenter = getRectCenter(targetRect);
  const sourcePoint = getNodeEdgePoint(sourceCenter, sourceRect.width, sourceRect.height, targetCenter);
  const targetPoint = getNodeEdgePoint(targetCenter, targetRect.width, targetRect.height, sourceCenter);
  return { sx: sourcePoint.x, sy: sourcePoint.y, tx: targetPoint.x, ty: targetPoint.y };
}

function classifyInterfaceSide(vector: EndpointVector | undefined): InterfaceSide {
  if (!vector || vector.samples <= 0) return 'bottom';

  const dx = vector.dx / vector.samples;
  const dy = vector.dy / vector.samples;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx > 0.001 && absDy <= absDx * HORIZONTAL_SLOPE_THRESHOLD) {
    return dx >= 0 ? 'right' : 'left';
  }

  return dy >= 0 ? 'bottom' : 'top';
}

function getInterfaceSortKey(side: InterfaceSide, vector: EndpointVector | undefined): number {
  if (!vector || vector.samples <= 0) return 0;
  const avgDx = vector.dx / vector.samples;
  const avgDy = vector.dy / vector.samples;
  return side === 'top' || side === 'bottom' ? avgDx : avgDy;
}

function sortEndpointAssignments(assignments: EndpointAssignment[]): void {
  assignments.sort((a, b) => {
    const bySort = a.sortKey - b.sortKey;
    if (bySort !== 0) return bySort;
    return a.endpoint.localeCompare(b.endpoint);
  });
}

function positionInterfaceAnchor(
  rect: NodeRect,
  side: InterfaceSide,
  index: number,
  total: number,
  radius: number
): InterfaceAnchor {
  const slot = (index + 1) / (total + 1);
  const out = radius + 1;

  switch (side) {
    case 'top':
      return { x: rect.x + rect.width * slot, y: rect.y - out };
    case 'right':
      return { x: rect.x + rect.width + out, y: rect.y + rect.height * slot };
    case 'bottom':
      return { x: rect.x + rect.width * slot, y: rect.y + rect.height + out };
    case 'left':
      return { x: rect.x - out, y: rect.y + rect.height * slot };
  }
}

function getTelemetryLabelText(endpoint: string | undefined, fallback: string | undefined): string | undefined {
  const endpointLabel = normalizeLabelValue(endpoint);
  if (endpointLabel != null) {
    const compact = getAutoCompactInterfaceLabel(endpointLabel);
    return compact.length > 0 ? compact : endpointLabel;
  }

  const fallbackLabel = normalizeLabelValue(fallback);
  if (fallbackLabel == null) return undefined;
  const compact = getAutoCompactInterfaceLabel(fallbackLabel);
  return compact.length > 0 ? compact : fallbackLabel;
}

function getEdgeLabelPosition(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  offset: number,
  controlPoint?: { x: number; y: number }
): { x: number; y: number } {
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) {
    return { x: startX, y: startY };
  }

  const baseRatio = Math.min(offset / length, 0.4);
  const ratio = controlPoint ? Math.max(baseRatio, 0.15) : baseRatio;
  if (!controlPoint) {
    return { x: startX + dx * ratio, y: startY + dy * ratio };
  }

  const t = ratio;
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * startX + 2 * oneMinusT * t * controlPoint.x + t * t * endX,
    y: oneMinusT * oneMinusT * startY + 2 * oneMinusT * t * controlPoint.y + t * t * endY
  };
}

function buildTelemetryInterfaceAnchorMap(
  edges: LinkEdge[],
  nodeLookup: NodeLookupLike,
  nodeSizePx: number,
  interfaceScale: number
): NodeInterfaceAnchorMap {
  const endpointsByNode = new Map<string, Set<string>>();
  const vectorsByNode = new Map<string, Map<string, EndpointVector>>();

  for (const edge of edges) {
    const sourceEndpoint = resolveInterfaceEndpointKey(edge.data?.sourceEndpoint, edge.data?.sourceInterface);
    const targetEndpoint = resolveInterfaceEndpointKey(edge.data?.targetEndpoint, edge.data?.targetInterface);

    if (sourceEndpoint !== null) {
      const sourceSet = endpointsByNode.get(edge.source) ?? new Set<string>();
      sourceSet.add(sourceEndpoint);
      endpointsByNode.set(edge.source, sourceSet);
    }

    if (targetEndpoint !== null) {
      const targetSet = endpointsByNode.get(edge.target) ?? new Set<string>();
      targetSet.add(targetEndpoint);
      endpointsByNode.set(edge.target, targetSet);
    }

    if (sourceEndpoint === null && targetEndpoint === null) continue;
    if (edge.source === edge.target) continue;

    const sourceNode = nodeLookup.get(edge.source);
    const targetNode = nodeLookup.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const sourceCenter = getRectCenter(getNodeRect(sourceNode, nodeSizePx));
    const targetCenter = getRectCenter(getNodeRect(targetNode, nodeSizePx));
    const forwardDx = targetCenter.x - sourceCenter.x;
    const forwardDy = targetCenter.y - sourceCenter.y;

    if (sourceEndpoint !== null) {
      const nodeVectors = vectorsByNode.get(edge.source) ?? new Map<string, EndpointVector>();
      const existing = nodeVectors.get(sourceEndpoint) ?? { dx: 0, dy: 0, samples: 0 };
      existing.dx += forwardDx;
      existing.dy += forwardDy;
      existing.samples += 1;
      nodeVectors.set(sourceEndpoint, existing);
      vectorsByNode.set(edge.source, nodeVectors);
    }

    if (targetEndpoint !== null) {
      const nodeVectors = vectorsByNode.get(edge.target) ?? new Map<string, EndpointVector>();
      const existing = nodeVectors.get(targetEndpoint) ?? { dx: 0, dy: 0, samples: 0 };
      existing.dx -= forwardDx;
      existing.dy -= forwardDy;
      existing.samples += 1;
      nodeVectors.set(targetEndpoint, existing);
      vectorsByNode.set(edge.target, nodeVectors);
    }
  }

  const anchorsByNode: NodeInterfaceAnchorMap = new Map();
  const sides: readonly InterfaceSide[] = ['top', 'right', 'bottom', 'left'];

  for (const [nodeId, endpoints] of endpointsByNode) {
    const node = nodeLookup.get(nodeId);
    if (!node) continue;

    const rect = getNodeRect(node, nodeSizePx);
    const nodeVectors = vectorsByNode.get(nodeId);
    const buckets: Record<InterfaceSide, EndpointAssignment[]> = {
      top: [],
      right: [],
      bottom: [],
      left: []
    };

    for (const endpoint of endpoints) {
      const side = classifyInterfaceSide(nodeVectors?.get(endpoint));
      const sortKey = getInterfaceSortKey(side, nodeVectors?.get(endpoint));
      const label = getTelemetryLabelText(endpoint, endpoint) ?? endpoint;
      const { radius } = getTelemetryLabelMetrics(label, interfaceScale);
      buckets[side].push({ endpoint, sortKey, radius });
    }

    const endpointAnchors = new Map<string, InterfaceAnchor>();
    for (const side of sides) {
      sortEndpointAssignments(buckets[side]);
      for (let idx = 0; idx < buckets[side].length; idx++) {
        const assignment = buckets[side][idx];
        endpointAnchors.set(
          assignment.endpoint,
          positionInterfaceAnchor(rect, side, idx, buckets[side].length, assignment.radius)
        );
      }
    }

    anchorsByNode.set(nodeId, endpointAnchors);
  }

  return anchorsByNode;
}

function getCachedTelemetryInterfaceAnchorMap(
  edges: LinkEdge[],
  nodeLookup: NodeLookupLike,
  nodeSizePx: number,
  interfaceScale: number
): NodeInterfaceAnchorMap {
  if (
    interfaceAnchorCache.edgesRef === edges
    && interfaceAnchorCache.nodeLookupRef === nodeLookup
    && interfaceAnchorCache.nodeSizePx === nodeSizePx
    && interfaceAnchorCache.interfaceScale === interfaceScale
    && interfaceAnchorCache.anchors
  ) {
    return interfaceAnchorCache.anchors;
  }

  const anchors = buildTelemetryInterfaceAnchorMap(edges, nodeLookup, nodeSizePx, interfaceScale);
  interfaceAnchorCache = {
    edgesRef: edges,
    nodeLookupRef: nodeLookup,
    nodeSizePx,
    interfaceScale,
    anchors
  };

  return anchors;
}

function resolveStrokeWidth(isHighlighted: boolean, isTelemetryStyle: boolean): number {
  if (isTelemetryStyle) {
    return isHighlighted ? 4 : 2.5;
  }
  return isHighlighted ? 3 : 1.5;
}

function resolveRenderedLabel(
  isTelemetryStyle: boolean,
  labelsVisible: boolean,
  endpoint: string | undefined,
  fallback: string | undefined
): string | undefined {
  if (isTelemetryStyle) {
    if (!labelsVisible) return undefined;
    return getTelemetryLabelText(endpoint, fallback);
  }
  return normalizeLabelValue(fallback);
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
  const allEdges = useStore((state) => state.edges as LinkEdge[]);
  const nodeLookup = useStore((state) => state.nodeLookup as NodeLookupLike);
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const isTelemetryStyle = data?.appearanceMode === 'telemetry';
  const telemetryNodeSizePx = clampTelemetryNodeSizePx(data?.telemetryNodeSizePx ?? 80);
  const telemetryInterfaceScale = clampTelemetryInterfaceScale(data?.telemetryInterfaceScale ?? 1);
  const telemetryInterfaceAnchors = useMemo(() => {
    if (!isTelemetryStyle) return undefined;
    return getCachedTelemetryInterfaceAnchorMap(
      allEdges,
      nodeLookup,
      telemetryNodeSizePx,
      telemetryInterfaceScale
    );
  }, [allEdges, isTelemetryStyle, nodeLookup, telemetryInterfaceScale, telemetryNodeSizePx]);
  const sourceEndpointKey = resolveInterfaceEndpointKey(data?.sourceEndpoint, data?.sourceInterface);
  const targetEndpointKey = resolveInterfaceEndpointKey(data?.targetEndpoint, data?.targetInterface);
  const sourceAnchor = sourceEndpointKey != null
    ? telemetryInterfaceAnchors?.get(source)?.get(sourceEndpointKey)
    : undefined;
  const targetAnchor = targetEndpointKey != null
    ? telemetryInterfaceAnchors?.get(target)?.get(targetEndpointKey)
    : undefined;

  const edgeData = useMemo(() => {
    if (!sourceNode || !targetNode) {
      return null;
    }

    const fallbackSize = isTelemetryStyle ? telemetryNodeSizePx : 80;
    const sourceRect = getMeasuredNodeRect(sourceNode, fallbackSize);
    const targetRect = getMeasuredNodeRect(targetNode, fallbackSize);
    const points = resolveEdgePointsWithInterfaceAnchors(
      sourceRect,
      targetRect,
      sourceAnchor,
      targetAnchor
    );
    const sourceEdge = { x: points.sx, y: points.sy };
    const targetEdge = { x: points.tx, y: points.ty };

    const pairIndex = data?.pairIndex ?? 0;
    const totalInPair = data?.totalInPair ?? 1;
    const bezier = createBezierPath(sourceEdge, targetEdge, pairIndex, totalInPair);

    return {
      ...bezier,
      sourceEdge,
      targetEdge,
      totalInPair,
      stroke: getStateColor(data?.state, edgeColors),
    };
  }, [
    sourceNode,
    targetNode,
    sourceAnchor,
    targetAnchor,
    isTelemetryStyle,
    telemetryNodeSizePx,
    data?.pairIndex,
    data?.totalInPair,
    data?.state,
    edgeColors
  ]);

  if (!edgeData) return null;

  const isHighlighted = selected || Boolean(data?.highlighted);
  const strokeWidth = resolveStrokeWidth(isHighlighted, isTelemetryStyle);
  let edgeStroke = edgeData.stroke;
  if (isTelemetryStyle) {
    edgeStroke = edgeColors.defaultStroke;
  }
  if (isHighlighted) {
    edgeStroke = edgeColors.selectedStroke;
  }
  const edgeOpacity = !isHighlighted && isTelemetryStyle ? 0.5 : 1;
  const labelsVisible = data?.edgeLabelsVisible !== false;
  const sourceLabelText = resolveRenderedLabel(
    isTelemetryStyle,
    labelsVisible,
    data?.sourceEndpoint,
    data?.sourceInterface
  );
  const targetLabelText = resolveRenderedLabel(
    isTelemetryStyle,
    labelsVisible,
    data?.targetEndpoint,
    data?.targetInterface
  );
  const sourceMetrics = isTelemetryStyle && sourceLabelText != null
    ? getTelemetryLabelMetrics(sourceLabelText, telemetryInterfaceScale)
    : null;
  const targetMetrics = isTelemetryStyle && targetLabelText != null
    ? getTelemetryLabelMetrics(targetLabelText, telemetryInterfaceScale)
    : null;
  const sourceBubbleColor = getTelemetryInterfaceBubbleColor(data?.sourceState, edgeColors);
  const targetBubbleColor = getTelemetryInterfaceBubbleColor(data?.targetState, edgeColors);
  const controlPoint = edgeData.totalInPair > 1 ? edgeData.midPoint : undefined;
  let sourceLabelPosition = edgeData.sourceLabel;
  if (sourceMetrics) {
    if (sourceAnchor && targetAnchor) {
      sourceLabelPosition = sourceAnchor;
    } else {
      sourceLabelPosition = getEdgeLabelPosition(
        edgeData.sourceEdge.x,
        edgeData.sourceEdge.y,
        edgeData.targetEdge.x,
        edgeData.targetEdge.y,
        sourceMetrics.radius + 1,
        controlPoint
      );
    }
  }
  let targetLabelPosition = edgeData.targetLabel;
  if (targetMetrics) {
    if (sourceAnchor && targetAnchor) {
      targetLabelPosition = targetAnchor;
    } else {
      targetLabelPosition = getEdgeLabelPosition(
        edgeData.targetEdge.x,
        edgeData.targetEdge.y,
        edgeData.sourceEdge.x,
        edgeData.sourceEdge.y,
        targetMetrics.radius + 1,
        controlPoint
      );
    }
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={edgeData.path}
        style={{
          stroke: edgeStroke,
          strokeWidth,
          strokeOpacity: edgeOpacity
        }}
        interactionWidth={20}
      />
      {(sourceLabelText || targetLabelText) && (
        <EdgeLabelRenderer>
          {sourceLabelText && (
            <div
              className="topology-edge-label"
              style={sourceMetrics
                ? {
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${sourceLabelPosition.x}px, ${sourceLabelPosition.y}px)`,
                  pointerEvents: 'none',
                  width: `${sourceMetrics.radius * 2}px`,
                  minWidth: `${sourceMetrics.radius * 2}px`,
                  height: `${sourceMetrics.radius * 2}px`,
                  borderRadius: '50%',
                  backgroundColor: sourceBubbleColor,
                  border: `${sourceMetrics.bubbleStrokeWidth}px solid rgba(0, 0, 0, 0.25)`,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: `${sourceMetrics.fontSize}px`,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  padding: 0,
                  textShadow: `0 0 ${sourceMetrics.textStrokeWidth}px rgba(0, 0, 0, 0.95), 0 0 ${sourceMetrics.textStrokeWidth}px rgba(0, 0, 0, 0.95)`
                }
                : {
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${sourceLabelPosition.x}px, ${sourceLabelPosition.y}px)`,
                  pointerEvents: 'none',
                }}
            >
              {sourceMetrics?.compact ?? sourceLabelText}
            </div>
          )}
          {targetLabelText && (
            <div
              className="topology-edge-label"
              style={targetMetrics
                ? {
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${targetLabelPosition.x}px, ${targetLabelPosition.y}px)`,
                  pointerEvents: 'none',
                  width: `${targetMetrics.radius * 2}px`,
                  minWidth: `${targetMetrics.radius * 2}px`,
                  height: `${targetMetrics.radius * 2}px`,
                  borderRadius: '50%',
                  backgroundColor: targetBubbleColor,
                  border: `${targetMetrics.bubbleStrokeWidth}px solid rgba(0, 0, 0, 0.25)`,
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: `${targetMetrics.fontSize}px`,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  padding: 0,
                  textShadow: `0 0 ${targetMetrics.textStrokeWidth}px rgba(0, 0, 0, 0.95), 0 0 ${targetMetrics.textStrokeWidth}px rgba(0, 0, 0, 0.95)`
                }
                : {
                  position: 'absolute',
                  transform: `translate(-50%, -50%) translate(${targetLabelPosition.x}px, ${targetLabelPosition.y}px)`,
                  pointerEvents: 'none',
                }}
            >
              {targetMetrics?.compact ?? targetLabelText}
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(LinkEdgeComponent);
