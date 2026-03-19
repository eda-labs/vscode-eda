export interface NodePosition {
  x: number;
  y: number;
}

export type NodePositionMap = Record<string, NodePosition>;

const POSITION_EPSILON = 0.001;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRoundedFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(value);
}

function normalizePosition(value: unknown): NodePosition | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const x = toRoundedFiniteNumber(value.x);
  const y = toRoundedFiniteNumber(value.y);
  if (x === undefined || y === undefined) {
    return undefined;
  }
  return { x, y };
}

export function normalizeNodePositionMap(value: unknown): NodePositionMap {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: NodePositionMap = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      continue;
    }
    const position = normalizePosition(raw);
    if (position) {
      normalized[key] = position;
    }
  }

  return normalized;
}

export function parseNodePositionAnnotation(value: unknown): NodePositionMap {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizeNodePositionMap(parsed);
  } catch {
    return {};
  }
}

export function serializeNodePositionAnnotation(positions: NodePositionMap): string {
  const normalized = normalizeNodePositionMap(positions);
  const ordered: NodePositionMap = {};
  for (const key of Object.keys(normalized).sort((a, b) => a.localeCompare(b))) {
    ordered[key] = normalized[key];
  }
  return JSON.stringify(ordered);
}

export function topologyNodeIdToName(nodeId: string): string {
  const splitAt = nodeId.indexOf('/');
  if (splitAt < 0) {
    return nodeId;
  }
  return nodeId.slice(splitAt + 1);
}

export function nodePositionMapsEqual(a: NodePositionMap, b: NodePositionMap): boolean {
  const aKeys = Object.keys(a).sort((left, right) => left.localeCompare(right));
  const bKeys = Object.keys(b).sort((left, right) => left.localeCompare(right));

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (let i = 0; i < aKeys.length; i += 1) {
    const key = aKeys[i];
    if (key !== bKeys[i]) {
      return false;
    }
    const leftPos = a[key];
    const rightPos = b[key];
    if (
      !rightPos
      || Math.abs(leftPos.x - rightPos.x) > POSITION_EPSILON
      || Math.abs(leftPos.y - rightPos.y) > POSITION_EPSILON
    ) {
      return false;
    }
  }

  return true;
}
