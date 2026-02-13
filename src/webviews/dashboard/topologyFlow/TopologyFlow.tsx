import { useCallback, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  type ColorMode,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react';

import DeviceNode, { type TopologyNode, type TopologyNodeData } from './nodes/DeviceNode';
import NamespaceLabelNodeComponent, { type NamespaceLabelNode } from './nodes/NamespaceLabelNode';
import LinkEdgeComponent, { type LinkEdge, type LinkEdgeData } from './edges/LinkEdge';
import { getNodeIcon } from './nodes/icons';

export type FlowNode = TopologyNode | NamespaceLabelNode;

const nodeTypes = {
  deviceNode: DeviceNode,
  namespaceLabel: NamespaceLabelNodeComponent,
};

const edgeTypes = {
  linkEdge: LinkEdgeComponent,
};

const defaultEdgeOptions = {
  type: 'linkEdge',
  interactionWidth: 20,
};

interface TopologyFlowProps {
  readonly nodes: FlowNode[];
  readonly edges: LinkEdge[];
  readonly onNodeSelect?: (node: TopologyNode) => void;
  readonly onEdgeSelect?: (edge: LinkEdge) => void;
  readonly onNodeDoubleClick?: (node: TopologyNode) => void;
  readonly onBackgroundClick?: () => void;
  readonly colorMode?: ColorMode;
  readonly labelMode?: 'hide' | 'show' | 'select';
  readonly selectedNodeId?: string | null;
  readonly selectedEdgeId?: string | null;
}

export interface TopologyFlowRef {
  exportImage: (options: ExportOptions) => Promise<void>;
}

export interface ExportOptions {
  backgroundColor?: string;
  transparentBg?: boolean;
  includeLabels?: boolean;
}

const SVG_PADDING = 50;
const NODE_WIDTH = 80;
const NODE_HEIGHT = 80;
const CONTROL_POINT_STEP = 40;
const LABEL_OFFSET = 25;

// Helper functions for SVG export
function createBezierPath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  pairIndex: number,
  totalInPair: number
): { path: string; sourceLabel: { x: number; y: number }; targetLabel: { x: number; y: number } } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  const perpX = -dy / len;
  const perpY = dx / len;

  let offset = 0;
  if (totalInPair > 1) {
    const sign = pairIndex % 2 === 0 ? 1 : -1;
    const magnitude = Math.floor(pairIndex / 2) + 1;
    offset = sign * magnitude * CONTROL_POINT_STEP;
  }

  const midX = (source.x + target.x) / 2 + perpX * offset;
  const midY = (source.y + target.y) / 2 + perpY * offset;

  const path = `M ${source.x} ${source.y} Q ${midX} ${midY} ${target.x} ${target.y}`;

  const normDx = dx / len;
  const normDy = dy / len;

  return {
    path,
    sourceLabel: {
      x: source.x + normDx * LABEL_OFFSET + perpX * offset * 0.3,
      y: source.y + normDy * LABEL_OFFSET + perpY * offset * 0.3,
    },
    targetLabel: {
      x: target.x - normDx * LABEL_OFFSET + perpX * offset * 0.3,
      y: target.y - normDy * LABEL_OFFSET + perpY * offset * 0.3,
    },
  };
}

