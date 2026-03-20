import {
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useSyncExternalStore,
  forwardRef,
  useImperativeHandle
} from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  type ColorMode,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react';
import { useTheme, type Theme } from '@mui/material/styles';

import DeviceNode, { type TopologyNode, type TopologyNodeData } from './nodes/DeviceNode';
import NamespaceLabelNodeComponent, { type NamespaceLabelNode } from './nodes/NamespaceLabelNode';
import LinkEdgeComponent, {
  getRateLabelOffsetSnapshot,
  getRateLabelTransform,
  getRateLabelDragStateSnapshot,
  setRateLabelRotation,
  shouldSuppressTopologySelection,
  subscribeRateLabelDragState,
  type TelemetryRateLabelKey,
  type TelemetryRateLabelSelection,
  type EdgeRateLabelTransform,
  type EdgeRateLabelOffsetSnapshot,
  type LinkEdge,
  type LinkEdgeData
} from './edges/LinkEdge';
import { getNodeIconSvgPathData } from './nodes/icons';
import { getNodeEdgePoint, createBezierPath, LABEL_OFFSET } from './geometry';
import {
  clampTelemetryInterfaceScale,
  clampTelemetryNodeSizePx,
  getAutoCompactInterfaceLabel
} from './telemetryAppearance';
import {
  type NodePositionMap,
  normalizeNodePositionMap,
  topologyNodeIdToName
} from './topologyPositionUtils';

export type FlowNode = TopologyNode | NamespaceLabelNode;

const nodeTypes = {
  deviceNode: DeviceNode,
  namespaceLabel: NamespaceLabelNodeComponent,
};

const edgeTypes = {
  linkEdge: LinkEdgeComponent,
};

const defaultEdgeOptions = {
  type: 'linkEdge',
  interactionWidth: 20,
};

interface TopologyFlowProps {
  readonly nodes: FlowNode[];
  readonly edges: LinkEdge[];
  readonly onNodeSelect?: (node: TopologyNode) => void;
  readonly onEdgeSelect?: (edge: LinkEdge) => void;
  readonly onTelemetryRateLabelSelect?: (selection: TelemetryRateLabelSelection | null) => void;
  readonly onTelemetryRateLabelTransformChange?: (
    selection: TelemetryRateLabelSelection,
    transform: EdgeRateLabelTransform
  ) => void;
  readonly onNodeDoubleClick?: (node: TopologyNode) => void;
  readonly onBackgroundClick?: () => void;
  readonly colorMode?: ColorMode;
  readonly labelMode?: 'hide' | 'show' | 'select';
  readonly nodeLabelMode?: NodeLabelRenderMode;
  readonly appearanceMode?: 'default' | 'telemetry';
  readonly telemetryNodeSizePx?: number;
  readonly telemetryInterfaceScale?: number;
  readonly selectedNodeId?: string | null;
  readonly selectedEdgeId?: string | null;
  readonly selectedTelemetryRateLabel?: TelemetryRateLabelSelection | null;
  readonly onDevicePositionsChange?: (positions: NodePositionMap) => void;
}

export interface TopologySvgExportResult {
  svgContent: string;
  nodes: FlowNode[];
  edges: LinkEdge[];
}

export interface TopologyFlowRef {
  exportImage: (options: ExportOptions) => Promise<void>;
  buildSvgExport: (options: ExportOptions) => Promise<TopologySvgExportResult | null>;
  getDeviceNodePositions: () => NodePositionMap;
  getTelemetryRateLabelOffsets: () => EdgeRateLabelOffsetSnapshot;
  getTelemetryRateLabelTransform: (
    edgeId: string,
    key: TelemetryRateLabelKey
  ) => EdgeRateLabelTransform;
  setTelemetryRateLabelRotation: (
    edgeId: string,
    key: TelemetryRateLabelKey,
    rotationDeg: number
  ) => void;
}

export interface ExportOptions {
  backgroundColor?: string;
  transparentBg?: boolean;
  includeLabels?: boolean;
  zoomPercent?: number;
  paddingPx?: number;
  nodeSizePx?: number;
  interfaceScale?: number;
  interfaceLabelOverrides?: Record<string, string>;
  preferFullInterfaceLabels?: boolean;
  nodeProximateLabels?: boolean;
  nodeLabelMode?: NodeLabelRenderMode;
}

const DEFAULT_PADDING = 50;
const DEFAULT_NODE_SIZE = 80;
const DEFAULT_INTERFACE_SCALE = 1;

export type NodeLabelRenderMode =
  | 'all-name'
  | 'all-role'
  | 'all-name-role'
  | 'all-id'
  | 'tier1-name'
  | 'tier2-name'
  | 'tier3-name'
  | 'none';

