import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { ColorMode } from '@xyflow/react';
import { alpha, useTheme } from '@mui/material/styles';

import { ALL_NAMESPACES } from '../../constants';
import { mountWebview } from '../../shared/utils';
import { usePostMessage, useMessageListener } from '../../shared/hooks';

import TopologyFlow, {
  type TopologyNode,
  type TopologyEdge,
  type FlowNode,
  type TopologyFlowRef
} from './TopologyFlow';
import {
  DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS,
  collectGrafanaEdgeCellMappings,
  collectLinkedNodeIds,
  sanitizeSvgForGrafana,
  removeUnlinkedNodesFromSvg,
  trimGrafanaSvgToTopologyContent,
  addGrafanaTrafficLegend,
  makeGrafanaSvgResponsive,
  applyGrafanaCellIdsToSvg,
  buildGrafanaPanelYaml,
  buildGrafanaDashboardJson,
  type GrafanaTrafficThresholds
} from './svg-export';
import {
  type NodePositionMap,
  nodePositionMapsEqual,
  normalizeNodePositionMap,
  topologyNodeIdToName
} from './topologyPositionUtils';

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
  sourceEndpoint?: string;
  targetEndpoint?: string;
  sourceState?: string;
  targetState?: string;
  state?: string;
  raw?: unknown;
  rawResource?: unknown;
}

interface TopologyInitMessage {
  command: 'init' | 'namespace';
  selected?: string;
}

interface TopologyDataMessage {
  command: 'data';
  nodes?: BackendNode[];
  edges?: BackendEdge[];
  savedPositions?: NodePositionMap;
}

interface TopologySaveResultMessage {
  command: 'saveTopologyPositionsResult';
  ok: boolean;
  message?: string;
  positions?: NodePositionMap;
}

interface TopologySvgExportResultMessage {
  command: 'svgExportResult';
  requestId: string;
  success: boolean;
  error?: string;
  files?: string[];
}

type TopologyMessage =
  | TopologyInitMessage
  | TopologyDataMessage
  | TopologySaveResultMessage
  | TopologySvgExportResultMessage;

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

// Info card state types
type InfoCardState =
  | { type: 'empty' }
  | { type: 'node'; info: NodeInfo; raw: unknown }
  | { type: 'edge'; info: EdgeInfo; raw: unknown; rawResource: unknown };

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

// Info card helper: renders a table row if value is defined
function InfoRow({ label, value }: Readonly<{ label: string; value: string | undefined }>) {
  if (!value) return null;
  return <tr><td>{label}</td><td>{value}</td></tr>;
}

function InfoSection({ title }: Readonly<{ title: string }>) {
  return <tr className="section"><td colSpan={2}>{title}</td></tr>;
}

function InfoCardNode({
  info,
  raw,
  onSsh,
  onOpenResource
}: Readonly<{
  info: NodeInfo;
  raw: unknown;
  onSsh: (name: string, ns: string, nodeDetails?: string) => void;
  onOpenResource: (raw: unknown, streamGroup: string) => void;
}>) {
  return (
    <>
      <h3>
        <a className="node-link" href="#" onClick={(e) => { e.preventDefault(); onSsh(info.name, info.namespace, info.nodeDetails); }}>
          {info.name}
        </a>
      </h3>
      <table>
        <tbody>
          <InfoRow label="Namespace" value={info.namespace} />
          <InfoRow label="Status" value={info.status} />
          <InfoRow label="Sync" value={info.sync} />
          <InfoRow label="Node Details" value={info.nodeDetails} />
          <InfoRow label="Node State" value={info.nodeState} />
          <InfoRow label="NPP State" value={info.nppState} />
          <InfoRow label="Operating System" value={info.os} />
          <InfoRow label="Platform" value={info.platform} />
          <InfoRow label="Version" value={info.version} />
          {info.labels && Object.keys(info.labels).length > 0 && (
            <>
              <InfoSection title="Labels" />
              {Object.entries(info.labels).map(([k, v]) => (
                <InfoRow key={k} label={k} value={v} />
              ))}
            </>
          )}
        </tbody>
      </table>
      <p style={{ marginTop: 12 }}>
        <a className="link-resource" href="#" onClick={(e) => { e.preventDefault(); onOpenResource(raw, 'toponodes'); }}>
          View Resource
        </a>
      </p>
    </>
  );
}

function InfoCardEdge({
  info,
  rawResource,
  onOpenResource
}: Readonly<{
  info: EdgeInfo;
  rawResource: unknown;
  onOpenResource: (raw: unknown, streamGroup: string) => void;
}>) {
  return (
    <>
      <h3>
        <a className="link-resource" href="#" onClick={(e) => { e.preventDefault(); onOpenResource(rawResource, 'topolinks'); }}>
          {info.sourceNode} → {info.targetNode}
        </a>
      </h3>
      <table>
        <tbody>
          <InfoRow label="Type" value={info.type} />
          <InfoRow label="State" value={info.state} />
          <InfoSection title="Local Endpoint" />
          <InfoRow label="Node" value={info.sourceNode} />
          <InfoRow label="Interface" value={info.sourceInterface} />
          <InfoRow label="State" value={info.sourceState} />
          <InfoSection title="Remote Endpoint" />
          <InfoRow label="Node" value={info.targetNode} />
          <InfoRow label="Interface" value={info.targetInterface} />
          <InfoRow label="State" value={info.targetState} />
        </tbody>
      </table>
    </>
  );
}

