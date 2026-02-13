import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { ColorMode } from '@xyflow/react';
import { alpha, useTheme } from '@mui/material/styles';

import { mountWebview } from '../../shared/utils';
import { usePostMessage, useMessageListener } from '../../shared/hooks';

import TopologyFlow, { type TopologyNode, type TopologyEdge, type FlowNode, type TopologyFlowRef } from './TopologyFlow';

interface BackendNode {
  id: string;
  label: string;
  tier?: number;
  role?: string;
  raw?: unknown;
}

interface BackendEdge {
  source: string;
  target: string;
  sourceInterface?: string;
  targetInterface?: string;
  sourceState?: string;
  targetState?: string;
  state?: string;
  raw?: unknown;
  rawResource?: unknown;
}

interface TopologyMessage {
  command: string;
  namespaces?: string[];
  selected?: string;
  nodes?: BackendNode[];
  edges?: BackendEdge[];
}

interface NodeInfo {
  name: string;
  namespace: string;
  labels?: Record<string, string>;
  status?: string;
  sync?: string;
  nodeDetails?: string;
  nodeState?: string;
  nppState?: string;
  os?: string;
  platform?: string;
  version?: string;
}

interface EdgeInfo {
  sourceNode: string;
  sourceInterface: string;
  sourceState?: string;
  targetNode: string;
  targetInterface: string;
  targetState?: string;
  state?: string;
  type?: string;
}

// Helper to get nested property with fallback keys
function getNestedProp(obj: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const val = obj?.[key];
    if (val !== undefined && val !== null) return String(val);
  }
  return undefined;
}

// Helper to get property from spec or status
function getSpecOrStatus(
  spec: Record<string, unknown> | undefined,
  status: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const val = spec?.[key] ?? status?.[key];
  return val !== undefined && val !== null ? String(val) : undefined;
}

function extractNodeInfo(raw: unknown): NodeInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const metadata = obj.metadata as Record<string, unknown> | undefined;
  if (!metadata) return null;

  const status = obj.status as Record<string, unknown> | undefined;
  const spec = obj.spec as Record<string, unknown> | undefined;
  const productionAddr = spec?.productionAddress as Record<string, unknown> | undefined;

  return {
    name: String(metadata.name ?? ''),
    namespace: String(metadata.namespace ?? ''),
    labels: metadata.labels as Record<string, string> | undefined,
    status: getNestedProp(status, 'status'),
    sync: getNestedProp(status, 'sync'),
    nodeDetails: getNestedProp(status, 'node-details') ?? getNestedProp(productionAddr, 'ipv4'),
    nodeState: getNestedProp(status, 'node-state', 'nodeState'),
    nppState: getNestedProp(status, 'npp-state', 'nppState'),
    os: getSpecOrStatus(spec, status, 'operatingSystem'),
    platform: getSpecOrStatus(spec, status, 'platform'),
    version: getSpecOrStatus(spec, status, 'version')
  };
}

function extractEdgeInfo(raw: unknown, rawResource: unknown): EdgeInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const local = obj.local as Record<string, string> | undefined;
  const remote = obj.remote as Record<string, string> | undefined;
  if (!local || !remote) return null;

  const resource = rawResource as Record<string, unknown> | undefined;
  const status = resource?.status as Record<string, unknown> | undefined;
  const spec = resource?.spec as Record<string, unknown> | undefined;

  return {
    sourceNode: local.node ?? '',
    sourceInterface: local.interface ?? '',
    targetNode: remote.node ?? '',
    targetInterface: remote.interface ?? '',
    state: getNestedProp(status, 'operationalState', 'operationalstate'),
    type: getNestedProp(spec, 'type')
  };
}

// Layout constants
const SPACING_X = 180;
const SPACING_Y = 200;
const NAMESPACE_GAP = 150;
const LABEL_OFFSET_Y = -60;

function groupNodesByNamespace(backendNodes: BackendNode[]): Record<string, BackendNode[]> {
  const groups: Record<string, BackendNode[]> = {};
  for (const n of backendNodes) {
    const ns = n.id.includes('/') ? n.id.split('/')[0] : 'default';
    if (!groups[ns]) groups[ns] = [];
    groups[ns].push(n);
  }
  return groups;
}

function groupNodesByTier(nodes: BackendNode[]): Record<number, BackendNode[]> {
  const tiers: Record<number, BackendNode[]> = {};
  for (const n of nodes) {
    const t = n.tier ?? 1;
    if (!tiers[t]) tiers[t] = [];
    tiers[t].push(n);
  }
  return tiers;
}

