import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';

import BaseNodeComponent, { type BaseNodeData } from './BaseNode';
import { getNodeIcon } from './icons';

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

  return (
    <BaseNodeComponent data={data} selected={selected}>
      <div className="topology-node-icon">
        <NodeIcon sx={{ fontSize: 28 }} />
      </div>
    </BaseNodeComponent>
  );
}

export default memo(DeviceNode);