// Layout constants
const SPACING_X = 180;
const SPACING_Y = 200;
const NAMESPACE_GAP = 150;
const LABEL_OFFSET_Y = -60;
const DEFAULT_GRAFANA_NODE_SIZE_PX = 80;
const DEFAULT_GRAFANA_INTERFACE_SIZE_PERCENT = 100;
const INTERFACE_SELECT_AUTO = '__auto__';
const INTERFACE_SELECT_FULL = '__full__';
const INTERFACE_SELECT_TOKEN_PREFIX = '__token__:';
const GLOBAL_INTERFACE_PART_INDEX_PREFIX = '__part-index__:';
const EXPORT_REQUEST_TIMEOUT_MS = 30_000;
const NODE_LABEL_FILTER_ALL = '__all__';

type TrafficThresholdUnit = 'kbit' | 'mbit' | 'gbit';
type GrafanaSettingsTab = 'general' | 'interface-names';

interface EdgeInterfaceRow {
  edgeId: string;
  source: string;
  target: string;
  sourceEndpoint: string;
  targetEndpoint: string;
}

interface NodeLabelFilterOption {
  value: string;
  label: string;
}

interface GrafanaBundlePayload {
  requestId: string;
  baseName: string;
  svgContent: string;
  dashboardJson: string;
  panelYaml: string;
}

function createRequestId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `svg-export-${Date.now()}-${random}`;
}

function sanitizeExportBaseName(baseName: string | undefined): string {
  const trimmed = baseName?.trim();
  if (!trimmed) return 'topology';
  const withoutSvg = trimmed.replace(/\\.svg$/i, '');
  const invalidChars = new Set(['<', '>', ':', '"', '/', '\\\\', '|', '?', '*']);
  const sanitized = withoutSvg
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 || invalidChars.has(char) ? '-' : char))
    .join('')
    .trim();
  return sanitized || 'topology';
}

function isSvgExportResultMessage(message: unknown): message is TopologySvgExportResultMessage {
  if (!message || typeof message !== 'object') return false;
  const value = message as Record<string, unknown>;
  return value.command === 'svgExportResult' && typeof value.requestId === 'string' && typeof value.success === 'boolean';
}

function requestGrafanaBundleExport(
  postMessage: (message: unknown) => void,
  payload: GrafanaBundlePayload
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener('message', listener as EventListener);
      reject(new Error('Timed out waiting for export confirmation'));
    }, EXPORT_REQUEST_TIMEOUT_MS);

    const listener = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isSvgExportResultMessage(message)) return;
      if (message.requestId !== payload.requestId) return;

      window.clearTimeout(timeoutId);
      window.removeEventListener('message', listener as EventListener);

      if (!message.success) {
        reject(new Error(message.error ?? 'Grafana bundle export failed'));
        return;
      }

      const files = Array.isArray(message.files)
        ? message.files.filter((file): file is string => typeof file === 'string')
        : [];
      resolve(files);
    };

    window.addEventListener('message', listener as EventListener);

    postMessage({
      command: 'exportSvgGrafanaBundle',
      requestId: payload.requestId,
      baseName: payload.baseName,
      svgContent: payload.svgContent,
      dashboardJson: payload.dashboardJson,
      panelYaml: payload.panelYaml
    });
  });
}

function parseTrafficThresholdUnit(value: string): TrafficThresholdUnit {
  if (value === 'kbit' || value === 'gbit') return value;
  return 'mbit';
}

function getThresholdUnitMultiplier(unit: TrafficThresholdUnit): number {
  switch (unit) {
    case 'kbit':
      return 1_000;
    case 'gbit':
      return 1_000_000_000;
    default:
      return 1_000_000;
  }
}

function formatThresholdForUnit(valueBps: number, unit: TrafficThresholdUnit): string {
  const multiplier = getThresholdUnitMultiplier(unit);
  if (!Number.isFinite(valueBps) || multiplier <= 0) return '0';
  const scaled = valueBps / multiplier;
  return Number(scaled.toFixed(4)).toString();
}

function parseThreshold(value: string, unit: TrafficThresholdUnit): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  const multiplier = getThresholdUnitMultiplier(unit);
  return Math.max(0, Math.round(parsed * multiplier));
}

function getThresholdUnitStep(unit: TrafficThresholdUnit): number {
  switch (unit) {
    case 'kbit':
      return 1;
    case 'gbit':
      return 0.01;
    default:
      return 0.1;
  }
}

