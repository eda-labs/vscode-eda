import React, { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

export interface BaseNodeData extends Record<string, unknown> {
  label: string;
  displayLabel?: string;
  tier?: number;
  role?: string;
  raw?: unknown;
  highlighted?: boolean;
}

export type BaseNode = Node<BaseNodeData>;

interface BaseNodeComponentProps {
  readonly data: BaseNodeData;
  readonly selected?: boolean;
  readonly children?: React.ReactNode;
}

const NODE_LABEL_MAX_CHARS = 11;

function truncateMiddle(value: string, maxChars: number): string {
  if (maxChars <= 0 || value.length <= maxChars) {
    return value;
  }
  if (maxChars === 1) {
    return '…';
  }

  const ellipsis = '…';
  const available = maxChars - ellipsis.length;
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return `${value.slice(0, headLength)}${ellipsis}${value.slice(value.length - tailLength)}`;
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
  const isHighlighted = selected || Boolean(data.highlighted);
  const fullLabel = data.label;
  const rawDisplayLabel = data.displayLabel ?? fullLabel;
  const showLabel = rawDisplayLabel.trim().length > 0;
  const displayLabel = truncateMiddle(rawDisplayLabel, NODE_LABEL_MAX_CHARS);

  return (
    <div className={`topology-node ${isHighlighted ? 'selected' : ''}`}>
      <div className="topology-node-content">
        {children}
      </div>
      {showLabel && (
        <div className="topology-node-label" title={fullLabel}>{displayLabel}</div>
      )}
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
