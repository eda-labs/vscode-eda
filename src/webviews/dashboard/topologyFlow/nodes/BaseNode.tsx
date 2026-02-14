import React, { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

export interface BaseNodeData extends Record<string, unknown> {
  label: string;
  tier?: number;
  role?: string;
  raw?: unknown;
}

export type BaseNode = Node<BaseNodeData>;

interface BaseNodeComponentProps {
  readonly data: BaseNodeData;
  readonly selected?: boolean;
  readonly children?: React.ReactNode;
}

const handlePositions = [
  { id: 'top', type: 'source' as const, position: Position.Top },
  { id: 'top-target', type: 'target' as const, position: Position.Top },
  { id: 'bottom', type: 'source' as const, position: Position.Bottom },
  { id: 'bottom-target', type: 'target' as const, position: Position.Bottom },
  { id: 'left', type: 'source' as const, position: Position.Left },
  { id: 'left-target', type: 'target' as const, position: Position.Left },
  { id: 'right', type: 'source' as const, position: Position.Right },
  { id: 'right-target', type: 'target' as const, position: Position.Right },
];

function BaseNodeComponent({ data, selected, children }: BaseNodeComponentProps) {
  return (
    <div className={`topology-node ${selected ? 'selected' : ''}`}>
      <div className="topology-node-content">
        {children}
      </div>
      <div className="topology-node-label">{data.label}</div>
      {handlePositions.map(({ id, type, position }) => (
        <Handle
          key={id}
          id={id}
          type={type}
          position={position}
          className="topology-handle"
        />
      ))}
    </div>
  );
}

export default memo(BaseNodeComponent);
export type { NodeProps };