function parseBoundedNumber(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function hasStrictlyAscendingThresholds(thresholds: GrafanaTrafficThresholds): boolean {
  return (
    thresholds.green < thresholds.yellow
    && thresholds.yellow < thresholds.orange
    && thresholds.orange < thresholds.red
  );
}

function splitInterfaceParts(endpoint: string): string[] {
  const baseParts = endpoint
    .split(/[^A-Za-z0-9]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const uniqueParts: string[] = [];
  const seen = new Set<string>();
  const addUnique = (part: string): void => {
    if (seen.has(part)) return;
    seen.add(part);
    uniqueParts.push(part);
  };

  for (const part of baseParts) {
    addUnique(part);
    const numericSegments = part.match(/\d+/g);
    if (!numericSegments) continue;
    for (const numeric of numericSegments) {
      addUnique(numeric);
    }
  }

  return uniqueParts;
}

function parseGlobalInterfacePartIndex(selectedValue: string): number | null {
  if (!selectedValue.startsWith(GLOBAL_INTERFACE_PART_INDEX_PREFIX)) return null;
  const raw = selectedValue.slice(GLOBAL_INTERFACE_PART_INDEX_PREFIX.length);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

function resolveGlobalInterfaceOverrideValue(endpoint: string, selectedValue: string): string | null {
  if (selectedValue === INTERFACE_SELECT_AUTO) return null;
  if (selectedValue === INTERFACE_SELECT_FULL) return endpoint;

  const partIndex = parseGlobalInterfacePartIndex(selectedValue);
  if (partIndex === null) return null;

  const parts = splitInterfaceParts(endpoint);
  return parts[partIndex - 1] ?? null;
}

function resolveInterfaceOverrideValue(endpoint: string, selectedValue: string): string | null {
  if (selectedValue === INTERFACE_SELECT_AUTO) return null;
  if (selectedValue === INTERFACE_SELECT_FULL) return endpoint;
  if (!selectedValue.startsWith(INTERFACE_SELECT_TOKEN_PREFIX)) return null;
  const value = selectedValue.slice(INTERFACE_SELECT_TOKEN_PREFIX.length).trim();
  return value.length > 0 ? value : null;
}

function getInterfaceSelectionValue(
  endpoint: string,
  interfaceLabelOverrides: Record<string, string>
): string {
  const override = interfaceLabelOverrides[endpoint];
  if (!override) return INTERFACE_SELECT_AUTO;
  if (override === endpoint) return INTERFACE_SELECT_FULL;
  return `${INTERFACE_SELECT_TOKEN_PREFIX}${override}`;
}

function parseGrafanaSettingsTab(value: unknown): GrafanaSettingsTab {
  return value === 'interface-names' ? 'interface-names' : 'general';
}

function extractEdgeInterfaceRows(edges: TopologyEdge[]): EdgeInterfaceRow[] {
  const rows: EdgeInterfaceRow[] = [];
  for (const edge of edges) {
    const sourceEndpoint = edge.data?.sourceEndpoint;
    const targetEndpoint = edge.data?.targetEndpoint;
    if (!sourceEndpoint || !targetEndpoint) continue;

    rows.push({
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      sourceEndpoint,
      targetEndpoint
    });
  }
  return rows;
}

function getNamespaceFromNodeId(nodeId: string): string {
  const slashIndex = nodeId.indexOf('/');
  if (slashIndex <= 0) {
    return 'default';
  }
  return nodeId.slice(0, slashIndex);
}

function getNamespaceLabelNodeNamespace(nodeId: string): string | null {
  const prefix = 'ns-label-';
  if (!nodeId.startsWith(prefix)) {
    return null;
  }
  return nodeId.slice(prefix.length);
}

function extractRawNodeLabels(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const metadata = (raw as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== 'object') return {};
  const labels = (metadata as Record<string, unknown>).labels;
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return {};

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    if (value == null) continue;
    normalized[normalizedKey] = String(value);
  }
  return normalized;
}

function parseNodeLabelFilterValue(value: string): { key: string; expected: string } | null {
  if (value === NODE_LABEL_FILTER_ALL) {
    return null;
  }

  const separatorIndex = value.indexOf('=');
  if (separatorIndex <= 0) {
    return null;
  }
  return {
    key: value.slice(0, separatorIndex),
    expected: value.slice(separatorIndex + 1)
  };
}

function buildNodeLabelFilterOptions(nodes: FlowNode[]): NodeLabelFilterOption[] {
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'deviceNode') {
      continue;
    }
    const labels = extractRawNodeLabels(node.data.raw);
    for (const [key, value] of Object.entries(labels)) {
      seen.add(`${key}=${value}`);
    }
  }

  const sortedLabelPairs = Array.from(seen.values()).sort((left, right) => left.localeCompare(right));
  return [
    { value: NODE_LABEL_FILTER_ALL, label: 'Labels: All Nodes' },
    ...sortedLabelPairs.map((entry) => ({ value: entry, label: entry }))
  ];
}

function nodeMatchesSelectedLabel(node: FlowNode, selectedLabel: { key: string; expected: string } | null): boolean {
  if (node.type !== 'deviceNode') {
    return false;
  }
  if (selectedLabel === null) {
    return true;
  }

  const labels = extractRawNodeLabels(node.data.raw);
  return labels[selectedLabel.key] === selectedLabel.expected;
}