function getNodeEdgePoint(
  center: { x: number; y: number },
  width: number,
  height: number,
  targetPoint: { x: number; y: number }
): { x: number; y: number } {
  const dx = targetPoint.x - center.x;
  const dy = targetPoint.y - center.y;

  if (dx === 0 && dy === 0) return center;

  const halfW = width / 2;
  const halfH = height / 2;

  let t = Infinity;

  if (dx > 0) {
    const tRight = halfW / dx;
    if (Math.abs(dy * tRight) <= halfH) t = Math.min(t, tRight);
  }
  if (dx < 0) {
    const tLeft = -halfW / dx;
    if (Math.abs(dy * tLeft) <= halfH) t = Math.min(t, tLeft);
  }
  if (dy > 0) {
    const tBottom = halfH / dy;
    if (Math.abs(dx * tBottom) <= halfW) t = Math.min(t, tBottom);
  }
  if (dy < 0) {
    const tTop = -halfH / dy;
    if (Math.abs(dx * tTop) <= halfW) t = Math.min(t, tTop);
  }

  return { x: center.x + dx * t, y: center.y + dy * t };
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface SvgColors {
  bg: string;
  text: string;
  nodeStroke: string;
  nodeFill: string;
  iconBg: string;
  iconFg: string;
  edgeStroke: string;
  labelBg: string;
}

function getSvgColors(isDark: boolean, options: ExportOptions): SvgColors {
  const defaultBg = isDark ? '#1e1e1e' : '#ffffff';
  return {
    bg: options.transparentBg ? 'none' : (options.backgroundColor ?? defaultBg),
    text: isDark ? '#cccccc' : '#333333',
    nodeStroke: isDark ? '#3c3c3c' : '#e0e0e0',
    nodeFill: isDark ? '#252526' : '#ffffff',
    iconBg: isDark ? '#0e639c' : '#007acc',
    iconFg: '#ffffff',
    edgeStroke: isDark ? '#6e6e6e' : '#999999',
    labelBg: isDark ? '#252526' : '#ffffff',
  };
}

function generateEdgeSvg(
  edge: LinkEdge,
  nodePositions: Map<string, { x: number; y: number }>,
  colors: SvgColors,
  includeLabels: boolean
): { path: string; labels: string } {
  const sourcePos = nodePositions.get(edge.source);
  const targetPos = nodePositions.get(edge.target);
  if (!sourcePos || !targetPos) return { path: '', labels: '' };

  const sourceCenter = { x: sourcePos.x + NODE_WIDTH / 2, y: sourcePos.y + NODE_HEIGHT / 2 };
  const targetCenter = { x: targetPos.x + NODE_WIDTH / 2, y: targetPos.y + NODE_HEIGHT / 2 };

  const sourceEdge = getNodeEdgePoint(sourceCenter, NODE_WIDTH, NODE_HEIGHT, targetCenter);
  const targetEdge = getNodeEdgePoint(targetCenter, NODE_WIDTH, NODE_HEIGHT, sourceCenter);

  const pairIndex = edge.data?.pairIndex ?? 0;
  const totalInPair = edge.data?.totalInPair ?? 1;
  const bezier = createBezierPath(sourceEdge, targetEdge, pairIndex, totalInPair);

  const path = `<path d="${bezier.path}" fill="none" stroke="${colors.edgeStroke}" stroke-width="1.5"/>`;

  let labels = '';
  if (includeLabels && edge.data?.sourceInterface) {
    labels += `<g transform="translate(${bezier.sourceLabel.x}, ${bezier.sourceLabel.y})">
      <rect x="-20" y="-8" width="40" height="16" rx="3" fill="${colors.labelBg}" fill-opacity="0.9"/>
      <text text-anchor="middle" dominant-baseline="middle" font-size="9" fill="${colors.text}">${escapeXml(edge.data.sourceInterface)}</text>
    </g>`;
  }
  if (includeLabels && edge.data?.targetInterface) {
    labels += `<g transform="translate(${bezier.targetLabel.x}, ${bezier.targetLabel.y})">
      <rect x="-20" y="-8" width="40" height="16" rx="3" fill="${colors.labelBg}" fill-opacity="0.9"/>
      <text text-anchor="middle" dominant-baseline="middle" font-size="9" fill="${colors.text}">${escapeXml(edge.data.targetInterface)}</text>
    </g>`;
  }

  return { path, labels };
}

function generateNodeSvg(node: FlowNode, offsetX: number, offsetY: number, colors: SvgColors): string {
  const x = node.position.x + offsetX;
  const y = node.position.y + offsetY;

  if (node.type === 'namespaceLabel') {
    return `<text x="${x}" y="${y}" text-anchor="middle" font-size="14" font-weight="600" fill="${colors.text}">${escapeXml(String(node.data.label))}</text>`;
  }

  if (node.type === 'deviceNode') {
    const data = node.data as TopologyNodeData;
    const iconSvg = getNodeIcon(data.role)
      .replace(/var\(--color-icon-bg\)/g, colors.iconBg)
      .replace(/var\(--color-icon-fg\)/g, colors.iconFg)
      .replace(/width="28" height="28"/, 'width="32" height="32"');

    return `<g transform="translate(${x}, ${y})">
      <rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="8" fill="${colors.nodeFill}" stroke="${colors.nodeStroke}" stroke-width="1"/>
      <g transform="translate(${(NODE_WIDTH - 32) / 2}, 12)">${iconSvg}</g>
      <text x="${NODE_WIDTH / 2}" y="${NODE_HEIGHT - 8}" text-anchor="middle" font-size="10" fill="${colors.text}">${escapeXml(data.label)}</text>
    </g>`;
  }

  return '';
}

function downloadSvg(content: string): void {
  const blob = new Blob([content], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'topology.svg';
  a.click();
  URL.revokeObjectURL(url);
}

function TopologyFlowInner({
  nodes: initialNodes,
  edges: initialEdges,
  onNodeSelect,
  onEdgeSelect,
  onNodeDoubleClick,
  onBackgroundClick,
  colorMode = 'system',
  labelMode = 'select',
  selectedNodeId,
  selectedEdgeId,
}: TopologyFlowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LinkEdge>(initialEdges);

  // Update nodes and edges when props change
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const handleNodeClick: NodeMouseHandler<FlowNode> = useCallback(
    (_event, node) => {
      // Only handle device nodes, not namespace labels
      if (node.type === 'deviceNode') {
        onNodeSelect?.(node as TopologyNode);
      }
    },
    [onNodeSelect]
  );

  const handleEdgeClick: EdgeMouseHandler<LinkEdge> = useCallback(
    (_event, edge) => {
      onEdgeSelect?.(edge);
    },
    [onEdgeSelect]
  );

  const handleNodeDoubleClick: NodeMouseHandler<FlowNode> = useCallback(
    (_event, node) => {
      // Only handle device nodes, not namespace labels
      if (node.type === 'deviceNode') {
        onNodeDoubleClick?.(node as TopologyNode);
      }
    },
    [onNodeDoubleClick]
  );

  const handlePaneClick = useCallback(() => {
    onBackgroundClick?.();
  }, [onBackgroundClick]);

  // Find the selected edge to get connected node IDs
  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null;
    return edges.find(e => e.id === selectedEdgeId) ?? null;
  }, [edges, selectedEdgeId]);

  // Apply label visibility and selection state to edges
  const processedEdges = useMemo(() => {
    return edges.map((edge) => {
      const isDirectlySelected = edge.id === selectedEdgeId;
      // Edge is highlighted if: directly selected OR connected to selected node
      const isConnectedToSelectedNode = selectedNodeId != null &&
        (edge.source === selectedNodeId || edge.target === selectedNodeId);
      const isHighlighted = isDirectlySelected || isConnectedToSelectedNode;

      // Show labels based on mode
      const showLabels =
        labelMode === 'show' ||
        (labelMode === 'select' && isHighlighted);

      return {
        ...edge,
        selected: isHighlighted || undefined,
        data: {
          ...edge.data,
          sourceInterface: showLabels ? edge.data?.sourceInterface : undefined,
          targetInterface: showLabels ? edge.data?.targetInterface : undefined,
        },
      };
    });
  }, [edges, selectedEdgeId, selectedNodeId, labelMode]);

  // Apply selection state to nodes
  const processedNodes = useMemo(() => {
    return nodes.map((node) => {
      const isDirectlySelected = node.id === selectedNodeId;
      // Node is highlighted if: directly selected OR connected to selected edge
      const isConnectedToSelectedEdge = selectedEdge != null &&
        (selectedEdge.source === node.id || selectedEdge.target === node.id);
      const isHighlighted = isDirectlySelected || isConnectedToSelectedEdge;

      return {
        ...node,
        selected: isHighlighted || undefined,
      };
    });
  }, [nodes, selectedNodeId, selectedEdge]);

  return (
    <div id="topology-flow-container" style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={processedNodes}
        edges={processedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        defaultEdgeOptions={defaultEdgeOptions}
        colorMode={colorMode}
        nodesDraggable={true}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable={true}
        panOnDrag
        zoomOnScroll
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}

// Wrapper component with ref for export functionality
const TopologyFlowWithRef = forwardRef<TopologyFlowRef, TopologyFlowProps>(
  function TopologyFlowWithRef(props, ref) {
    const { getNodes, getEdges } = useReactFlow();

    const exportImage = useCallback(async (options: ExportOptions) => {
      const nodes = getNodes() as FlowNode[];
      const edges = getEdges() as LinkEdge[];
      if (nodes.length === 0) return;

      const bounds = getNodesBounds(nodes);
      const width = bounds.width + SVG_PADDING * 2 + NODE_WIDTH;
      const height = bounds.height + SVG_PADDING * 2 + NODE_HEIGHT;
      const offsetX = -bounds.x + SVG_PADDING + NODE_WIDTH / 2;
      const offsetY = -bounds.y + SVG_PADDING + NODE_HEIGHT / 2;

      const isDark = document.body.classList.contains('vscode-dark');
      const colors = getSvgColors(isDark, options);

      // Build node position map
      const nodePositions = new Map<string, { x: number; y: number }>();
      for (const node of nodes) {
        if (node.type === 'deviceNode') {
          nodePositions.set(node.id, { x: node.position.x + offsetX, y: node.position.y + offsetY });
        }
      }

      // Generate SVG parts
      let edgesSvg = '';
      let edgeLabelsSvg = '';
      for (const edge of edges) {
        const result = generateEdgeSvg(edge, nodePositions, colors, options.includeLabels ?? false);
        edgesSvg += result.path;
        edgeLabelsSvg += result.labels;
      }

      const nodesSvg = nodes.map(node => generateNodeSvg(node, offsetX, offsetY, colors)).join('');

      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${colors.bg}"/>
  <g id="edges">${edgesSvg}</g>
  <g id="edge-labels">${edgeLabelsSvg}</g>
  <g id="nodes">${nodesSvg}</g>
</svg>`;

      downloadSvg(svg);
    }, [getNodes, getEdges]);

    useImperativeHandle(ref, () => ({ exportImage }), [exportImage]);

    return <TopologyFlowInner {...props} />;
  }
);

// Main export wrapped in ReactFlowProvider
const TopologyFlow = forwardRef<TopologyFlowRef, TopologyFlowProps>(
  function TopologyFlow(props, ref) {
    return (
      <ReactFlowProvider>
        <TopologyFlowWithRef ref={ref} {...props} />
      </ReactFlowProvider>
    );
  }
);

export default TopologyFlow;

// Export types for use in the dashboard
export type { TopologyNode, TopologyNodeData, LinkEdge as TopologyEdge, LinkEdgeData as TopologyEdgeData };