function TopologyFlowDashboard() {
  const postMessage = usePostMessage();
  const theme = useTheme();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [labelMode, setLabelMode] = useState<'hide' | 'show' | 'select'>('select');
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<TopologyEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [infoCardContent, setInfoCardContent] = useState<string>('Select a node or link');
  const [colorMode, setColorMode] = useState<ColorMode>('system');

  // Export state
  const topologyRef = useRef<TopologyFlowRef>(null);
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [exportBgColor, setExportBgColor] = useState(() => theme.vscode.topology.editorBackground);
  const [exportBgTransparent, setExportBgTransparent] = useState(false);
  const topologyCssVars = useMemo(() => {
    const { topology, fonts } = theme.vscode;

    return {
      '--topology-link-stroke': topology.linkStroke,
      '--topology-link-stroke-selected': topology.linkStrokeSelected,
      '--topology-link-up': topology.linkUp,
      '--topology-link-down': topology.linkDown,
      '--topology-node-border': topology.nodeBorder,
      '--topology-node-border-selected': topology.nodeBorderSelected,
      '--topology-node-bg': topology.nodeBackground,
      '--topology-node-text': topology.nodeText,
      '--topology-handle-bg': topology.handleBackground,
      '--topology-handle-border': topology.handleBorder,
      '--topology-icon-bg': topology.iconBackground,
      '--topology-icon-fg': topology.iconForeground,
      '--topology-panel-border': topology.panelBorder,
      '--topology-widget-bg': topology.widgetBackground,
      '--topology-editor-bg': topology.editorBackground,
      '--topology-font-family': fonts.uiFamily,
      '--topology-font-size': `${fonts.uiSize}px`,
      '--topology-foreground': topology.foreground,
      '--topology-description-fg': topology.descriptionForeground,
      '--topology-link-fg': topology.linkForeground,
      '--topology-input-bg': topology.inputBackground,
      '--topology-input-fg': topology.inputForeground,
      '--topology-input-border': topology.inputBorder,
      '--topology-button-secondary-bg': topology.buttonSecondaryBackground,
      '--topology-button-secondary-fg': topology.buttonSecondaryForeground,
      '--topology-button-secondary-hover-bg': topology.buttonSecondaryHoverBackground,
      '--topology-button-border': topology.buttonBorder,
      '--topology-editor-line-fg': topology.editorLineForeground,
      '--topology-badge-bg': topology.badgeBackground,
      '--topology-header-shadow': `0 1px 3px ${alpha(theme.palette.text.primary, 0.16)}`,
      '--topology-container-shadow': `0 1px 2px ${alpha(theme.palette.text.primary, 0.12)}`,
      '--topology-card-shadow': `0 1px 3px ${alpha(theme.palette.text.primary, 0.16)}`,
      '--topology-edge-label-shadow': `0 1px 3px ${alpha(theme.palette.text.primary, 0.1)}`,
      '--topology-controls-shadow': `0 2px 6px ${alpha(theme.palette.text.primary, 0.15)}`,
      '--topology-modal-overlay': alpha(theme.palette.common.black, 0.5),
      '--topology-modal-shadow': `0 4px 16px ${alpha(theme.palette.text.primary, 0.3)}`
    } as React.CSSProperties;
  }, [theme]);

  // Keep React Flow in sync with MUI palette mode
  useEffect(() => {
    setColorMode(theme.palette.mode === 'dark' ? 'dark' : 'light');
  }, [theme.palette.mode]);

  // Post ready message on mount
  useEffect(() => {
    postMessage({ command: 'ready' });
  }, [postMessage]);

  // Layout nodes by namespace and tier
  const layoutByTier = useCallback((backendNodes: BackendNode[]): FlowNode[] => {
    const namespaceGroups = groupNodesByNamespace(backendNodes);
    const sortedNamespaces = Object.keys(namespaceGroups).sort();
    const hasMultipleNamespaces = sortedNamespaces.length > 1;
    const result: FlowNode[] = [];
    let currentXOffset = 0;

    for (const ns of sortedNamespaces) {
      const tiers = groupNodesByTier(namespaceGroups[ns]);
      const sortedTiers = Object.keys(tiers).sort((a, b) => Number(a) - Number(b));
      const nsMaxWidth = Math.max(100, ...sortedTiers.map(t => (tiers[Number(t)].length - 1) * SPACING_X));

      if (hasMultipleNamespaces) {
        result.push({
          id: `ns-label-${ns}`,
          type: 'namespaceLabel',
          position: { x: currentXOffset + nsMaxWidth / 2, y: LABEL_OFFSET_Y },
          data: { label: ns },
          selectable: false,
          draggable: false
        });
      }

      for (let tierIndex = 0; tierIndex < sortedTiers.length; tierIndex++) {
        const tierNodes = tiers[Number(sortedTiers[tierIndex])];
        const tierWidth = (tierNodes.length - 1) * SPACING_X;
        const tierXOffset = (nsMaxWidth - tierWidth) / 2;

        for (let idx = 0; idx < tierNodes.length; idx++) {
          const node = tierNodes[idx];
          result.push({
            id: node.id,
            type: 'deviceNode',
            position: { x: currentXOffset + tierXOffset + idx * SPACING_X, y: tierIndex * SPACING_Y },
            data: { label: node.label, tier: node.tier ?? 1, role: node.role, namespace: ns, raw: node.raw }
          });
        }
      }

      currentXOffset += nsMaxWidth + NAMESPACE_GAP;
    }

    return result;
  }, []);

  // Process edges with pair indices and totals
  const processEdges = useCallback((backendEdges: BackendEdge[]): TopologyEdge[] => {
    // First pass: count edges per pair
    const pairCount: Record<string, number> = {};
    backendEdges.forEach(e => {
      const pairKey = [e.source, e.target].sort().join('|');
      pairCount[pairKey] = (pairCount[pairKey] ?? 0) + 1;
    });

    // Second pass: assign indices
    const pairIndex: Record<string, number> = {};
    return backendEdges.map(e => {
      const pairKey = [e.source, e.target].sort().join('|');
      const idx = pairIndex[pairKey] ?? 0;
      pairIndex[pairKey] = idx + 1;
      const total = pairCount[pairKey] ?? 1;

      return {
        id: `${e.source}--${e.target}--${idx}`,
        source: e.source,
        target: e.target,
        type: 'linkEdge',
        data: {
          sourceInterface: e.sourceInterface,
          targetInterface: e.targetInterface,
          state: e.state,
          sourceState: e.sourceState,
          targetState: e.targetState,
          pairIndex: idx,
          totalInPair: total,
          raw: e.raw,
          rawResource: e.rawResource
        }
      };
    });
  }, []);

  // Handle messages from extension
  useMessageListener<TopologyMessage>(useCallback((msg) => {
    if (msg.command === 'init') {
      setNamespaces(msg.namespaces ?? []);
      setSelectedNamespace(msg.selected ?? (msg.namespaces?.[0] ?? ''));
    } else if (msg.command === 'data') {
      const layoutedNodes = layoutByTier(msg.nodes ?? []);
      const processedEdges = processEdges(msg.edges ?? []);
      setNodes(layoutedNodes);
      setEdges(processedEdges);
    }
  }, [layoutByTier, processEdges]));

  // Handle node selection
  const handleNodeSelect = useCallback((node: TopologyNode) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);

    const info = extractNodeInfo(node.data.raw);
    if (info) {
      const row = (label: string, value: string | undefined) =>
        value ? `<tr><td>${label}</td><td>${value}</td></tr>` : '';
      const section = (title: string) => `<tr class="section"><td colspan="2">${title}</td></tr>`;

      let html = `<h3><a class="node-link" href="#" data-node="${info.name}" data-ns="${info.namespace}">${info.name}</a></h3>`;
      html += '<table>';
      html += row('Namespace', info.namespace);
      html += row('Status', info.status);
      html += row('Sync', info.sync);
      html += row('Node Details', info.nodeDetails);
      html += row('Node State', info.nodeState);
      html += row('NPP State', info.nppState);
      html += row('Operating System', info.os);
      html += row('Platform', info.platform);
      html += row('Version', info.version);
      if (info.labels && Object.keys(info.labels).length > 0) {
        html += section('Labels');
        Object.entries(info.labels).forEach(([k, v]) => {
          html += `<tr><td>${k}</td><td>${v}</td></tr>`;
        });
      }
      html += '</table>';
      html += `<p style="margin-top: 12px"><a class="link-resource" href="#" data-raw='${JSON.stringify(node.data.raw).replace(/'/g, '&#39;')}' data-stream="toponodes">View Resource</a></p>`;
      setInfoCardContent(html);
    }
  }, []);

  // Handle edge selection
  const handleEdgeSelect = useCallback((edge: TopologyEdge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);

    const info = extractEdgeInfo(edge.data?.raw, edge.data?.rawResource);
    if (info) {
      const row = (label: string, value: string | undefined) =>
        value ? `<tr><td>${label}</td><td>${value}</td></tr>` : '';
      const section = (title: string) => `<tr class="section"><td colspan="2">${title}</td></tr>`;

      let html = `<h3><a class="link-resource" href="#" data-raw='${JSON.stringify(edge.data?.rawResource).replace(/'/g, '&#39;')}' data-stream="topolinks">${info.sourceNode} → ${info.targetNode}</a></h3>`;
      html += '<table>';
      html += row('Type', info.type);
      html += row('State', info.state);
      html += section('Local Endpoint');
      html += row('Node', info.sourceNode);
      html += row('Interface', info.sourceInterface);
      html += row('State', info.sourceState);
      html += section('Remote Endpoint');
      html += row('Node', info.targetNode);
      html += row('Interface', info.targetInterface);
      html += row('State', info.targetState);
      html += '</table>';
      setInfoCardContent(html);
    }
  }, []);

  // Handle double-click to SSH
  const handleNodeDoubleClick = useCallback((node: TopologyNode) => {
    const info = extractNodeInfo(node.data.raw);
    if (info) {
      postMessage({
        command: 'sshTopoNode',
        name: info.name,
        namespace: info.namespace,
        nodeDetails: info.nodeDetails
      });
    }
  }, [postMessage]);

  // Handle background click
  const handleBackgroundClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setInfoCardContent('Select a node or link');
  }, []);

  // Handle namespace change
  const handleNamespaceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const ns = e.target.value;
    setSelectedNamespace(ns);
    postMessage({ command: 'setNamespace', namespace: ns });
  }, [postMessage]);

  // Handle info card click events
  const handleInfoCardClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('node-link')) {
      e.preventDefault();
      const name = target.dataset.node;
      const namespace = target.dataset.ns;
      if (name && namespace) {
        const node = nodes.find(n => n.type === 'deviceNode' && n.data.label === name);
        if (node) {
          const info = extractNodeInfo(node.data.raw);
          postMessage({
            command: 'sshTopoNode',
            name,
            namespace,
            nodeDetails: info?.nodeDetails
          });
        }
      }
    } else if (target.classList.contains('link-resource')) {
      e.preventDefault();
      const rawStr = target.dataset.raw;
      const streamGroup = target.dataset.stream;
      if (rawStr && streamGroup) {
        try {
          const raw: unknown = JSON.parse(rawStr);
          postMessage({ command: 'openResource', raw, streamGroup });
        } catch {
          // ignore parse errors
        }
      }
    }
  }, [nodes, postMessage]);

  // Show export popup with theme-appropriate defaults
  const showExportPopupWithDefaults = useCallback(() => {
    setExportBgColor(theme.vscode.topology.editorBackground);
    setShowExportPopup(true);
  }, [theme.vscode.topology.editorBackground]);

  // Handle export
  const handleExport = useCallback(() => {
    const doExport = async () => {
      await topologyRef.current?.exportImage({
        backgroundColor: exportBgColor,
        transparentBg: exportBgTransparent,
        includeLabels: true
      });
      setShowExportPopup(false);
    };
    doExport().catch(() => { /* ignore */ });
  }, [exportBgColor, exportBgTransparent]);

  return (
    <div className="dashboard" style={topologyCssVars}>
      <div className="header">
        <button className="export-btn" onClick={showExportPopupWithDefaults}>
          Export SVG
        </button>
        <select
          className="namespace-select"
          value={selectedNamespace}
          onChange={handleNamespaceChange}
        >
          {namespaces.map(ns => (
            <option key={ns} value={ns}>{ns}</option>
          ))}
        </select>
        <select
          className="label-select"
          value={labelMode}
          onChange={e => setLabelMode(e.target.value as 'hide' | 'show' | 'select')}
        >
          <option value="hide">Hide Labels</option>
          <option value="show">Show Labels</option>
          <option value="select">Show on Select</option>
        </select>
      </div>
      <div className="body">
        <div className="topology-container">
          <TopologyFlow
            ref={topologyRef}
            nodes={nodes}
            edges={edges}
            onNodeSelect={handleNodeSelect}
            onEdgeSelect={handleEdgeSelect}
            onNodeDoubleClick={handleNodeDoubleClick}
            onBackgroundClick={handleBackgroundClick}
            colorMode={colorMode}
            labelMode={labelMode}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
          />
        </div>
        <div
          className="info-card"
          onClick={handleInfoCardClick}
          dangerouslySetInnerHTML={{ __html: infoCardContent }}
        />
      </div>
      {showExportPopup && (
        <div className="export-popup">
          <div className="export-popup-content">
            <h3>Export SVG</h3>
            <label>
              Background Color
              <input
                type="color"
                value={exportBgColor}
                onChange={e => setExportBgColor(e.target.value)}
                disabled={exportBgTransparent}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={exportBgTransparent}
                onChange={e => setExportBgTransparent(e.target.checked)}
              />
              Transparent Background
            </label>
            <div className="export-popup-buttons">
              <button className="export-btn" onClick={handleExport}>Export</button>
              <button className="export-btn cancel" onClick={() => setShowExportPopup(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

mountWebview(TopologyFlowDashboard);
