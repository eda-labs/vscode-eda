import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';

import BaseNodeComponent, { type BaseNodeData } from './BaseNode';
import { getNodeIconForNode } from './icons';
import { clampTelemetryNodeSizePx } from '../telemetryAppearance';

export interface TopologyNodeData extends BaseNodeData {
  label: string;
  tier?: number;
  role?: string;
  namespace?: string;
  raw?: unknown;
}

export type TopologyNode = Node<TopologyNodeData, 'deviceNode'>;

function normalizeHexColor(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : undefined;
}

function getContrastingIconColor(hexColor: string): string {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  const brightness = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return brightness > 0.62 ? '#1f2937' : '#ffffff';
}

function DeviceNode({ data, selected }: NodeProps<TopologyNode>) {
  const NodeIcon = getNodeIconForNode(data.iconKey, data.role);
  const isTelemetryStyle = data.appearanceMode === 'telemetry';
  const nodeSize = isTelemetryStyle ? clampTelemetryNodeSizePx(data.telemetryNodeSizePx ?? 80) : 80;
  const iconBadgeColor = normalizeHexColor(data.iconColor);
  const iconContainerSize = isTelemetryStyle
    ? Math.max(14, Math.min(72, nodeSize * 0.4))
    : 32;
  const iconRadius = isTelemetryStyle
    ? Math.max(3, Math.min(10, iconContainerSize * 0.18))
    : 6;
  const iconGlyphSize = isTelemetryStyle
    ? Math.max(10, Math.min(iconContainerSize - 6, iconContainerSize * 0.56))
    : 28;
  const iconStyle = isTelemetryStyle
    ? {
      width: `${iconContainerSize}px`,
      height: `${iconContainerSize}px`,
      borderRadius: `${iconRadius}px`
    }
    : undefined;
  const iconStyleWithColor = {
    ...iconStyle,
    ...(iconBadgeColor
      ? {
        backgroundColor: iconBadgeColor,
        color: getContrastingIconColor(iconBadgeColor)
      }
      : {})
  };

  return (
    <BaseNodeComponent data={data} selected={selected}>
      <div className="topology-node-icon" style={iconStyleWithColor}>
        <NodeIcon sx={{ fontSize: iconGlyphSize }} />
      </div>
    </BaseNodeComponent>
  );
}

export default memo(DeviceNode);
