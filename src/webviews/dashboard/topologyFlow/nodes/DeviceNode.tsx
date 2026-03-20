import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';

import BaseNodeComponent, { type BaseNodeData } from './BaseNode';
import { getNodeIcon } from './icons';
import { clampTelemetryNodeSizePx } from '../telemetryAppearance';

export interface TopologyNodeData extends BaseNodeData {
  label: string;
  tier?: number;
  role?: string;
  namespace?: string;
  raw?: unknown;
}

export type TopologyNode = Node<TopologyNodeData, 'deviceNode'>;

function DeviceNode({ data, selected }: NodeProps<TopologyNode>) {
  const NodeIcon = getNodeIcon(data.role);
  const isTelemetryStyle = data.appearanceMode === 'telemetry';
  const nodeSize = isTelemetryStyle ? clampTelemetryNodeSizePx(data.telemetryNodeSizePx ?? 80) : 80;
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

  return (
    <BaseNodeComponent data={data} selected={selected}>
      <div className="topology-node-icon" style={iconStyle}>
        <NodeIcon sx={{ fontSize: iconGlyphSize }} />
      </div>
    </BaseNodeComponent>
  );
}

export default memo(DeviceNode);
