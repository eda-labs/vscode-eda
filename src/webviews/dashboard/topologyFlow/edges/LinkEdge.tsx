import {
  memo,
  useEffect,
  useMemo,
  useCallback,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from 'react';
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
  sourceOutBps?: number;
  targetOutBps?: number;
  highlighted?: boolean;
  pairIndex?: number;
  totalInPair?: number;
  edgeLabelsVisible?: boolean;
  selectedRateLabelKey?: RateLabelKey;
  onRateLabelSelect?: (selection: TelemetryRateLabelSelection | null) => void;
  onRateLabelTransformChange?: (
    selection: TelemetryRateLabelSelection,
    transform: EdgeRateLabelTransform
  ) => void;
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

interface InterfaceAnchorTemplate {
  side: InterfaceSide;
  index: number;
  total: number;
  radius: number;
}

type NodeInterfaceAnchorTemplateMap = Map<string, Map<string, InterfaceAnchorTemplate>>;

interface InternalNodeLike {
  internals?: { positionAbsolute?: Point };
  positionAbsolute?: Point;
  position?: Point;
}

type NodeLookupLike = Map<string, InternalNodeLike>;

interface InterfaceAnchorCache {
  edgesRef: LinkEdge[] | null;
  nodeLookupRef: NodeLookupLike | null;
  nodeSizePx: number;
  interfaceScale: number;
  templates: NodeInterfaceAnchorTemplateMap | null;
}

export type TelemetryRateLabelKey = 'source' | 'target';
type RateLabelKey = TelemetryRateLabelKey;

export interface EdgeRateLabelOffsets {
  source: Point;
  target: Point;
}

interface EdgeRateLabelRotations {
  source: number;
  target: number;
}

export interface TelemetryRateLabelSelection {
  edgeId: string;
  key: RateLabelKey;
}

export interface EdgeRateLabelTransform {
  offset: Point;
  rotationDeg: number;
}

export type EdgeRateLabelOffsetSnapshot = Record<string, EdgeRateLabelOffsets>;

type RateLabelOffsetSubscriber = () => void;

interface GlobalRateLabelDrag {
  edgeId: string;
  key: RateLabelKey;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffset: Point;
  zoom: number;
}

interface GlobalRateLabelRotationDrag {
  edgeId: string;
  key: RateLabelKey;
  pointerId: number;
  centerClient: Point;
  rotationOffsetDeg: number;
}

const HORIZONTAL_SLOPE_THRESHOLD = 0.25;
const DEFAULT_RATE_LABEL_OFFSET: Point = { x: 0, y: 0 };
const DEFAULT_RATE_LABEL_ROTATION_DEG = 0;
const RATE_LABEL_ROTATION_HANDLE_DISTANCE_PX = 18;
const RATE_LABEL_SELECTION_SUPPRESS_MS = 220;

let interfaceAnchorCache: InterfaceAnchorCache = {
  edgesRef: null,
  nodeLookupRef: null,
  nodeSizePx: 80,
  interfaceScale: 1,
  templates: null
};

let telemetryRateLabelOffsetCache = new Map<string, EdgeRateLabelOffsets>();
let telemetryRateLabelRotationCache = new Map<string, EdgeRateLabelRotations>();
let telemetryRateLabelOffsetSubscribers = new Set<RateLabelOffsetSubscriber>();
let telemetryRateLabelOffsetVersion = 0;
let activeRateLabelDrag: GlobalRateLabelDrag | null = null;
let activeRateLabelRotationDrag: GlobalRateLabelRotationDrag | null = null;
let globalRateLabelDragHandlersInstalled = false;
let suppressTopologySelectionUntilMs = 0;

function clonePoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function getMonotonicNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function markRateLabelInteraction(): void {
  suppressTopologySelectionUntilMs = getMonotonicNowMs() + RATE_LABEL_SELECTION_SUPPRESS_MS;
}

export function shouldSuppressTopologySelection(): boolean {
  return getMonotonicNowMs() < suppressTopologySelectionUntilMs;
}

function notifyRateLabelOffsetSubscribers(): void {
  telemetryRateLabelOffsetVersion += 1;
  for (const subscriber of telemetryRateLabelOffsetSubscribers) {
    subscriber();
  }
}

function subscribeRateLabelOffsets(subscriber: RateLabelOffsetSubscriber): () => void {
  telemetryRateLabelOffsetSubscribers.add(subscriber);
  return () => {
    telemetryRateLabelOffsetSubscribers.delete(subscriber);
  };
}

export function subscribeRateLabelDragState(subscriber: RateLabelOffsetSubscriber): () => void {
  return subscribeRateLabelOffsets(subscriber);
}

export function getRateLabelDragStateSnapshot(): boolean {
  return activeRateLabelDrag != null || activeRateLabelRotationDrag != null;
}

export function getRateLabelOffsetSnapshot(): EdgeRateLabelOffsetSnapshot {
  const snapshot: EdgeRateLabelOffsetSnapshot = {};
  for (const [edgeId, offsets] of telemetryRateLabelOffsetCache) {
    snapshot[edgeId] = {
      source: clonePoint(offsets.source),
      target: clonePoint(offsets.target)
    };
  }
  return snapshot;
}

function getRateLabelOffsetVersionSnapshot(): number {
  return telemetryRateLabelOffsetVersion;
}

function getCachedRateLabelOffset(edgeId: string, key: RateLabelKey): Point {
  const existing = telemetryRateLabelOffsetCache.get(edgeId);
  if (!existing) return clonePoint(DEFAULT_RATE_LABEL_OFFSET);
  return clonePoint(existing[key]);
}

function setCachedRateLabelOffset(edgeId: string, key: RateLabelKey, offset: Point): void {
  const existing = telemetryRateLabelOffsetCache.get(edgeId);
  telemetryRateLabelOffsetCache.set(edgeId, {
    source: key === 'source' ? clonePoint(offset) : clonePoint(existing?.source ?? DEFAULT_RATE_LABEL_OFFSET),
    target: key === 'target' ? clonePoint(offset) : clonePoint(existing?.target ?? DEFAULT_RATE_LABEL_OFFSET)
  });
  notifyRateLabelOffsetSubscribers();
}

function getCachedRateLabelRotation(edgeId: string, key: RateLabelKey): number {
  const existing = telemetryRateLabelRotationCache.get(edgeId);
  if (!existing) return DEFAULT_RATE_LABEL_ROTATION_DEG;
  const rotation = existing[key];
  return Number.isFinite(rotation) ? rotation : DEFAULT_RATE_LABEL_ROTATION_DEG;
}

function setCachedRateLabelRotation(edgeId: string, key: RateLabelKey, rotationDeg: number): void {
  if (!Number.isFinite(rotationDeg)) return;

  const existing = telemetryRateLabelRotationCache.get(edgeId);
  telemetryRateLabelRotationCache.set(edgeId, {
    source: key === 'source'
      ? rotationDeg
      : (existing?.source ?? DEFAULT_RATE_LABEL_ROTATION_DEG),
    target: key === 'target'
      ? rotationDeg
      : (existing?.target ?? DEFAULT_RATE_LABEL_ROTATION_DEG)
  });
  notifyRateLabelOffsetSubscribers();
}

export function setRateLabelRotation(edgeId: string, key: RateLabelKey, rotationDeg: number): void {
  setCachedRateLabelRotation(edgeId, key, rotationDeg);
}

function getEdgeRateLabelOffsets(edgeId: string, version?: number): EdgeRateLabelOffsets {
  void version;
  return {
    source: getCachedRateLabelOffset(edgeId, 'source'),
    target: getCachedRateLabelOffset(edgeId, 'target')
  };
}

function getEdgeRateLabelRotations(edgeId: string, version?: number): EdgeRateLabelRotations {
  void version;
  return {
    source: getCachedRateLabelRotation(edgeId, 'source'),
    target: getCachedRateLabelRotation(edgeId, 'target')
  };
}

export function getRateLabelTransform(edgeId: string, key: RateLabelKey): EdgeRateLabelTransform {
  return {
    offset: getCachedRateLabelOffset(edgeId, key),
    rotationDeg: getCachedRateLabelRotation(edgeId, key)
  };
}

function isRateLabelDragActive(edgeId: string, key: RateLabelKey): boolean {
  return activeRateLabelDrag?.edgeId === edgeId && activeRateLabelDrag?.key === key;
}

// Match the React Flow rotatable-node example: 0deg at top, increasing clockwise.
function getPointerRotationDeg(center: Point, clientX: number, clientY: number): number {
  const dx = clientX - center.x;
  const dy = clientY - center.y;
  const rad = Math.atan2(dx, dy);
  const deg = rad * (180 / Math.PI);
  return 180 - deg;
}

function stopGlobalRateLabelDrag(pointerId?: number): void {
  if (!activeRateLabelDrag) return;
  if (pointerId !== undefined && activeRateLabelDrag.pointerId !== pointerId) return;

  activeRateLabelDrag = null;
  notifyRateLabelOffsetSubscribers();
}

function stopGlobalRateLabelRotationDrag(pointerId?: number): void {
  if (!activeRateLabelRotationDrag) return;
  if (pointerId !== undefined && activeRateLabelRotationDrag.pointerId !== pointerId) return;

  activeRateLabelRotationDrag = null;
  notifyRateLabelOffsetSubscribers();
}

function ensureGlobalRateLabelDragHandlers(): void {
  if (globalRateLabelDragHandlersInstalled) return;
  if (typeof window === 'undefined') return;

  const onPointerMove = (event: PointerEvent) => {
    const rotationDrag = activeRateLabelRotationDrag;
    if (rotationDrag && event.pointerId === rotationDrag.pointerId) {
      if (event.pointerType !== 'touch' && event.buttons === 0) {
        stopGlobalRateLabelRotationDrag(event.pointerId);
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const pointerRotationDeg = getPointerRotationDeg(
        rotationDrag.centerClient,
        event.clientX,
        event.clientY
      );
      const nextRotationDeg = pointerRotationDeg + rotationDrag.rotationOffsetDeg;
      setCachedRateLabelRotation(rotationDrag.edgeId, rotationDrag.key, nextRotationDeg);
      return;
    }

    const drag = activeRateLabelDrag;
    if (!drag) return;
    if (event.pointerId !== drag.pointerId) return;
    if (event.pointerType !== 'touch' && event.buttons === 0) {
      stopGlobalRateLabelDrag(event.pointerId);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const deltaX = (event.clientX - drag.startClientX) / drag.zoom;
    const deltaY = (event.clientY - drag.startClientY) / drag.zoom;
    setCachedRateLabelOffset(drag.edgeId, drag.key, {
      x: drag.startOffset.x + deltaX,
      y: drag.startOffset.y + deltaY
    });
  };

  const onPointerUp = (event: PointerEvent) => {
    stopGlobalRateLabelDrag(event.pointerId);
    stopGlobalRateLabelRotationDrag(event.pointerId);
  };

  const onPointerCancel = (event: PointerEvent) => {
    // Keep drag active on cancel events to survive edge/label remounts during live updates.
    if (
      event.pointerId !== activeRateLabelDrag?.pointerId
      && event.pointerId !== activeRateLabelRotationDrag?.pointerId
    ) return;
  };

  const onWindowBlur = () => {
    stopGlobalRateLabelDrag();
    stopGlobalRateLabelRotationDrag();
  };

  window.addEventListener('pointermove', onPointerMove, { passive: false, capture: true });
  window.addEventListener('pointerup', onPointerUp, { capture: true });
  window.addEventListener('pointercancel', onPointerCancel, { capture: true });
  window.addEventListener('blur', onWindowBlur);
  globalRateLabelDragHandlersInstalled = true;
}

function startGlobalRateLabelDrag(params: {
  edgeId: string;
  key: RateLabelKey;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffset: Point;
  zoom: number;
}): void {
  ensureGlobalRateLabelDragHandlers();
  stopGlobalRateLabelDrag();
  stopGlobalRateLabelRotationDrag();

  const normalizedZoom = Number.isFinite(params.zoom) && params.zoom > 0 ? params.zoom : 1;
  activeRateLabelDrag = {
    ...params,
    startOffset: clonePoint(params.startOffset),
    zoom: normalizedZoom
  };

  notifyRateLabelOffsetSubscribers();
}

function startGlobalRateLabelRotationDrag(params: {
  edgeId: string;
  key: RateLabelKey;
  pointerId: number;
  centerClient: Point;
  startPointerClientX: number;
  startPointerClientY: number;
  startRotationDeg: number;
}): void {
  ensureGlobalRateLabelDragHandlers();
  stopGlobalRateLabelDrag();
  stopGlobalRateLabelRotationDrag();

  activeRateLabelRotationDrag = {
    edgeId: params.edgeId,
    key: params.key,
    pointerId: params.pointerId,
    centerClient: clonePoint(params.centerClient),
    rotationOffsetDeg: params.startRotationDeg - getPointerRotationDeg(
      params.centerClient,
      params.startPointerClientX,
      params.startPointerClientY
    )
  };

  notifyRateLabelOffsetSubscribers();
}

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

function resolveNodePosition(node: InternalNodeLike | undefined): Point | null {
  const position = node?.internals?.positionAbsolute ?? node?.positionAbsolute ?? node?.position;
  if (!position) return null;
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  return position;
}

function resolveMeasuredSize(value: number | undefined, fallbackSize: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallbackSize;
}

function getNodeRect(node: InternalNodeLike, nodeSizePx: number): NodeRect | null {
  const position = resolveNodePosition(node);
  if (!position) return null;
  return {
    x: position.x,
    y: position.y,
    width: nodeSizePx,
    height: nodeSizePx
  };
}

function getMeasuredNodeRect(
  node: InternalNodeLike & { measured?: { width?: number; height?: number } },
  fallbackSize: number
): NodeRect | null {
  const position = resolveNodePosition(node);
  if (!position) return null;
  return {
    x: position.x,
    y: position.y,
    width: resolveMeasuredSize(node.measured?.width, fallbackSize),
    height: resolveMeasuredSize(node.measured?.height, fallbackSize)
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

function normalizeFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatTelemetryOutBpsLabel(value: unknown): string | undefined {
  const numeric = normalizeFiniteNumber(value);
  if (numeric === null || numeric < 0) {
    return undefined;
  }

  const units = ['b/s', 'Kb/s', 'Mb/s', 'Gb/s', 'Tb/s'];
  let unitIndex = 0;
  let scaled = numeric;
  while (scaled >= 1000 && unitIndex < units.length - 1) {
    scaled /= 1000;
    unitIndex += 1;
  }

  let decimals = 2;
  if (scaled >= 100) {
    decimals = 0;
  } else if (scaled >= 10) {
    decimals = 1;
  }
  const formatted = Number(scaled.toFixed(decimals));
  return `${formatted} ${units[unitIndex]}`;
}

function getQuadraticPointAtRatio(
  start: Point,
  control: Point,
  end: Point,
  ratio: number
): Point {
  const t = Math.max(0, Math.min(1, ratio));
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * control.x + t * t * end.x,
    y: oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * control.y + t * t * end.y
  };
}

function withOffset(point: Point | undefined, offset: Point): Point | undefined {
  if (!point) return undefined;
  return {
    x: point.x + offset.x,
    y: point.y + offset.y
  };
}

function buildTelemetryInterfaceAnchorTemplateMap(
  edges: LinkEdge[],
  nodeLookup: NodeLookupLike,
  nodeSizePx: number,
  interfaceScale: number
): NodeInterfaceAnchorTemplateMap {
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

    const sourceRect = getNodeRect(sourceNode, nodeSizePx);
    const targetRect = getNodeRect(targetNode, nodeSizePx);
    if (!sourceRect || !targetRect) continue;

    const sourceCenter = getRectCenter(sourceRect);
    const targetCenter = getRectCenter(targetRect);
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

  const templatesByNode: NodeInterfaceAnchorTemplateMap = new Map();
  const sides: readonly InterfaceSide[] = ['top', 'right', 'bottom', 'left'];

  for (const [nodeId, endpoints] of endpointsByNode) {
    const node = nodeLookup.get(nodeId);
    if (!node) continue;

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

    const endpointTemplates = new Map<string, InterfaceAnchorTemplate>();
    for (const side of sides) {
      sortEndpointAssignments(buckets[side]);
      const total = buckets[side].length;
      for (let idx = 0; idx < buckets[side].length; idx++) {
        const assignment = buckets[side][idx];
        endpointTemplates.set(assignment.endpoint, {
          side,
          index: idx,
          total,
          radius: assignment.radius
        });
      }
    }

    templatesByNode.set(nodeId, endpointTemplates);
  }

  return templatesByNode;
}

function getCachedTelemetryInterfaceAnchorTemplateMap(
  edges: LinkEdge[],
  nodeLookup: NodeLookupLike,
  nodeSizePx: number,
  interfaceScale: number
): NodeInterfaceAnchorTemplateMap {
  if (
    interfaceAnchorCache.edgesRef === edges
    && interfaceAnchorCache.nodeLookupRef === nodeLookup
    && interfaceAnchorCache.nodeSizePx === nodeSizePx
    && interfaceAnchorCache.interfaceScale === interfaceScale
    && interfaceAnchorCache.templates
  ) {
    return interfaceAnchorCache.templates;
  }

  const templates = buildTelemetryInterfaceAnchorTemplateMap(edges, nodeLookup, nodeSizePx, interfaceScale);
  interfaceAnchorCache = {
    edgesRef: edges,
    nodeLookupRef: nodeLookup,
    nodeSizePx,
    interfaceScale,
    templates
  };

  return templates;
}

function resolveInterfaceAnchorFromTemplate(
  rect: NodeRect,
  template: InterfaceAnchorTemplate | undefined
): InterfaceAnchor | undefined {
  if (!template || template.total <= 0) return undefined;
  return positionInterfaceAnchor(rect, template.side, template.index, template.total, template.radius);
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
  const telemetryInterfaceAnchorTemplates = useMemo(() => {
    if (!isTelemetryStyle) return undefined;
    return getCachedTelemetryInterfaceAnchorTemplateMap(
      allEdges,
      nodeLookup,
      telemetryNodeSizePx,
      telemetryInterfaceScale
    );
  }, [allEdges, isTelemetryStyle, nodeLookup, telemetryInterfaceScale, telemetryNodeSizePx]);
  const sourceEndpointKey = resolveInterfaceEndpointKey(data?.sourceEndpoint, data?.sourceInterface);
  const targetEndpointKey = resolveInterfaceEndpointKey(data?.targetEndpoint, data?.targetInterface);
  const sourceTemplate = sourceEndpointKey != null
    ? telemetryInterfaceAnchorTemplates?.get(source)?.get(sourceEndpointKey)
    : undefined;
  const targetTemplate = targetEndpointKey != null
    ? telemetryInterfaceAnchorTemplates?.get(target)?.get(targetEndpointKey)
    : undefined;
  const viewportTransform = useStore((state) => state.transform as [number, number, number]);
  const viewportX = viewportTransform[0];
  const viewportY = viewportTransform[1];
  const viewportZoom = viewportTransform[2];
  const rateLabelOffsetVersion = useSyncExternalStore(
    subscribeRateLabelOffsets,
    getRateLabelOffsetVersionSnapshot,
    getRateLabelOffsetVersionSnapshot
  );
  const rateLabelOffsets = getEdgeRateLabelOffsets(id, rateLabelOffsetVersion);
  const sourceRateOffset = rateLabelOffsets.source;
  const targetRateOffset = rateLabelOffsets.target;
  const rateLabelRotations = getEdgeRateLabelRotations(id, rateLabelOffsetVersion);
  const sourceRateRotationDeg = rateLabelRotations.source;
  const targetRateRotationDeg = rateLabelRotations.target;
  const isSourceRateDragActive = isRateLabelDragActive(id, 'source');
  const isTargetRateDragActive = isRateLabelDragActive(id, 'target');
  const selectedRateLabelKey = data?.selectedRateLabelKey;
  const isSourceRateSelected = selectedRateLabelKey === 'source';
  const isTargetRateSelected = selectedRateLabelKey === 'target';
  const onRateLabelSelect = data?.onRateLabelSelect;
  const onRateLabelTransformChange = data?.onRateLabelTransformChange;

  const selectRateLabel = useCallback((key: RateLabelKey) => {
    onRateLabelSelect?.({ edgeId: id, key });
  }, [id, onRateLabelSelect]);

  const startRateLabelDrag = useCallback((key: RateLabelKey, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isTelemetryStyle) return;

    event.preventDefault();
    event.stopPropagation();
    markRateLabelInteraction();
    selectRateLabel(key);

    const startOffset = key === 'source' ? sourceRateOffset : targetRateOffset;
    startGlobalRateLabelDrag({
      edgeId: id,
      key,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffset,
      zoom: viewportZoom
    });
  }, [
    id,
    isTelemetryStyle,
    selectRateLabel,
    sourceRateOffset,
    targetRateOffset,
    viewportZoom
  ]);

  const startRateLabelRotationDrag = useCallback((
    key: RateLabelKey,
    center: Point,
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (!isTelemetryStyle) return;

    event.preventDefault();
    event.stopPropagation();
    markRateLabelInteraction();
    selectRateLabel(key);

    const flowContainerRect = event.currentTarget.ownerDocument
      .getElementById('topology-flow-container')
      ?.getBoundingClientRect();
    const flowContainerLeft = flowContainerRect?.left ?? 0;
    const flowContainerTop = flowContainerRect?.top ?? 0;
    const startRotationDeg = key === 'source' ? sourceRateRotationDeg : targetRateRotationDeg;
    startGlobalRateLabelRotationDrag({
      edgeId: id,
      key,
      pointerId: event.pointerId,
      centerClient: {
        x: flowContainerLeft + (center.x * viewportZoom) + viewportX,
        y: flowContainerTop + (center.y * viewportZoom) + viewportY
      },
      startPointerClientX: event.clientX,
      startPointerClientY: event.clientY,
      startRotationDeg
    });
  }, [
    id,
    isTelemetryStyle,
    selectRateLabel,
    sourceRateRotationDeg,
    targetRateRotationDeg,
    viewportX,
    viewportY,
    viewportZoom
  ]);

  const rotateRateLabel = useCallback((key: RateLabelKey, event: ReactWheelEvent<HTMLDivElement>) => {
    if (!isTelemetryStyle) return;

    event.preventDefault();
    event.stopPropagation();
    markRateLabelInteraction();
    selectRateLabel(key);

    const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    let modeScale = 1;
    if (event.deltaMode === 1) {
      modeScale = 12;
    } else if (event.deltaMode === 2) {
      modeScale = 96;
    }
    const nextRotation = (key === 'source' ? sourceRateRotationDeg : targetRateRotationDeg)
      + dominantDelta * modeScale * 0.15;
    setCachedRateLabelRotation(id, key, nextRotation);
  }, [
    id,
    isTelemetryStyle,
    selectRateLabel,
    sourceRateRotationDeg,
    targetRateRotationDeg
  ]);

  const swallowRateLabelClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    markRateLabelInteraction();
  }, []);

  const swallowRateLabelPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    markRateLabelInteraction();
  }, []);

  useEffect(() => {
    if (!selectedRateLabelKey || !onRateLabelTransformChange) return;

    if (selectedRateLabelKey === 'source') {
      onRateLabelTransformChange(
        { edgeId: id, key: 'source' },
        { offset: clonePoint(sourceRateOffset), rotationDeg: sourceRateRotationDeg }
      );
      return;
    }

    onRateLabelTransformChange(
      { edgeId: id, key: 'target' },
      { offset: clonePoint(targetRateOffset), rotationDeg: targetRateRotationDeg }
    );
  }, [
    id,
    onRateLabelTransformChange,
    selectedRateLabelKey,
    sourceRateOffset,
    sourceRateRotationDeg,
    targetRateOffset,
    targetRateRotationDeg
  ]);

  const edgeData = useMemo(() => {
    if (!sourceNode || !targetNode) {
      return null;
    }

    const fallbackSize = isTelemetryStyle ? telemetryNodeSizePx : 80;
    const sourceRect = getMeasuredNodeRect(sourceNode, fallbackSize);
    const targetRect = getMeasuredNodeRect(targetNode, fallbackSize);
    if (!sourceRect || !targetRect) {
      return null;
    }
    const sourceAnchor = resolveInterfaceAnchorFromTemplate(sourceRect, sourceTemplate);
    const targetAnchor = resolveInterfaceAnchorFromTemplate(targetRect, targetTemplate);
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
      sourceAnchor,
      targetAnchor
    };
  }, [
    sourceNode,
    targetNode,
    sourceTemplate,
    targetTemplate,
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
  const sourceAnchor = edgeData.sourceAnchor;
  const targetAnchor = edgeData.targetAnchor;
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
  const sourceOutBpsLabel = isTelemetryStyle ? formatTelemetryOutBpsLabel(data?.sourceOutBps) : undefined;
  const targetOutBpsLabel = isTelemetryStyle ? formatTelemetryOutBpsLabel(data?.targetOutBps) : undefined;
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
  const baseSourceRatePosition = sourceOutBpsLabel
    ? getQuadraticPointAtRatio(edgeData.sourceEdge, edgeData.midPoint, edgeData.targetEdge, 0.34)
    : undefined;
  const baseTargetRatePosition = targetOutBpsLabel
    ? getQuadraticPointAtRatio(edgeData.sourceEdge, edgeData.midPoint, edgeData.targetEdge, 0.66)
    : undefined;
  const sourceRatePosition = withOffset(baseSourceRatePosition, sourceRateOffset);
  const targetRatePosition = withOffset(baseTargetRatePosition, targetRateOffset);
  const telemetryRateFontSize = Math.max(9, 9 * telemetryInterfaceScale);
  const telemetryRateTextStrokeWidth = Math.max(0.8, 0.75 * Math.max(0.6, telemetryInterfaceScale));
  const hasOverlayLabels = sourceLabelText || targetLabelText || sourceOutBpsLabel || targetOutBpsLabel;

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
      {hasOverlayLabels && (
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
          {sourceOutBpsLabel && sourceRatePosition && (
            <div
              className="nodrag nopan"
              onPointerDown={(event) => startRateLabelDrag('source', event)}
              onPointerUp={swallowRateLabelPointerUp}
              onClick={swallowRateLabelClick}
              onWheel={(event) => rotateRateLabel('source', event)}
              title="Drag to move, scroll to rotate"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${sourceRatePosition.x}px, ${sourceRatePosition.y}px) rotate(${sourceRateRotationDeg}deg)`,
                transformOrigin: 'center center',
                pointerEvents: 'all',
                color: '#ffffff',
                backgroundColor: isSourceRateSelected ? 'rgba(96, 152, 255, 0.25)' : 'transparent',
                border: isSourceRateSelected ? '1px solid rgba(96, 152, 255, 0.95)' : '1px solid transparent',
                borderRadius: '4px',
                fontSize: `${telemetryRateFontSize}px`,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                lineHeight: 1,
                textShadow: `0 0 ${telemetryRateTextStrokeWidth}px rgba(0, 0, 0, 0.95), 0 0 ${telemetryRateTextStrokeWidth}px rgba(0, 0, 0, 0.95)`,
                userSelect: 'none',
                touchAction: 'none',
                padding: '2px 4px',
                cursor: isSourceRateDragActive ? 'grabbing' : 'grab'
              }}
            >
              {sourceOutBpsLabel}
            </div>
          )}
          {sourceOutBpsLabel && sourceRatePosition && isSourceRateSelected && (
            <div
              className="nodrag nopan"
              onPointerDown={(event) => startRateLabelRotationDrag('source', sourceRatePosition, event)}
              onPointerUp={swallowRateLabelPointerUp}
              onClick={swallowRateLabelClick}
              title="Drag to rotate"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${sourceRatePosition.x}px, ${sourceRatePosition.y}px) rotate(${sourceRateRotationDeg}deg) translateY(-${RATE_LABEL_ROTATION_HANDLE_DISTANCE_PX}px)`,
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
              }}
            />
          )}
          {targetOutBpsLabel && targetRatePosition && (
            <div
              className="nodrag nopan"
              onPointerDown={(event) => startRateLabelDrag('target', event)}
              onPointerUp={swallowRateLabelPointerUp}
              onClick={swallowRateLabelClick}
              onWheel={(event) => rotateRateLabel('target', event)}
              title="Drag to move, scroll to rotate"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${targetRatePosition.x}px, ${targetRatePosition.y}px) rotate(${targetRateRotationDeg}deg)`,
                transformOrigin: 'center center',
                pointerEvents: 'all',
                color: '#ffffff',
                backgroundColor: isTargetRateSelected ? 'rgba(96, 152, 255, 0.25)' : 'transparent',
                border: isTargetRateSelected ? '1px solid rgba(96, 152, 255, 0.95)' : '1px solid transparent',
                borderRadius: '4px',
                fontSize: `${telemetryRateFontSize}px`,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                lineHeight: 1,
                textShadow: `0 0 ${telemetryRateTextStrokeWidth}px rgba(0, 0, 0, 0.95), 0 0 ${telemetryRateTextStrokeWidth}px rgba(0, 0, 0, 0.95)`,
                userSelect: 'none',
                touchAction: 'none',
                padding: '2px 4px',
                cursor: isTargetRateDragActive ? 'grabbing' : 'grab'
              }}
            >
              {targetOutBpsLabel}
            </div>
          )}
          {targetOutBpsLabel && targetRatePosition && isTargetRateSelected && (
            <div
              className="nodrag nopan"
              onPointerDown={(event) => startRateLabelRotationDrag('target', targetRatePosition, event)}
              onPointerUp={swallowRateLabelPointerUp}
              onClick={swallowRateLabelClick}
              title="Drag to rotate"
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${targetRatePosition.x}px, ${targetRatePosition.y}px) rotate(${targetRateRotationDeg}deg) translateY(-${RATE_LABEL_ROTATION_HANDLE_DISTANCE_PX}px)`,
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
              }}
            />
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(LinkEdgeComponent);
