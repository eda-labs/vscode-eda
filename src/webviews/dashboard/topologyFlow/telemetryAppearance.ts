const DEFAULT_TELEMETRY_NODE_SIZE_PX = 80;
const DEFAULT_TELEMETRY_INTERFACE_SCALE = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampTelemetryNodeSizePx(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TELEMETRY_NODE_SIZE_PX;
  }
  return clamp(value, 12, 240);
}

export function clampTelemetryInterfaceScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TELEMETRY_INTERFACE_SCALE;
  }
  return clamp(value, 0.4, 4);
}

export function getAutoCompactInterfaceLabel(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return '';

  let end = trimmed.length - 1;
  while (end >= 0 && (trimmed[end] < '0' || trimmed[end] > '9')) {
    end -= 1;
  }
  if (end >= 0) {
    let start = end;
    while (start >= 0 && trimmed[start] >= '0' && trimmed[start] <= '9') {
      start -= 1;
    }
    return trimmed.slice(start + 1, end + 1);
  }

  const token = trimmed.split(/[:/.-]/).filter((part) => part.length > 0).pop() ?? trimmed;
  return token.length <= 3 ? token : token.slice(-3);
}

export interface TelemetryLabelMetrics {
  compact: string;
  radius: number;
  fontSize: number;
  bubbleStrokeWidth: number;
  textStrokeWidth: number;
}

export function getTelemetryLabelMetrics(label: string, interfaceScale: number): TelemetryLabelMetrics {
  const compact = label.trim();
  const safeScale = clampTelemetryInterfaceScale(interfaceScale);
  const fontSize = 9 * safeScale;
  const radius = Math.max(8 * safeScale, fontSize * 0.9);
  const bubbleStrokeWidth = 0.7 * Math.max(0.6, safeScale);
  const textStrokeWidth = 0.6 * Math.max(0.6, safeScale);

  return { compact, radius, fontSize, bubbleStrokeWidth, textStrokeWidth };
}
