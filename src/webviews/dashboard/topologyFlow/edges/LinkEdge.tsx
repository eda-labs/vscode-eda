import { memo, useMemo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type Edge,
  useInternalNode,
} from '@xyflow/react';
import { useTheme } from '@mui/material/styles';

import { type Point, getNodeEdgePoint, createBezierPath } from '../geometry';

export interface LinkEdgeData extends Record<string, unknown> {
  sourceInterface?: string;
  targetInterface?: string;
  state?: string;
  sourceState?: string;
  targetState?: string;
  pairIndex?: number;
  totalInPair?: number;
  raw?: unknown;
  rawResource?: unknown;
}

export type LinkEdge = Edge<LinkEdgeData, 'linkEdge'>;

function getNodeCenter(node: { internals: { positionAbsolute: Point }; measured: { width?: number; height?: number } }): Point {
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? 80) / 2,
    y: node.internals.positionAbsolute.y + (node.measured.height ?? 80) / 2,
  };
}

interface EdgeColors {
  defaultStroke: string;
  selectedStroke: string;
  upStroke: string;
  downStroke: string;
}

function getStateColor(state: string | undefined, colors: EdgeColors): string {
  if (!state) return colors.defaultStroke;
  const s = state.toLowerCase();
  if (s === 'up' || s === 'active') return colors.upStroke;
  if (s === 'down' || s === 'error' || s === 'failed') return colors.downStroke;
  return colors.defaultStroke;
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
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const edgeData = useMemo(() => {
    if (!sourceNode || !targetNode) {
      return null;
    }

    const sourceCenter = getNodeCenter(sourceNode);
    const targetCenter = getNodeCenter(targetNode);

    // Get edge points on node boundaries
    const sourceWidth = sourceNode.measured.width ?? 80;
    const sourceHeight = sourceNode.measured.height ?? 80;
    const targetWidth = targetNode.measured.width ?? 80;
    const targetHeight = targetNode.measured.height ?? 80;

    const sourceEdge = getNodeEdgePoint(sourceCenter, sourceWidth, sourceHeight, targetCenter);
    const targetEdge = getNodeEdgePoint(targetCenter, targetWidth, targetHeight, sourceCenter);

    const pairIndex = data?.pairIndex ?? 0;
    const totalInPair = data?.totalInPair ?? 1;
    const bezier = createBezierPath(sourceEdge, targetEdge, pairIndex, totalInPair);

    return {
      ...bezier,
      stroke: getStateColor(data?.state, edgeColors),
    };
  }, [sourceNode, targetNode, data?.pairIndex, data?.totalInPair, data?.state, edgeColors]);

  if (!edgeData) return null;

  const strokeWidth = selected ? 3 : 1.5;
  const edgeStroke = selected ? edgeColors.selectedStroke : edgeData.stroke;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgeData.path}
        style={{
          stroke: edgeStroke,
          strokeWidth,
        }}
        interactionWidth={20}
      />
      {data?.sourceInterface && (
        <EdgeLabelRenderer>
          <div
            className="topology-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${edgeData.sourceLabel.x}px, ${edgeData.sourceLabel.y}px)`,
              pointerEvents: 'none',
            }}
          >
            {data.sourceInterface}
          </div>
        </EdgeLabelRenderer>
      )}
      {data?.targetInterface && (
        <EdgeLabelRenderer>
          <div
            className="topology-edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${edgeData.targetLabel.x}px, ${edgeData.targetLabel.y}px)`,
              pointerEvents: 'none',
            }}
          >
            {data.targetInterface}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(LinkEdgeComponent);