function groupNodesByNamespace(backendNodes: BackendNode[]): Record<string, BackendNode[]> {
  const groups: Record<string, BackendNode[]> = {};
  for (const n of backendNodes) {
    const ns = getNamespaceFromNodeId(n.id);
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

function extractDeviceNodePositions(flowNodes: FlowNode[]): NodePositionMap {
  const positions: NodePositionMap = {};
  for (const node of flowNodes) {
    if (node.type !== 'deviceNode') {
      continue;
    }
    const nodeName = topologyNodeIdToName(node.id);
    positions[nodeName] = { x: node.position.x, y: node.position.y };
  }
  return normalizeNodePositionMap(positions);
}

function TopologyFlowDashboard() {
  const postMessage = usePostMessage();
  const theme = useTheme();
  const [selectedNamespace, setSelectedNamespace] = useState(ALL_NAMESPACES);
  const [labelMode, setLabelMode] = useState<'hide' | 'show' | 'select'>('select');
  const [selectedNodeLabelFilter, setSelectedNodeLabelFilter] = useState<string>(NODE_LABEL_FILTER_ALL);
  const [allNodes, setAllNodes] = useState<FlowNode[]>([]);
  const [allEdges, setAllEdges] = useState<TopologyEdge[]>([]);
  const [savedPositions, setSavedPositions] = useState<NodePositionMap>({});
  const [currentPositions, setCurrentPositions] = useState<NodePositionMap>({});
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ level: 'success' | 'error'; text: string } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [infoCard, setInfoCard] = useState<InfoCardState>({ type: 'empty' });
  const [colorMode, setColorMode] = useState<ColorMode>('system');

  // Export state
  const topologyRef = useRef<TopologyFlowRef>(null);
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [exportBgColor, setExportBgColor] = useState(() => theme.vscode.topology.editorBackground);
  const [exportBgTransparent, setExportBgTransparent] = useState(false);
  const [borderZoom, setBorderZoom] = useState(100);
  const [borderPadding, setBorderPadding] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [includeEdgeLabels, setIncludeEdgeLabels] = useState(true);
  const [exportGrafanaBundle, setExportGrafanaBundle] = useState(false);
  const [isGrafanaSettingsOpen, setIsGrafanaSettingsOpen] = useState(false);
  const [grafanaSettingsTab, setGrafanaSettingsTab] = useState<GrafanaSettingsTab>('general');
  const [excludeNodesWithoutLinks, setExcludeNodesWithoutLinks] = useState(true);
  const [includeGrafanaLegend, setIncludeGrafanaLegend] = useState(false);
  const [trafficRatesOnHoverOnly, setTrafficRatesOnHoverOnly] = useState(false);
  const [includeHideRatesLegendToggle, setIncludeHideRatesLegendToggle] = useState(true);
  const [trafficThresholds, setTrafficThresholds] = useState<GrafanaTrafficThresholds>({
    ...DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS
  });
  const [trafficThresholdUnit, setTrafficThresholdUnit] = useState<TrafficThresholdUnit>('mbit');
  const [grafanaNodeSizePx, setGrafanaNodeSizePx] = useState(DEFAULT_GRAFANA_NODE_SIZE_PX);
  const [grafanaInterfaceSizePercent, setGrafanaInterfaceSizePercent] = useState(DEFAULT_GRAFANA_INTERFACE_SIZE_PERCENT);
  const [globalInterfaceOverrideSelection, setGlobalInterfaceOverrideSelection] = useState(INTERFACE_SELECT_AUTO);
  const [interfaceLinkFilter, setInterfaceLinkFilter] = useState('');
  const [interfaceLabelOverrides, setInterfaceLabelOverrides] = useState<Record<string, string>>({});
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
  const layoutByTier = useCallback((backendNodes: BackendNode[], persistedPositions: NodePositionMap = {}): FlowNode[] => {
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
          const nodeName = topologyNodeIdToName(node.id);
          const persisted = persistedPositions[node.id] ?? persistedPositions[nodeName];
          result.push({
            id: node.id,
            type: 'deviceNode',
            position: persisted ?? { x: currentXOffset + tierXOffset + idx * SPACING_X, y: tierIndex * SPACING_Y },
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
          sourceEndpoint: e.sourceEndpoint,
          targetEndpoint: e.targetEndpoint,
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

  const isAllNamespaces = selectedNamespace === ALL_NAMESPACES;
  const hasUnsavedChanges = useMemo(
    () => !nodePositionMapsEqual(currentPositions, savedPositions),
    [currentPositions, savedPositions]
  );
  const saveDisabled = isAllNamespaces || isSavingLayout || !hasUnsavedChanges;
  const nodeLabelFilterOptions = useMemo(
    () => buildNodeLabelFilterOptions(allNodes),
    [allNodes]
  );
  const selectedLabelMatcher = useMemo(
    () => parseNodeLabelFilterValue(selectedNodeLabelFilter),
    [selectedNodeLabelFilter]
  );
  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of allNodes) {
      if (nodeMatchesSelectedLabel(node, selectedLabelMatcher)) {
        ids.add(node.id);
      }
    }
    return ids;
  }, [allNodes, selectedLabelMatcher]);
  const visibleNodes = useMemo(() => {
    const visibleNamespaces = new Set<string>();
    for (const nodeId of visibleNodeIds) {
      visibleNamespaces.add(getNamespaceFromNodeId(nodeId));
    }

    const nodes: FlowNode[] = [];
    for (const node of allNodes) {
      if (node.type === 'deviceNode') {
        if (!visibleNodeIds.has(node.id)) {
          continue;
        }
        const nodeName = topologyNodeIdToName(node.id);
        const position = currentPositions[nodeName];
        if (position) {
          nodes.push({
            ...node,
            position: { x: position.x, y: position.y }
          });
        } else {
          nodes.push(node);
        }
        continue;
      }

      if (node.type === 'namespaceLabel') {
        const namespace = getNamespaceLabelNodeNamespace(node.id);
        if (namespace && visibleNamespaces.has(namespace)) {
          nodes.push(node);
        }
      }
    }

    return nodes;
  }, [allNodes, currentPositions, visibleNodeIds]);
  const visibleEdges = useMemo(
    () => allEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [allEdges, visibleNodeIds]
  );
  const interfaceRows = useMemo(() => extractEdgeInterfaceRows(visibleEdges), [visibleEdges]);
  const filteredInterfaceRows = useMemo(() => {
    const filterValue = interfaceLinkFilter.trim().toLowerCase();
    if (!filterValue) return interfaceRows;

    return interfaceRows.filter((row) =>
      [row.edgeId, row.source, row.target, row.sourceEndpoint, row.targetEndpoint]
        .join(' ')
        .toLowerCase()
        .includes(filterValue)
    );
  }, [interfaceRows, interfaceLinkFilter]);
  const interfaceEndpoints = useMemo(() => {
    const unique = new Set<string>();
    for (const row of interfaceRows) {
      unique.add(row.sourceEndpoint);
      unique.add(row.targetEndpoint);
    }
    return Array.from(unique.values());
  }, [interfaceRows]);
  const maxInterfacePartCount = useMemo(() => {
    let maxCount = 1;
    for (const endpoint of interfaceEndpoints) {
      maxCount = Math.max(maxCount, splitInterfaceParts(endpoint).length);
    }
    return maxCount;
  }, [interfaceEndpoints]);
  const effectiveInterfaceLabelOverrides = useMemo(() => {
    const merged: Record<string, string> = {};

    for (const endpoint of interfaceEndpoints) {
      const globalOverride = resolveGlobalInterfaceOverrideValue(
        endpoint,
        globalInterfaceOverrideSelection
      );
      if (globalOverride !== null) {
        merged[endpoint] = globalOverride;
      }
    }

    for (const [endpoint, override] of Object.entries(interfaceLabelOverrides)) {
      if (typeof override !== 'string' || override.trim().length === 0) {
        delete merged[endpoint];
      } else {
        merged[endpoint] = override.trim();
      }
    }

    return merged;
  }, [interfaceEndpoints, globalInterfaceOverrideSelection, interfaceLabelOverrides]);

  // Handle messages from extension
  useMessageListener<TopologyMessage>(useCallback((msg) => {
    if (msg.command === 'init' || msg.command === 'namespace') {
      setSelectedNamespace(msg.selected ?? ALL_NAMESPACES);
      setSelectedNodeLabelFilter(NODE_LABEL_FILTER_ALL);
      setSaveStatus(null);
      setIsSavingLayout(false);
      setCurrentPositions({});
      setSavedPositions({});
    } else if (msg.command === 'data') {
      const normalizedSavedPositions = normalizeNodePositionMap(msg.savedPositions);
      const layoutedNodes = layoutByTier(msg.nodes ?? [], normalizedSavedPositions);
      const processedEdges = processEdges(msg.edges ?? []);
      const baselinePositions = Object.keys(normalizedSavedPositions).length > 0
        ? normalizedSavedPositions
        : extractDeviceNodePositions(layoutedNodes);
      setAllNodes(layoutedNodes);
      setAllEdges(processedEdges);
      setSavedPositions(baselinePositions);
      setCurrentPositions(baselinePositions);
    } else if (msg.command === 'saveTopologyPositionsResult') {
      setIsSavingLayout(false);
      if (msg.ok) {
        const normalizedSavedPositions = normalizeNodePositionMap(msg.positions ?? currentPositions);
        setSavedPositions(normalizedSavedPositions);
        setCurrentPositions(normalizedSavedPositions);
        setSaveStatus({ level: 'success', text: msg.message ?? 'Layout saved.' });
      } else {
        setSaveStatus({ level: 'error', text: msg.message ?? 'Failed to save layout.' });
      }
    }
  }, [currentPositions, layoutByTier, processEdges]));

  useEffect(() => {
    if (selectedNodeLabelFilter === NODE_LABEL_FILTER_ALL) {
      return;
    }
    const optionExists = nodeLabelFilterOptions.some((option) => option.value === selectedNodeLabelFilter);
    if (!optionExists) {
      setSelectedNodeLabelFilter(NODE_LABEL_FILTER_ALL);
    }
  }, [nodeLabelFilterOptions, selectedNodeLabelFilter]);

  useEffect(() => {
    if (selectedNodeId && !visibleNodeIds.has(selectedNodeId)) {
      setSelectedNodeId(null);
      setInfoCard({ type: 'empty' });
    }
  }, [selectedNodeId, visibleNodeIds]);

  useEffect(() => {
    if (selectedEdgeId && !visibleEdges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
      setInfoCard({ type: 'empty' });
    }
  }, [selectedEdgeId, visibleEdges]);

  // Handle node selection
  const handleNodeSelect = useCallback((node: TopologyNode) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);

    const info = extractNodeInfo(node.data.raw);
    if (info) {
      setInfoCard({ type: 'node', info, raw: node.data.raw });
    }
  }, []);

  // Handle edge selection
  const handleEdgeSelect = useCallback((edge: TopologyEdge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);

    const info = extractEdgeInfo(edge.data?.raw, edge.data?.rawResource);
    if (info) {
      setInfoCard({ type: 'edge', info, raw: edge.data?.raw, rawResource: edge.data?.rawResource });
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
    setInfoCard({ type: 'empty' });
  }, []);

  // Handle SSH to node
  const handleSshToNode = useCallback((name: string, namespace: string, nodeDetails?: string) => {
    postMessage({
      command: 'sshTopoNode',
      name,
      namespace,
      nodeDetails
    });
  }, [postMessage]);

  // Handle opening a resource
  const handleOpenResource = useCallback((raw: unknown, streamGroup: string) => {
    postMessage({ command: 'openResource', raw, streamGroup });
  }, [postMessage]);

  const handleDevicePositionsChange = useCallback((positions: NodePositionMap) => {
    const normalizedIncoming = normalizeNodePositionMap(positions);
    setCurrentPositions((previous) => {
      const merged = normalizeNodePositionMap({ ...previous, ...normalizedIncoming });
      return nodePositionMapsEqual(previous, merged) ? previous : merged;
    });
  }, []);

  // Show export popup with theme-appropriate defaults
  const showExportPopupWithDefaults = useCallback(() => {
    setExportBgColor(theme.vscode.topology.editorBackground);
    setExportStatus(null);
    setShowExportPopup(true);
  }, [theme.vscode.topology.editorBackground]);

  // Handle export
  const handleExport = useCallback(() => {
    const doExport = async () => {
      if (!topologyRef.current) return;

      if (!hasStrictlyAscendingThresholds(trafficThresholds)) {
        setExportStatus({
          type: 'error',
          message: 'Traffic thresholds must be strictly ascending (green < yellow < orange < red)'
        });
        return;
      }

      setIsExporting(true);
      setExportStatus(null);

      const exportOptions = {
        backgroundColor: exportBgColor,
        transparentBg: exportBgTransparent,
        includeLabels: includeEdgeLabels,
        zoomPercent: borderZoom,
        paddingPx: borderPadding,
        nodeSizePx: exportGrafanaBundle ? grafanaNodeSizePx : undefined,
        interfaceScale: exportGrafanaBundle ? grafanaInterfaceSizePercent / 100 : undefined,
        interfaceLabelOverrides: exportGrafanaBundle ? effectiveInterfaceLabelOverrides : undefined,
        nodeProximateLabels: exportGrafanaBundle
      } as const;

      try {
        if (!exportGrafanaBundle) {
          await topologyRef.current.exportImage(exportOptions);
          setExportStatus({ type: 'success', message: 'SVG exported successfully' });
          setShowExportPopup(false);
          return;
        }

        const prepared = await topologyRef.current.buildSvgExport(exportOptions);
        if (!prepared) {
          setExportStatus({ type: 'error', message: 'SVG export is not yet available' });
          return;
        }

        const mappings = collectGrafanaEdgeCellMappings(prepared.edges, prepared.nodes, new Set<string>());
        let grafanaSvg = sanitizeSvgForGrafana(prepared.svgContent);
        if (excludeNodesWithoutLinks) {
          const linkedNodeIds = collectLinkedNodeIds(prepared.edges, prepared.nodes, new Set<string>());
          grafanaSvg = removeUnlinkedNodesFromSvg(grafanaSvg, linkedNodeIds);
          grafanaSvg = trimGrafanaSvgToTopologyContent(grafanaSvg, Math.max(6, borderPadding));
        }
        grafanaSvg = applyGrafanaCellIdsToSvg(grafanaSvg, mappings, { trafficRatesOnHoverOnly });
        if (includeGrafanaLegend) {
          grafanaSvg = addGrafanaTrafficLegend(grafanaSvg, trafficThresholds, trafficThresholdUnit);
        }
        grafanaSvg = makeGrafanaSvgResponsive(grafanaSvg);

        const panelYaml = buildGrafanaPanelYaml(mappings, {
          trafficThresholds,
          includeHideRatesLegendToggle
        });
        const baseName = sanitizeExportBaseName(
          selectedNamespace === ALL_NAMESPACES ? 'topology' : selectedNamespace
        );
        const dashboardJson = buildGrafanaDashboardJson(panelYaml, grafanaSvg, baseName);
        const requestId = createRequestId();
        const files = await requestGrafanaBundleExport(postMessage, {
          requestId,
          baseName,
          svgContent: grafanaSvg,
          dashboardJson,
          panelYaml
        });

        const suffix =
          files.length > 0 ? ` (${files.map((file) => file.split('/').pop()).join(', ')})` : '';
        setExportStatus({
          type: 'success',
          message: `Grafana bundle exported successfully${suffix}`
        });
        setShowExportPopup(false);
      } catch (error: unknown) {
        setExportStatus({
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        });
      } finally {
        setIsExporting(false);
      }
    };
    void doExport();
  }, [
    borderPadding,
    borderZoom,
    effectiveInterfaceLabelOverrides,
    excludeNodesWithoutLinks,
    exportBgColor,
    exportBgTransparent,
    exportGrafanaBundle,
    grafanaInterfaceSizePercent,
    grafanaNodeSizePx,
    includeEdgeLabels,
    includeGrafanaLegend,
    includeHideRatesLegendToggle,
    postMessage,
    selectedNamespace,
    trafficRatesOnHoverOnly,
    trafficThresholdUnit,
    trafficThresholds
  ]);

  const updateTrafficThreshold = useCallback(
    (threshold: keyof GrafanaTrafficThresholds, rawValue: string) => {
      const nextValue = parseThreshold(rawValue, trafficThresholdUnit);
      setTrafficThresholds((prev) => ({
        ...prev,
        [threshold]: nextValue
      }));
    },
    [trafficThresholdUnit]
  );

  const updateInterfaceOverride = useCallback((endpoint: string, selectedValue: string) => {
    const override = resolveInterfaceOverrideValue(endpoint, selectedValue);
    setInterfaceLabelOverrides((prev) => {
      if (override === null) {
        if (!(endpoint in prev)) return prev;
        const next = { ...prev };
        delete next[endpoint];
        return next;
      }
      if (prev[endpoint] === override) return prev;
      return { ...prev, [endpoint]: override };
    });
  }, []);

  const handleSaveLayout = useCallback(() => {
    if (saveDisabled) {
      return;
    }

    const liveVisiblePositions = normalizeNodePositionMap(topologyRef.current?.getDeviceNodePositions());
    const positions = normalizeNodePositionMap({ ...currentPositions, ...liveVisiblePositions });

    setCurrentPositions(positions);
    setIsSavingLayout(true);
    setSaveStatus(null);

    postMessage({
      command: 'saveTopologyPositions',
      namespace: selectedNamespace,
      positions
    });
  }, [currentPositions, postMessage, saveDisabled, selectedNamespace]);

  let exportButtonLabel = 'Export SVG';
  if (isExporting) {
    exportButtonLabel = 'Exporting...';
  } else if (exportGrafanaBundle) {
    exportButtonLabel = 'Export Grafana Bundle';
  }

  return (
    <div className="dashboard" style={topologyCssVars}>
      <div className="header">
        <button className="export-btn" onClick={handleSaveLayout} disabled={saveDisabled}>
          {isSavingLayout ? 'Saving...' : 'Save Layout'}
        </button>
        <button className="export-btn" onClick={showExportPopupWithDefaults}>
          Export SVG
        </button>
        <span className="namespace-value">Namespace: {selectedNamespace}</span>
        {saveStatus && (
          <span className={`save-status ${saveStatus.level}`}>
            {saveStatus.text}
          </span>
        )}
        <select
          className="label-select"
          value={labelMode}
          onChange={e => setLabelMode(e.target.value as 'hide' | 'show' | 'select')}
          title="Edge interface labels"
        >
          <option value="hide">Hide Labels</option>
          <option value="show">Show Labels</option>
          <option value="select">Show on Select</option>
        </select>
        <select
          className="label-select"
          value={selectedNodeLabelFilter}
          onChange={e => setSelectedNodeLabelFilter(e.target.value)}
          title="Filter rendered nodes by metadata label (key=value)"
        >
          {nodeLabelFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="body">
        <div className="topology-container">
          <TopologyFlow
            ref={topologyRef}
            nodes={visibleNodes}
            edges={visibleEdges}
            onNodeSelect={handleNodeSelect}
            onEdgeSelect={handleEdgeSelect}
            onNodeDoubleClick={handleNodeDoubleClick}
            onBackgroundClick={handleBackgroundClick}
            colorMode={colorMode}
            labelMode={labelMode}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onDevicePositionsChange={handleDevicePositionsChange}
          />
        </div>
        <div className="info-card">
          {infoCard.type === 'empty' && <span>Select a node or link</span>}
          {infoCard.type === 'node' && (
            <InfoCardNode
              info={infoCard.info}
              raw={infoCard.raw}
              onSsh={handleSshToNode}
              onOpenResource={handleOpenResource}
            />
          )}
          {infoCard.type === 'edge' && (
            <InfoCardEdge
              info={infoCard.info}
              rawResource={infoCard.rawResource}
              onOpenResource={handleOpenResource}
            />
          )}
        </div>
      </div>
      {showExportPopup && (
        <div className="export-popup">
          <div className="export-popup-content export-popup-large">
            <h3>Export SVG</h3>

            <div className="export-section">
              <h4>Quality & Size</h4>
              <div className="export-grid-two">
                <label>
                  Zoom (%)
                  <input
                    type="number"
                    min={10}
                    max={300}
                    step={1}
                    value={borderZoom}
                    onChange={e => setBorderZoom(Math.max(10, Math.min(300, parseFloat(e.target.value) || 0)))}
                  />
                </label>
                <label>
                  Padding (px)
                  <input
                    type="number"
                    min={0}
                    max={500}
                    step={1}
                    value={borderPadding}
                    onChange={e => setBorderPadding(Math.max(0, parseFloat(e.target.value) || 0))}
                  />
                </label>
              </div>
            </div>

            <div className="export-section">
              <h4>Background</h4>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={exportBgTransparent}
                  onChange={e => setExportBgTransparent(e.target.checked)}
                />
                Transparent Background
              </label>
              <label>
                Background Color
                <input
                  type="color"
                  value={exportBgColor}
                  onChange={e => setExportBgColor(e.target.value)}
                  disabled={exportBgTransparent}
                />
              </label>
            </div>

            <div className="export-section">
              <h4>Include</h4>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={includeEdgeLabels}
                  onChange={e => setIncludeEdgeLabels(e.target.checked)}
                />
                Edge labels
              </label>
              <div className="export-inline-controls">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={exportGrafanaBundle}
                    onChange={e => setExportGrafanaBundle(e.target.checked)}
                  />
                  Grafana bundle
                </label>
                <button
                  className="export-btn"
                  disabled={!exportGrafanaBundle}
                  onClick={() => setIsGrafanaSettingsOpen(true)}
                >
                  Advanced Grafana Settings
                </button>
              </div>
            </div>

            {exportStatus && (
              <div className={`export-status ${exportStatus.type}`}>
                {exportStatus.message}
              </div>
            )}

              <div className="export-popup-buttons">
                <button className="export-btn" onClick={handleExport} disabled={isExporting}>
                  {exportButtonLabel}
                </button>
              <button className="export-btn cancel" onClick={() => setShowExportPopup(false)} disabled={isExporting}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {isGrafanaSettingsOpen && (
        <div className="export-popup">
          <div className="export-popup-content export-popup-large">
            <h3>Advanced Grafana Settings</h3>
            <div className="export-tab-row">
              <button
                className={`export-tab ${grafanaSettingsTab === 'general' ? 'active' : ''}`}
                onClick={() => setGrafanaSettingsTab(parseGrafanaSettingsTab('general'))}
              >
                General
              </button>
              <button
                className={`export-tab ${grafanaSettingsTab === 'interface-names' ? 'active' : ''}`}
                onClick={() => setGrafanaSettingsTab(parseGrafanaSettingsTab('interface-names'))}
              >
                Interface Names
              </button>
            </div>

            {grafanaSettingsTab === 'general' && (
              <div className="export-section">
                <p className="export-help-text">
                  Configure thresholds and topology sizing used in the exported Grafana panel.
                </p>
                <div className="export-grid-two">
                  <label>
                    Node size (px)
                    <input
                      type="number"
                      min={12}
                      max={240}
                      step={1}
                      value={grafanaNodeSizePx}
                      onChange={e => setGrafanaNodeSizePx(
                        parseBoundedNumber(e.target.value, 12, 240, DEFAULT_GRAFANA_NODE_SIZE_PX)
                      )}
                    />
                  </label>
                  <label>
                    Interface size (%)
                    <input
                      type="number"
                      min={40}
                      max={400}
                      step={5}
                      value={grafanaInterfaceSizePercent}
                      onChange={e => setGrafanaInterfaceSizePercent(
                        parseBoundedNumber(e.target.value, 40, 400, DEFAULT_GRAFANA_INTERFACE_SIZE_PERCENT)
                      )}
                    />
                  </label>
                </div>
                <label>
                  Traffic threshold unit
                  <select
                    value={trafficThresholdUnit}
                    onChange={e => setTrafficThresholdUnit(parseTrafficThresholdUnit(e.target.value))}
                  >
                    <option value="kbit">kbit/s</option>
                    <option value="mbit">Mbit/s</option>
                    <option value="gbit">Gbit/s</option>
                  </select>
                </label>
                <div className="export-grid-two">
                  <label>
                    Green threshold
                    <input
                      type="number"
                      min={0}
                      step={getThresholdUnitStep(trafficThresholdUnit)}
                      value={formatThresholdForUnit(trafficThresholds.green, trafficThresholdUnit)}
                      onChange={e => updateTrafficThreshold('green', e.target.value)}
                    />
                  </label>
                  <label>
                    Yellow threshold
                    <input
                      type="number"
                      min={0}
                      step={getThresholdUnitStep(trafficThresholdUnit)}
                      value={formatThresholdForUnit(trafficThresholds.yellow, trafficThresholdUnit)}
                      onChange={e => updateTrafficThreshold('yellow', e.target.value)}
                    />
                  </label>
                  <label>
                    Orange threshold
                    <input
                      type="number"
                      min={0}
                      step={getThresholdUnitStep(trafficThresholdUnit)}
                      value={formatThresholdForUnit(trafficThresholds.orange, trafficThresholdUnit)}
                      onChange={e => updateTrafficThreshold('orange', e.target.value)}
                    />
                  </label>
                  <label>
                    Red threshold
                    <input
                      type="number"
                      min={0}
                      step={getThresholdUnitStep(trafficThresholdUnit)}
                      value={formatThresholdForUnit(trafficThresholds.red, trafficThresholdUnit)}
                      onChange={e => updateTrafficThreshold('red', e.target.value)}
                    />
                  </label>
                </div>
                <p className="export-help-text">
                  Values must be strictly ascending: green {'<'} yellow {'<'} orange {'<'} red.
                </p>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={excludeNodesWithoutLinks}
                    onChange={e => setExcludeNodesWithoutLinks(e.target.checked)}
                  />
                  Exclude nodes without any links
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeGrafanaLegend}
                    onChange={e => setIncludeGrafanaLegend(e.target.checked)}
                  />
                  Add traffic legend (top-left)
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={trafficRatesOnHoverOnly}
                    onChange={e => setTrafficRatesOnHoverOnly(e.target.checked)}
                  />
                  Show traffic rates on hover only
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeHideRatesLegendToggle}
                    onChange={e => setIncludeHideRatesLegendToggle(e.target.checked)}
                  />
                  Add hide-rates legend toggle for rate labels
                </label>
              </div>
            )}

            {grafanaSettingsTab === 'interface-names' && (
              <div className="export-section">
                <p className="export-help-text">
                  Filter links and choose which interface segment should be shown in endpoint labels.
                </p>
                <label>
                  Global override (all interfaces)
                  <select
                    value={globalInterfaceOverrideSelection}
                    onChange={e => setGlobalInterfaceOverrideSelection(e.target.value)}
                  >
                    <option value={INTERFACE_SELECT_AUTO}>Auto</option>
                    <option value={INTERFACE_SELECT_FULL}>Full interface name</option>
                    {Array.from({ length: maxInterfacePartCount }, (_, index) => index + 1).map(
                      (partIndex) => (
                        <option
                          key={`global-interface-part-${partIndex}`}
                          value={`${GLOBAL_INTERFACE_PART_INDEX_PREFIX}${partIndex}`}
                        >
                          Part {partIndex}
                        </option>
                      )
                    )}
                  </select>
                </label>
                <label>
                  Filter links
                  <input
                    type="text"
                    placeholder="Search node or interface name"
                    value={interfaceLinkFilter}
                    onChange={e => setInterfaceLinkFilter(e.target.value)}
                  />
                </label>
                <p className="export-help-text">
                  {filteredInterfaceRows.length} of {interfaceRows.length} links shown
                </p>
                <div className="interface-link-list">
                  {filteredInterfaceRows.length === 0 && (
                    <div className="export-help-text">No links match the current filter.</div>
                  )}
                  {filteredInterfaceRows.map((row) => {
                    const sourceParts = splitInterfaceParts(row.sourceEndpoint);
                    const targetParts = splitInterfaceParts(row.targetEndpoint);
                    return (
                      <div key={row.edgeId} className="interface-link-card">
                        <div className="interface-link-title">{row.source} &lt;-&gt; {row.target}</div>
                        <div className="export-grid-two">
                          <label>
                            {row.sourceEndpoint}
                            <select
                              value={getInterfaceSelectionValue(row.sourceEndpoint, interfaceLabelOverrides)}
                              onChange={e => updateInterfaceOverride(row.sourceEndpoint, e.target.value)}
                            >
                              <option value={INTERFACE_SELECT_AUTO}>Auto (use global)</option>
                              <option value={INTERFACE_SELECT_FULL}>Full: {row.sourceEndpoint}</option>
                              {sourceParts.map((part, idx) => (
                                <option
                                  key={`${row.edgeId}-source-${idx}-${part}`}
                                  value={`${INTERFACE_SELECT_TOKEN_PREFIX}${part}`}
                                >
                                  Part {idx + 1}: {part}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            {row.targetEndpoint}
                            <select
                              value={getInterfaceSelectionValue(row.targetEndpoint, interfaceLabelOverrides)}
                              onChange={e => updateInterfaceOverride(row.targetEndpoint, e.target.value)}
                            >
                              <option value={INTERFACE_SELECT_AUTO}>Auto (use global)</option>
                              <option value={INTERFACE_SELECT_FULL}>Full: {row.targetEndpoint}</option>
                              {targetParts.map((part, idx) => (
                                <option
                                  key={`${row.edgeId}-target-${idx}-${part}`}
                                  value={`${INTERFACE_SELECT_TOKEN_PREFIX}${part}`}
                                >
                                  Part {idx + 1}: {part}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="export-popup-buttons">
              <button className="export-btn" onClick={() => setIsGrafanaSettingsOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

mountWebview(TopologyFlowDashboard);