function normalizeNodeLabelRenderMode(value: NodeLabelRenderMode | undefined): NodeLabelRenderMode {
  switch (value) {
    case 'all-name':
    case 'all-role':
    case 'all-name-role':
    case 'all-id':
    case 'tier1-name':
    case 'tier2-name':
    case 'tier3-name':
    case 'none':
      return value;
    default:
      return 'all-name';
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getNumericOption(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

interface SvgColors {
  bg: string;
  text: string;
  nodeStroke: string;
  nodeFill: string;
  iconBg: string;
  iconFg: string;
  edgeStroke: string;
}

function getSvgColors(theme: Theme, options: ExportOptions): SvgColors {
  const { topology } = theme.vscode;

  return {
    bg: options.transparentBg ? 'none' : (options.backgroundColor ?? topology.editorBackground),
    text: topology.foreground,
    nodeStroke: topology.nodeBorder,
    nodeFill: topology.nodeBackground,
    iconBg: topology.iconBackground,
    iconFg: topology.iconForeground,
    edgeStroke: topology.linkStroke
  };
}

const EDGE_LABEL = {
  fontSize: 9,
  fontFamily: 'Helvetica, Arial, sans-serif',
  color: '#FFFFFF',
  backgroundColor: '#bec8d2',
  textStrokeColor: 'rgba(0, 0, 0, 0.95)',
  textStrokeWidth: 0.6,
  outlineColor: 'rgba(0, 0, 0, 0.25)'
} as const;

const NODE_LABEL = {
  fontSize: 11,
  fontWeight: 500,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  textStrokeColor: 'rgba(0, 0, 0, 0.95)',
  textStrokeWidth: 0.8
} as const;

function resolveLabelText(
  endpoint: string | undefined,
  compactLabel: string | undefined,
  options: ExportOptions
): string | undefined {
  const endpointKey = endpoint?.trim();
  const override =
    endpointKey != null && endpointKey.length > 0
      ? options.interfaceLabelOverrides?.[endpointKey]?.trim()
      : undefined;
  if (override != null && override.length > 0) {
    return override;
  }

  if (options.preferFullInterfaceLabels && endpointKey != null && endpointKey.length > 0) {
    return endpointKey;
  }

  if (options.nodeProximateLabels && endpointKey != null && endpointKey.length > 0) {
    const compact = getAutoCompactInterfaceLabel(endpointKey);
    if (compact.length > 0) return compact;
  }

  const fallback = compactLabel?.trim();
  if (fallback != null && fallback.length > 0) {
    return fallback;
  }

  if (endpointKey != null && endpointKey.length > 0) {
    const compact = getAutoCompactInterfaceLabel(endpointKey);
    if (compact.length > 0) return compact;
    return endpointKey;
  }

  return undefined;
}

function resolveDeviceNodeLabel(
  nodeId: string,
  data: TopologyNodeData,
  mode: NodeLabelRenderMode
): string | null {
  if (mode === 'none') {
    return null;
  }

  const tier = data.tier ?? 1;
  if (mode === 'tier1-name' && tier !== 1) {
    return null;
  }
  if (mode === 'tier2-name' && tier !== 2) {
    return null;
  }
  if (mode === 'tier3-name' && tier !== 3) {
    return null;
  }

  const name = data.label;
  const role = data.role?.trim();
  switch (mode) {
    case 'all-role':
      return role != null && role.length > 0 ? role : name;
    case 'all-name-role':
      return role != null && role.length > 0 ? `${name} (${role})` : name;
    case 'all-id':
      return nodeId;
    case 'all-name':
    case 'tier1-name':
    case 'tier2-name':
    case 'tier3-name':
      return name;
  }
}

interface EdgeLabelMetrics {
  compact: string;
  radius: number;
  fontSize: number;
  bubbleStrokeWidth: number;
  textStrokeWidth: number;
}

function getEndpointLabelMetrics(label: string, interfaceScale: number): EdgeLabelMetrics {
  const compact = label.trim();
  const safeScale = clamp(interfaceScale, 0.4, 4);
  const fontSize = EDGE_LABEL.fontSize * safeScale;
  const charWidth = fontSize * 0.58;
  const textWidth = Math.max(fontSize * 0.8, compact.length * charWidth);
  const radius = Math.max(6 * safeScale, textWidth / 2 + 2 * safeScale);
  const bubbleStrokeWidth = 0.7 * Math.max(0.6, safeScale);
  const textStrokeWidth = EDGE_LABEL.textStrokeWidth * Math.max(0.6, safeScale);

  return { compact, radius, fontSize, bubbleStrokeWidth, textStrokeWidth };
}

function createEdgeLabelSvg(
  x: number,
  y: number,
  label: string,
  endpoint: string | undefined,
  metrics: EdgeLabelMetrics
): string {
  return `<g class="edge-label" data-endpoint="${escapeXml(endpoint ?? label)}">`
    + `<circle cx="${x}" cy="${y}" r="${metrics.radius}" fill="${EDGE_LABEL.backgroundColor}" stroke="${EDGE_LABEL.outlineColor}" stroke-width="${metrics.bubbleStrokeWidth}"/>`
    + `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" alignment-baseline="middle" font-size="${metrics.fontSize}" font-family="${EDGE_LABEL.fontFamily}" fill="${EDGE_LABEL.color}" stroke="${EDGE_LABEL.textStrokeColor}" stroke-width="${metrics.textStrokeWidth}" paint-order="stroke" stroke-linejoin="round">${escapeXml(metrics.compact)}</text>`
    + `</g>`;
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

const HORIZONTAL_SLOPE_THRESHOLD = 0.25;

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

function getNodeRect(position: { x: number; y: number }, nodeSize: number): NodeRect {
  return {
    x: position.x,
    y: position.y,
    width: nodeSize,
    height: nodeSize
  };
}

function getRectCenter(rect: NodeRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

function getOrCreateEndpointSet(
  endpointsByNode: Map<string, Set<string>>,
  nodeId: string
): Set<string> {
  const existing = endpointsByNode.get(nodeId);
  if (existing) return existing;
  const created = new Set<string>();
  endpointsByNode.set(nodeId, created);
  return created;
}

function getOrCreateNodeVectors(
  vectorsByNode: Map<string, Map<string, EndpointVector>>,
  nodeId: string
): Map<string, EndpointVector> {
  const existing = vectorsByNode.get(nodeId);
  if (existing) return existing;
  const created = new Map<string, EndpointVector>();
  vectorsByNode.set(nodeId, created);
  return created;
}

function trackNodeEndpoint(
  endpointsByNode: Map<string, Set<string>>,
  nodeId: string,
  endpoint: string | null
): void {
  if (endpoint === null) return;
  getOrCreateEndpointSet(endpointsByNode, nodeId).add(endpoint);
}

function addEndpointVector(
  vectorsByNode: Map<string, Map<string, EndpointVector>>,
  nodeId: string,
  endpoint: string,
  dx: number,
  dy: number
): void {
  const nodeVectors = getOrCreateNodeVectors(vectorsByNode, nodeId);
  const existing = nodeVectors.get(endpoint) ?? { dx: 0, dy: 0, samples: 0 };
  existing.dx += dx;
  existing.dy += dy;
  existing.samples += 1;
  nodeVectors.set(endpoint, existing);
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

function buildInterfaceAnchorMap(
  edges: LinkEdge[],
  nodePositions: Map<string, { x: number; y: number }>,
  nodeSize: number,
  interfaceScale: number,
  options: ExportOptions
): NodeInterfaceAnchorMap {
  const endpointsByNode = new Map<string, Set<string>>();
  const vectorsByNode = new Map<string, Map<string, EndpointVector>>();

  for (const edge of edges) {
    const sourceEndpoint = resolveInterfaceEndpointKey(edge.data?.sourceEndpoint, edge.data?.sourceInterface);
    const targetEndpoint = resolveInterfaceEndpointKey(edge.data?.targetEndpoint, edge.data?.targetInterface);
    trackNodeEndpoint(endpointsByNode, edge.source, sourceEndpoint);
    trackNodeEndpoint(endpointsByNode, edge.target, targetEndpoint);

    if (sourceEndpoint === null && targetEndpoint === null) continue;
    if (edge.source === edge.target) continue;

    const sourcePosition = nodePositions.get(edge.source);
    const targetPosition = nodePositions.get(edge.target);
    if (!sourcePosition || !targetPosition) continue;

    const sourceCenter = getRectCenter(getNodeRect(sourcePosition, nodeSize));
    const targetCenter = getRectCenter(getNodeRect(targetPosition, nodeSize));
    const forwardDx = targetCenter.x - sourceCenter.x;
    const forwardDy = targetCenter.y - sourceCenter.y;

    if (sourceEndpoint !== null) {
      addEndpointVector(vectorsByNode, edge.source, sourceEndpoint, forwardDx, forwardDy);
    }
    if (targetEndpoint !== null) {
      addEndpointVector(vectorsByNode, edge.target, targetEndpoint, -forwardDx, -forwardDy);
    }
  }

  const anchorsByNode: NodeInterfaceAnchorMap = new Map();
  const sides: readonly InterfaceSide[] = ['top', 'right', 'bottom', 'left'];

  for (const [nodeId, endpoints] of endpointsByNode) {
    const nodePosition = nodePositions.get(nodeId);
    if (!nodePosition) continue;

    const rect = getNodeRect(nodePosition, nodeSize);
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
      const label = resolveLabelText(endpoint, undefined, options) ?? endpoint;
      const { radius } = getEndpointLabelMetrics(label, interfaceScale);
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
    const targetPoint = getNodeEdgePoint(
      targetCenter,
      targetRect.width,
      targetRect.height,
      sourceAnchor
    );
    return { sx: sourceAnchor.x, sy: sourceAnchor.y, tx: targetPoint.x, ty: targetPoint.y };
  }

  if (targetAnchor) {
    const sourceCenter = getRectCenter(sourceRect);
    const sourcePoint = getNodeEdgePoint(
      sourceCenter,
      sourceRect.width,
      sourceRect.height,
      targetAnchor
    );
    return { sx: sourcePoint.x, sy: sourcePoint.y, tx: targetAnchor.x, ty: targetAnchor.y };
  }

  const sourceCenter = getRectCenter(sourceRect);
  const targetCenter = getRectCenter(targetRect);
  const sourcePoint = getNodeEdgePoint(sourceCenter, sourceRect.width, sourceRect.height, targetCenter);
  const targetPoint = getNodeEdgePoint(targetCenter, targetRect.width, targetRect.height, sourceCenter);
  return { sx: sourcePoint.x, sy: sourcePoint.y, tx: targetPoint.x, ty: targetPoint.y };
}

function getLabelOffsetForEndpoint(
  endpointKey: string | null,
  nodeProximateLabels: boolean,
  interfaceScale: number,
  options: ExportOptions
): number {
  if (!nodeProximateLabels || endpointKey === null) {
    return LABEL_OFFSET;
  }
  const label = resolveLabelText(endpointKey, undefined, options) ?? endpointKey;
  const { radius } = getEndpointLabelMetrics(label, interfaceScale);
  return radius + 1;
}

function generateEdgeSvg(
  edge: LinkEdge,
  nodePositions: Map<string, { x: number; y: number }>,
  interfaceAnchors: NodeInterfaceAnchorMap | undefined,
  colors: SvgColors,
  includeLabels: boolean,
  nodeSize: number,
  options: ExportOptions,
  interfaceScale: number
): string {
  const sourcePos = nodePositions.get(edge.source);
  const targetPos = nodePositions.get(edge.target);
  if (!sourcePos || !targetPos) return '';

  const pairIndex = edge.data?.pairIndex ?? 0;
  const totalInPair = edge.data?.totalInPair ?? 1;
  const sourceEndpointRaw = edge.data?.sourceEndpoint;
  const targetEndpointRaw = edge.data?.targetEndpoint;
  const sourceInterfaceRaw = edge.data?.sourceInterface;
  const targetInterfaceRaw = edge.data?.targetInterface;
  const sourceEndpointKey = resolveInterfaceEndpointKey(sourceEndpointRaw, sourceInterfaceRaw);
  const targetEndpointKey = resolveInterfaceEndpointKey(targetEndpointRaw, targetInterfaceRaw);
  const sourceRect = getNodeRect(sourcePos, nodeSize);
  const targetRect = getNodeRect(targetPos, nodeSize);
  const nodeProximateLabels = options.nodeProximateLabels === true;
  let sourceAnchor: InterfaceAnchor | undefined;
  if (nodeProximateLabels && sourceEndpointKey !== null) {
    sourceAnchor = interfaceAnchors?.get(edge.source)?.get(sourceEndpointKey);
  }
  let targetAnchor: InterfaceAnchor | undefined;
  if (nodeProximateLabels && targetEndpointKey !== null) {
    targetAnchor = interfaceAnchors?.get(edge.target)?.get(targetEndpointKey);
  }
  const points = resolveEdgePointsWithInterfaceAnchors(sourceRect, targetRect, sourceAnchor, targetAnchor);
  const sourceEdge = { x: points.sx, y: points.sy };
  const targetEdge = { x: points.tx, y: points.ty };
  const bezier = createBezierPath(sourceEdge, targetEdge, pairIndex, totalInPair);
  const sourceLabel = resolveLabelText(sourceEndpointRaw, sourceInterfaceRaw, options);
  const targetLabel = resolveLabelText(targetEndpointRaw, targetInterfaceRaw, options);
  const sourceLabelMetrics = sourceLabel ? getEndpointLabelMetrics(sourceLabel, interfaceScale) : null;
  const targetLabelMetrics = targetLabel ? getEndpointLabelMetrics(targetLabel, interfaceScale) : null;
  const controlPoint = totalInPair > 1 ? bezier.midPoint : undefined;

  let svg = `<g class="export-edge" data-id="${escapeXml(edge.id)}">`;
  svg += `<path d="${bezier.path}" fill="none" stroke="${colors.edgeStroke}" stroke-width="${nodeProximateLabels ? 2.5 : 1.5}"${nodeProximateLabels ? ' opacity="0.5"' : ''}/>`;

  if (includeLabels && sourceLabel != null && sourceLabelMetrics != null) {
    const sourceLabelPos = nodeProximateLabels && sourceAnchor && targetAnchor
      ? sourceAnchor
      : getEdgeLabelPosition(
        points.sx,
        points.sy,
        points.tx,
        points.ty,
        getLabelOffsetForEndpoint(sourceEndpointKey, nodeProximateLabels, interfaceScale, options),
        controlPoint
      );
    svg += createEdgeLabelSvg(
      sourceLabelPos.x,
      sourceLabelPos.y,
      sourceLabel,
      sourceEndpointRaw ?? sourceInterfaceRaw,
      sourceLabelMetrics
    );
  }

  if (includeLabels && targetLabel != null && targetLabelMetrics != null) {
    const targetLabelPos = nodeProximateLabels && sourceAnchor && targetAnchor
      ? targetAnchor
      : getEdgeLabelPosition(
        points.tx,
        points.ty,
        points.sx,
        points.sy,
        getLabelOffsetForEndpoint(targetEndpointKey, nodeProximateLabels, interfaceScale, options),
        controlPoint
      );
    svg += createEdgeLabelSvg(
      targetLabelPos.x,
      targetLabelPos.y,
      targetLabel,
      targetEndpointRaw ?? targetInterfaceRaw,
      targetLabelMetrics
    );
  }

  svg += '</g>';
  return svg;
}

function generateNodeSvg(
  node: FlowNode,
  offsetX: number,
  offsetY: number,
  colors: SvgColors,
  nodeSize: number,
  nodeLabelMode: NodeLabelRenderMode
): string {
  const x = node.position.x + offsetX;
  const y = node.position.y + offsetY;

  if (node.type === 'namespaceLabel') {
    return `<text x="${x}" y="${y}" text-anchor="middle" font-size="14" font-weight="600" font-family="${NODE_LABEL.fontFamily}" fill="${colors.text}">${escapeXml(String(node.data.label))}</text>`;
  }

  if (node.type === 'deviceNode') {
    const data = node.data as TopologyNodeData;
    const renderedLabel = resolveDeviceNodeLabel(node.id, data, nodeLabelMode);
    const iconBackgroundSize = clamp(nodeSize * 0.4, 14, 72);
    const iconBackgroundRadius = clamp(iconBackgroundSize * 0.18, 3, 10);
    const iconBackgroundX = x + (nodeSize - iconBackgroundSize) / 2;
    const iconBackgroundY = y + clamp(nodeSize * 0.15, 8, 26);
    const iconGlyphSize = clamp(iconBackgroundSize * 0.56, 10, iconBackgroundSize - 6);
    const iconGlyphScale = iconGlyphSize / 24;
    const iconGlyphX = x + (nodeSize - iconGlyphSize) / 2;
    const iconGlyphY = iconBackgroundY + (iconBackgroundSize - iconGlyphSize) / 2;
    const iconPaths = getNodeIconSvgPathData(data.role)
      .map((pathData) => `<path d="${escapeXml(pathData)}"/>`)
      .join('');
    const labelY = iconBackgroundY + iconBackgroundSize + clamp(nodeSize * 0.175, 7, 16);

    let svg = `<g class="export-node topology-node" data-id="${escapeXml(node.id)}">`
      + `<rect x="${x}" y="${y}" width="${nodeSize}" height="${nodeSize}" rx="8" fill="${colors.nodeFill}" stroke="${colors.nodeStroke}" stroke-width="1"/>`
      + `<rect x="${iconBackgroundX}" y="${iconBackgroundY}" width="${iconBackgroundSize}" height="${iconBackgroundSize}" rx="${iconBackgroundRadius}" fill="${colors.iconBg}"/>`
      + `<g transform="translate(${iconGlyphX} ${iconGlyphY}) scale(${iconGlyphScale})" fill="${colors.iconFg}">${iconPaths}</g>`;
    if (renderedLabel != null && renderedLabel.length > 0) {
      svg += `<text x="${x + nodeSize / 2}" y="${labelY}" text-anchor="middle" font-size="${NODE_LABEL.fontSize}" font-weight="${NODE_LABEL.fontWeight}" font-family="${NODE_LABEL.fontFamily}" fill="${colors.text}" stroke="${NODE_LABEL.textStrokeColor}" stroke-width="${NODE_LABEL.textStrokeWidth}" paint-order="stroke" stroke-linejoin="round">${escapeXml(renderedLabel)}</text>`;
    }
    svg += `</g>`;
    return svg;
  }

  return '';
}

function downloadSvg(content: string): void {
  const blob = new Blob([content], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'topology.svg';
  a.click();
  URL.revokeObjectURL(url);
}

function collectDeviceNodePositions(nodes: FlowNode[]): NodePositionMap {
  const positions: NodePositionMap = {};
  for (const node of nodes) {
    if (node.type !== 'deviceNode') {
      continue;
    }
    const key = topologyNodeIdToName(node.id);
    positions[key] = { x: node.position.x, y: node.position.y };
  }
  return normalizeNodePositionMap(positions);
}

function buildSvgExportResult(theme: Theme, nodes: FlowNode[], edges: LinkEdge[], options: ExportOptions): TopologySvgExportResult | null {
  if (nodes.length === 0) return null;

  const nodeSize = getNumericOption(options.nodeSizePx, DEFAULT_NODE_SIZE, 32, 240);
  const padding = getNumericOption(options.paddingPx, DEFAULT_PADDING, 0, 1000);
  const zoomFactor = getNumericOption((options.zoomPercent ?? 100) / 100, 1, 0.1, 3);
  const interfaceScale = getNumericOption(options.interfaceScale, DEFAULT_INTERFACE_SCALE, 0.4, 4);
  const nodeLabelMode = normalizeNodeLabelRenderMode(options.nodeLabelMode);

  const bounds = getNodesBounds(nodes);
  const baseWidth = bounds.width + padding * 2 + nodeSize;
  const baseHeight = bounds.height + padding * 2 + nodeSize;
  const width = Math.max(1, Math.round(baseWidth * zoomFactor));
  const height = Math.max(1, Math.round(baseHeight * zoomFactor));
  const offsetX = -bounds.x + padding + nodeSize / 2;
  const offsetY = -bounds.y + padding + nodeSize / 2;

  const colors = getSvgColors(theme, options);

  const nodePositions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    if (node.type === 'deviceNode') {
      nodePositions.set(node.id, { x: node.position.x + offsetX, y: node.position.y + offsetY });
    }
  }

  const includeLabels = options.includeLabels ?? false;
  const nodeProximateLabels = options.nodeProximateLabels === true;
  const interfaceAnchors = nodeProximateLabels
    ? buildInterfaceAnchorMap(edges, nodePositions, nodeSize, interfaceScale, options)
    : undefined;
  const edgesSvg = edges
    .map(edge => generateEdgeSvg(
      edge,
      nodePositions,
      interfaceAnchors,
      colors,
      includeLabels,
      nodeSize,
      options,
      interfaceScale
    ))
    .join('');

  const nodesSvg = nodes
    .map(node => generateNodeSvg(node, offsetX, offsetY, colors, nodeSize, nodeLabelMode))
    .join('');

  const graphTransform = zoomFactor === 1 ? '' : ` transform="scale(${zoomFactor})"`;
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="100%" height="100%" fill="${colors.bg}"/>`
    + `<g id="graph"${graphTransform}>`
    + `<g id="edges">${edgesSvg}</g>`
    + `<g id="nodes">${nodesSvg}</g>`
    + `</g>`
    + `</svg>`;

  return {
    svgContent,
    nodes,
    edges
  };
}

function TopologyFlowInner({
  nodes: initialNodes,
  edges: initialEdges,
  onNodeSelect,
  onEdgeSelect,
  onTelemetryRateLabelSelect,
  onTelemetryRateLabelTransformChange,
  onNodeDoubleClick,
  onBackgroundClick,
  colorMode = 'system',
  labelMode = 'select',
  nodeLabelMode = 'all-name',
  appearanceMode = 'default',
  telemetryNodeSizePx = 80,
  telemetryInterfaceScale = 1,
  selectedNodeId,
  selectedEdgeId,
  selectedTelemetryRateLabel,
  onDevicePositionsChange,
}: TopologyFlowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LinkEdge>(initialEdges);
  const pendingEdgesRef = useRef<LinkEdge[] | null>(null);
  const isRateLabelDragActive = useSyncExternalStore(
    subscribeRateLabelDragState,
    getRateLabelDragStateSnapshot,
    getRateLabelDragStateSnapshot
  );

  // Merge incoming nodes with existing positions to preserve user drag state
  useEffect(() => {
    setNodes(currentNodes => {
      const positionMap = new Map(currentNodes.map(n => [n.id, n.position]));
      return initialNodes.map(node => {
        const existingPos = positionMap.get(node.id);
        if (existingPos) {
          return { ...node, position: existingPos };
        }
        return node;
      });
    });
  }, [initialNodes, setNodes]);

  useEffect(() => {
    if (isRateLabelDragActive) {
      pendingEdgesRef.current = initialEdges;
      return;
    }
    pendingEdgesRef.current = null;
    setEdges(initialEdges);
  }, [initialEdges, isRateLabelDragActive, setEdges]);

  useEffect(() => {
    if (isRateLabelDragActive) {
      return;
    }
    const pendingEdges = pendingEdgesRef.current;
    if (!pendingEdges) {
      return;
    }
    pendingEdgesRef.current = null;
    setEdges(pendingEdges);
  }, [isRateLabelDragActive, setEdges]);

  useEffect(() => {
    onDevicePositionsChange?.(collectDeviceNodePositions(nodes));
  }, [nodes, onDevicePositionsChange]);

  const releaseStuckShiftKey = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Linux/WM global shortcuts can swallow Shift keyup events. We synthesize
    // keyup to keep React Flow's internal key-press tracking in sync.
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftRight', bubbles: true }));
  }, []);

  useEffect(() => {
    const handleWindowFocus = () => {
      releaseStuckShiftKey();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        releaseStuckShiftKey();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!event.shiftKey) {
        releaseStuckShiftKey();
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [releaseStuckShiftKey]);

  const handleNodeClick: NodeMouseHandler<FlowNode> = useCallback(
    (_event, node) => {
      if (shouldSuppressTopologySelection()) {
        return;
      }
      // Only handle device nodes, not namespace labels
      if (node.type === 'deviceNode') {
        onNodeSelect?.(node as TopologyNode);
      }
    },
    [onNodeSelect]
  );

  const handleEdgeClick: EdgeMouseHandler<LinkEdge> = useCallback(
    (_event, edge) => {
      if (shouldSuppressTopologySelection()) {
        return;
      }
      onEdgeSelect?.(edge);
    },
    [onEdgeSelect]
  );

  const handleNodeDoubleClick: NodeMouseHandler<FlowNode> = useCallback(
    (_event, node) => {
      if (shouldSuppressTopologySelection()) {
        return;
      }
      // Only handle device nodes, not namespace labels
      if (node.type === 'deviceNode') {
        onNodeDoubleClick?.(node as TopologyNode);
      }
    },
    [onNodeDoubleClick]
  );

  const handlePaneClick = useCallback(() => {
    if (shouldSuppressTopologySelection()) {
      return;
    }
    onBackgroundClick?.();
  }, [onBackgroundClick]);

  // Find the selected edge to get connected node IDs
  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null;
    return edges.find(e => e.id === selectedEdgeId) ?? null;
  }, [edges, selectedEdgeId]);
  const normalizedNodeLabelMode = useMemo(
    () => normalizeNodeLabelRenderMode(nodeLabelMode),
    [nodeLabelMode]
  );

  // Apply label visibility and info-card highlight state to edges.
  const processedEdges = useMemo(() => {
    return edges.map((edge) => {
      const isRateLabelEdge = selectedTelemetryRateLabel?.edgeId === edge.id;
      const isDirectlySelected = edge.id === selectedEdgeId || isRateLabelEdge;
      // Edge is highlighted if: directly selected OR connected to selected node
      const isConnectedToSelectedNode = selectedNodeId != null
        && (edge.source === selectedNodeId || edge.target === selectedNodeId);
      const isHighlighted = isDirectlySelected || isConnectedToSelectedNode;

      // Show labels based on mode
      const showLabels = appearanceMode === 'telemetry'
        || labelMode === 'show'
        || (labelMode === 'select' && isHighlighted);

      return {
        ...edge,
        data: {
          ...edge.data,
          highlighted: isHighlighted || undefined,
          sourceInterface: showLabels ? edge.data?.sourceInterface : undefined,
          targetInterface: showLabels ? edge.data?.targetInterface : undefined,
          edgeLabelsVisible: showLabels,
          selectedRateLabelKey: selectedTelemetryRateLabel?.edgeId === edge.id
            ? selectedTelemetryRateLabel.key
            : undefined,
          onRateLabelSelect: onTelemetryRateLabelSelect,
          onRateLabelTransformChange: onTelemetryRateLabelTransformChange,
          appearanceMode,
          telemetryNodeSizePx: appearanceMode === 'telemetry'
            ? clampTelemetryNodeSizePx(telemetryNodeSizePx)
            : undefined,
          telemetryInterfaceScale: appearanceMode === 'telemetry'
            ? clampTelemetryInterfaceScale(telemetryInterfaceScale)
            : undefined
        },
      };
    });
  }, [
    appearanceMode,
    edges,
    labelMode,
    onTelemetryRateLabelSelect,
    onTelemetryRateLabelTransformChange,
    selectedEdgeId,
    selectedNodeId,
    selectedTelemetryRateLabel,
    telemetryInterfaceScale,
    telemetryNodeSizePx
  ]);

  // Apply info-card highlight state to nodes without overriding React Flow selection.
  const processedNodes = useMemo(() => {
    const highlightConnectedNodes = selectedTelemetryRateLabel == null;
    return nodes.map((node) => {
      const isDirectlySelected = node.id === selectedNodeId;
      // Node is highlighted if: directly selected OR connected to selected edge
      const isConnectedToSelectedEdge = highlightConnectedNodes && selectedEdge != null
        && (selectedEdge.source === node.id || selectedEdge.target === node.id);
      const isHighlighted = isDirectlySelected || isConnectedToSelectedEdge;

      return {
        ...node,
        data: {
          ...node.data,
          ...(node.type === 'deviceNode'
            ? {
              displayLabel: resolveDeviceNodeLabel(
                node.id,
                node.data as TopologyNodeData,
                normalizedNodeLabelMode
              ) ?? '',
              appearanceMode,
              telemetryNodeSizePx: appearanceMode === 'telemetry'
                ? clampTelemetryNodeSizePx(telemetryNodeSizePx)
                : undefined
            }
            : {}),
          highlighted: isHighlighted || undefined,
        },
      };
    });
  }, [
    appearanceMode,
    nodes,
    normalizedNodeLabelMode,
    selectedEdge,
    selectedNodeId,
    selectedTelemetryRateLabel,
    telemetryNodeSizePx
  ]);

  return (
    <div id="topology-flow-container" style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={processedNodes}
        edges={processedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        defaultEdgeOptions={defaultEdgeOptions}
        colorMode={colorMode}
        nodesDraggable={true}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable={true}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        panOnDrag
        zoomOnScroll
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}

// Wrapper component with ref for export functionality
const TopologyFlowWithRef = forwardRef<TopologyFlowRef, TopologyFlowProps>(
  function TopologyFlowWithRef(props, ref) {
    const theme = useTheme();
    const { getNodes, getEdges } = useReactFlow();

    const buildSvgExport = useCallback(async (options: ExportOptions) => {
      const nodes = getNodes() as FlowNode[];
      const edges = getEdges() as LinkEdge[];
      return buildSvgExportResult(theme, nodes, edges, options);
    }, [getNodes, getEdges, theme]);

    const exportImage = useCallback(async (options: ExportOptions) => {
      const prepared = await buildSvgExport(options);
      if (!prepared) return;
      downloadSvg(prepared.svgContent);
    }, [buildSvgExport]);

    const getDeviceNodePositions = useCallback(() => {
      const nodes = getNodes() as FlowNode[];
      return collectDeviceNodePositions(nodes);
    }, [getNodes]);

    const getTelemetryRateLabelOffsets = useCallback(() => {
      return getRateLabelOffsetSnapshot();
    }, []);

    const getTelemetryRateLabelTransform = useCallback((
      edgeId: string,
      key: TelemetryRateLabelKey
    ): EdgeRateLabelTransform => {
      return getRateLabelTransform(edgeId, key);
    }, []);

    const setTelemetryRateLabelRotation = useCallback((
      edgeId: string,
      key: TelemetryRateLabelKey,
      rotationDeg: number
    ) => {
      setRateLabelRotation(edgeId, key, rotationDeg);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        exportImage,
        buildSvgExport,
        getDeviceNodePositions,
        getTelemetryRateLabelOffsets,
        getTelemetryRateLabelTransform,
        setTelemetryRateLabelRotation
      }),
      [
        exportImage,
        buildSvgExport,
        getDeviceNodePositions,
        getTelemetryRateLabelOffsets,
        getTelemetryRateLabelTransform,
        setTelemetryRateLabelRotation
      ]
    );

    return <TopologyFlowInner {...props} />;
  }
);

// Main export wrapped in ReactFlowProvider
const TopologyFlow = forwardRef<TopologyFlowRef, TopologyFlowProps>(
  function TopologyFlow(props, ref) {
    return (
      <ReactFlowProvider>
        <TopologyFlowWithRef ref={ref} {...props} />
      </ReactFlowProvider>
    );
  }
);

export default TopologyFlow;

// Export types for use in the dashboard
export type {
  TopologyNode,
  TopologyNodeData,
  LinkEdge as TopologyEdge,
  LinkEdgeData as TopologyEdgeData,
  TelemetryRateLabelKey as TopologyTelemetryRateLabelKey,
  TelemetryRateLabelSelection as TopologyTelemetryRateLabelSelection,
  EdgeRateLabelTransform as TopologyTelemetryRateLabelTransform
};
