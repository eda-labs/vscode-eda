import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';

export interface NamespaceLabelData extends Record<string, unknown> {
  label: string;
}

export type NamespaceLabelNode = Node<NamespaceLabelData, 'namespaceLabel'>;

function NamespaceLabelNodeComponent({ data }: NodeProps<NamespaceLabelNode>) {
  return (
    <div className="namespace-label">
      {data.label}
    </div>
  );
}

export default memo(NamespaceLabelNodeComponent);
