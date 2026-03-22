/* eslint-disable max-lines */
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { ColorMode } from '@xyflow/react';
import { alpha, useTheme } from '@mui/material/styles';
import { Box, Chip, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, Tooltip } from '@mui/material';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SettingsIcon from '@mui/icons-material/Settings';

import { ALL_NAMESPACES } from '../../constants';
import { mountWebview } from '../../shared/utils';
import { usePostMessage, useMessageListener } from '../../shared/hooks';

import TopologyFlow, {
  type TopologyNode,
  type TopologyEdge,
  type FlowNode,
  type TopologyFlowRef,
  type TopologyTelemetryRateLabelSelection,
  type TopologyTelemetryRateLabelTransform
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
import { NODE_ICON_OPTIONS, getNodeIconByKey, resolveNodeIconKey, type NodeIconKey } from './nodes/icons';

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
  sourceOutBps?: number;
  targetOutBps?: number;
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

interface RateLabelInfo {
  edgeId: string;
  edgeResourceName?: string;
  key: 'source' | 'target';
  sourceNodeId: string;
  sourceNode: string;
  targetNodeId: string;
  targetNode: string;
  endpoint: string;
  peerEndpoint: string;
  rateValue: string;
  rotationDeg: number;
  offsetX: number;
  offsetY: number;
}

interface NodeAppearanceOverride {
  iconKey?: string;
  iconColor?: string;
}

interface NodeIconEditorState {
  nodeId: string;
  iconKey: NodeIconKey;
  iconColor: string;
  useThemeColor: boolean;
}

// Info card state types
type InfoCardState =
  | { type: 'empty' }
  | { type: 'node'; nodeId: string; info: NodeInfo; raw: unknown }
  | { type: 'edge'; info: EdgeInfo; raw: unknown; rawResource: unknown }
  | { type: 'rateLabel'; info: RateLabelInfo };

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

function normalizeFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatTelemetryOutBpsLabel(value: unknown): string {
  const numeric = normalizeFiniteNumber(value);
  if (numeric === null || numeric < 0) {
    return 'n/a';
  }

  const units = ['b/s', 'Kb/s', 'Mb/s', 'Gb/s', 'Tb/s'];
  let unitIndex = 0;
  let scaled = numeric;
  while (scaled >= 1000 && unitIndex < units.length - 1) {
    scaled /= 1000;
    unitIndex += 1;
  }

  let decimals = 2;
  if (scaled >= 100) {
    decimals = 0;
  } else if (scaled >= 10) {
    decimals = 1;
  }
  const formatted = Number(scaled.toFixed(decimals));
  return `${formatted} ${units[unitIndex]}`;
}

function normalizeHexColor(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : undefined;
}

function buildRateLabelInfo(
  edge: TopologyEdge,
  selection: TopologyTelemetryRateLabelSelection,
  transform: TopologyTelemetryRateLabelTransform
): RateLabelInfo {
  const isSource = selection.key === 'source';
  const endpoint = isSource
    ? (edge.data?.sourceEndpoint ?? edge.data?.sourceInterface ?? 'n/a')
    : (edge.data?.targetEndpoint ?? edge.data?.targetInterface ?? 'n/a');
  const peerEndpoint = isSource
    ? (edge.data?.targetEndpoint ?? edge.data?.targetInterface ?? 'n/a')
    : (edge.data?.sourceEndpoint ?? edge.data?.sourceInterface ?? 'n/a');
  const rateRaw = isSource ? edge.data?.sourceOutBps : edge.data?.targetOutBps;
  const sourceNodeId = edge.source;
  const targetNodeId = edge.target;
  const sourceNode = topologyNodeIdToName(sourceNodeId);
  const targetNode = topologyNodeIdToName(targetNodeId);
  const rawResource = edge.data?.rawResource as { metadata?: { name?: unknown } } | undefined;
  const edgeResourceName = typeof rawResource?.metadata?.name === 'string'
    ? rawResource.metadata.name
    : undefined;

  return {
    edgeId: edge.id,
    edgeResourceName,
    key: selection.key,
    sourceNodeId,
    sourceNode,
    targetNodeId,
    targetNode,
    endpoint,
    peerEndpoint,
    rateValue: formatTelemetryOutBpsLabel(rateRaw),
    rotationDeg: transform.rotationDeg,
    offsetX: transform.offset.x,
    offsetY: transform.offset.y
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
  onEditIcon,
  onSsh,
  onOpenResource
}: Readonly<{
  info: NodeInfo;
  raw: unknown;
  onEditIcon: () => void;
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
      <button
        type="button"
        className="info-card-link-button"
        onClick={onEditIcon}
      >
        <EditOutlinedIcon fontSize="inherit" />
        Edit Icon
      </button>
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

function InfoCardRateLabel({
  info,
  onRotateBy,
  onSetRotation,
  onResetRotation
}: Readonly<{
  info: RateLabelInfo;
  onRotateBy: (deltaDeg: number) => void;
  onSetRotation: (nextRotationDeg: number) => void;
  onResetRotation: () => void;
}>) {
  const selectedNode = info.key === 'source' ? info.sourceNode : info.targetNode;

  return (
    <>
      <h3>
        Traffic Rate
      </h3>
      <p className="rate-label-summary">
        Traffic out on interface <strong>{info.endpoint}</strong>
      </p>
      <table>
        <tbody>
          <InfoRow label="Node" value={selectedNode} />
          <InfoRow label="Rate" value={info.rateValue} />
          <InfoRow label="Offset X" value={info.offsetX.toFixed(1)} />
          <InfoRow label="Offset Y" value={info.offsetY.toFixed(1)} />
        </tbody>
      </table>
      <div className="info-card-controls rate-label-controls">
        <label>
          Rotation (deg)
          <input
            type="number"
            step={1}
            value={Number(info.rotationDeg.toFixed(1))}
            onChange={(event) => onSetRotation(Number.parseFloat(event.target.value) || 0)}
          />
        </label>
        <div className="info-card-button-row">
          <button className="export-btn" onClick={() => onRotateBy(-15)}>
            -15
          </button>
          <button className="export-btn" onClick={() => onRotateBy(15)}>
            +15
          </button>
          <button className="export-btn cancel" onClick={onResetRotation}>
            Reset
          </button>
        </div>
      </div>
    </>
  );
}

// Layout constants
const SPACING_X = 180;
const SPACING_Y = 200;
const NAMESPACE_GAP = 20;
const LAYOUT_NODE_WIDTH = 80;
const LABEL_OFFSET_Y = -60;
const DEFAULT_NODE_ICON_EDITOR_COLOR = '#ffffff';
const DEFAULT_GRAFANA_NODE_SIZE_PX = 80;
const DEFAULT_GRAFANA_INTERFACE_SIZE_PERCENT = 100;
const INTERFACE_SELECT_AUTO = '__auto__';
const INTERFACE_SELECT_FULL = '__full__';
const INTERFACE_SELECT_TOKEN_PREFIX = '__token__:';
const GLOBAL_INTERFACE_PART_INDEX_PREFIX = '__part-index__:';
const EXPORT_REQUEST_TIMEOUT_MS = 30_000;
const NODE_LABEL_FILTER_ALL = '__all__';
const NODE_ICON_OPTION_BY_VALUE = new Map(
  NODE_ICON_OPTIONS.map((option) => [option.value, option] as const)
);

type TrafficThresholdUnit = 'kbit' | 'mbit' | 'gbit';
type GrafanaSettingsTab = 'general' | 'interface-names';
type AppearanceMode = 'default' | 'telemetry';

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

function parseAppearanceMode(value: unknown): AppearanceMode {
  return value === 'telemetry' ? 'telemetry' : 'default';
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

function getPersistedPositionForNodeId(nodeId: string, positions: NodePositionMap): { x: number; y: number } | undefined {
  const byId = positions[nodeId];
  if (byId) {
    return byId;
  }
  const nodeName = topologyNodeIdToName(nodeId);
  return positions[nodeName];
}

function canonicalizePositionMapForNodeIds(positions: NodePositionMap, nodeIds: string[]): NodePositionMap {
  const normalized = normalizeNodePositionMap(positions);
  if (Object.keys(normalized).length === 0 || nodeIds.length === 0) {
    return normalized;
  }

  const knownIds = new Set(nodeIds);
  const idsByName = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    const nodeName = topologyNodeIdToName(nodeId);
    const existing = idsByName.get(nodeName);
    if (existing) {
      existing.push(nodeId);
    } else {
      idsByName.set(nodeName, [nodeId]);
    }
  }

  const canonical: NodePositionMap = {};
  for (const [key, position] of Object.entries(normalized)) {
    if (knownIds.has(key)) {
      canonical[key] = position;
      continue;
    }

    const nameMatches = idsByName.get(key);
    if (nameMatches && nameMatches.length === 1) {
      canonical[nameMatches[0]] = position;
    }
  }

  return normalizeNodePositionMap(canonical);
}

function extractDeviceNodePositions(flowNodes: FlowNode[]): NodePositionMap {
  const positions: NodePositionMap = {};
  for (const node of flowNodes) {
    if (node.type !== 'deviceNode') {
      continue;
    }
    positions[node.id] = { x: node.position.x, y: node.position.y };
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
  const [selectedTelemetryRateLabel, setSelectedTelemetryRateLabel] =
    useState<TopologyTelemetryRateLabelSelection | null>(null);
  const [infoCard, setInfoCard] = useState<InfoCardState>({ type: 'empty' });
  const [nodeAppearanceOverrides, setNodeAppearanceOverrides] = useState<Record<string, NodeAppearanceOverride>>({});
  const [nodeIconEditor, setNodeIconEditor] = useState<NodeIconEditorState | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('system');
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>('default');
  const [showAppearancePopup, setShowAppearancePopup] = useState(false);
  const [telemetryNodeSizePx, setTelemetryNodeSizePx] = useState(DEFAULT_GRAFANA_NODE_SIZE_PX);
  const [telemetryInterfaceSizePercent, setTelemetryInterfaceSizePercent] = useState(DEFAULT_GRAFANA_INTERFACE_SIZE_PERCENT);

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
      const nsDefaultWidth = Math.max(100, ...sortedTiers.map(t => (tiers[Number(t)].length - 1) * SPACING_X));
      const namespaceNodes: Array<{ node: BackendNode; position: { x: number; y: number } }> = [];

      for (let tierIndex = 0; tierIndex < sortedTiers.length; tierIndex++) {
        const tierNodes = tiers[Number(sortedTiers[tierIndex])];
        const tierWidth = (tierNodes.length - 1) * SPACING_X;
        const tierXOffset = (nsDefaultWidth - tierWidth) / 2;

        for (let idx = 0; idx < tierNodes.length; idx++) {
          const node = tierNodes[idx];
          const persisted = getPersistedPositionForNodeId(node.id, persistedPositions);
          namespaceNodes.push({
            node,
            position: persisted ?? { x: tierXOffset + idx * SPACING_X, y: tierIndex * SPACING_Y }
          });
        }
      }

      const xCoordinates = namespaceNodes.map((entry) => entry.position.x);
      const namespaceContentMinX = xCoordinates.length > 0 ? Math.min(...xCoordinates) : 0;
      const namespaceContentMaxX = xCoordinates.length > 0 ? Math.max(...xCoordinates) : nsDefaultWidth;
      const namespaceXShift = hasMultipleNamespaces
        ? currentXOffset - namespaceContentMinX
        : 0;
      const namespacePlacedMinX = namespaceContentMinX + namespaceXShift;
      const namespacePlacedMaxX = namespaceContentMaxX + namespaceXShift + LAYOUT_NODE_WIDTH;
      const namespaceLabelX = (namespacePlacedMinX + namespacePlacedMaxX) / 2;

      if (hasMultipleNamespaces) {
        result.push({
          id: `ns-label-${ns}`,
          type: 'namespaceLabel',
          position: { x: namespaceLabelX, y: LABEL_OFFSET_Y },
          data: { label: ns },
          selectable: false,
          draggable: false
        });
      }

      for (const { node, position } of namespaceNodes) {
        result.push({
          id: node.id,
          type: 'deviceNode',
          position: { x: position.x + namespaceXShift, y: position.y },
          data: { label: node.label, tier: node.tier ?? 1, role: node.role, namespace: ns, raw: node.raw }
        });
      }

      if (hasMultipleNamespaces) {
        currentXOffset = namespacePlacedMaxX + NAMESPACE_GAP;
      }
    }

    return result;
  }, []);

  // Process edges with pair indices and totals
  const processEdges = useCallback((backendEdges: BackendEdge[]): TopologyEdge[] => {
    const normalizeIdPart = (value: string | undefined): string => {
      const trimmed = value?.trim();
      return trimmed != null && trimmed.length > 0 ? encodeURIComponent(trimmed) : 'na';
    };

    const getRawResourceName = (edge: BackendEdge): string | undefined => {
      if (!edge.rawResource || typeof edge.rawResource !== 'object') {
        return undefined;
      }
      const metadata = (edge.rawResource as { metadata?: { name?: unknown } }).metadata;
      const name = metadata?.name;
      if (typeof name !== 'string') {
        return undefined;
      }
      const trimmed = name.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };

    const buildEndpointSignature = (
      node: string | undefined,
      endpoint: string | undefined,
      iface: string | undefined
    ): string => [
      normalizeIdPart(node),
      normalizeIdPart(endpoint),
      normalizeIdPart(iface)
    ].join('::');

    const buildStableEdgeKey = (edge: BackendEdge): string => {
      const sourceSignature = buildEndpointSignature(edge.source, edge.sourceEndpoint, edge.sourceInterface);
      const targetSignature = buildEndpointSignature(edge.target, edge.targetEndpoint, edge.targetInterface);
      const [first, second] = sourceSignature.localeCompare(targetSignature) <= 0
        ? [sourceSignature, targetSignature]
        : [targetSignature, sourceSignature];
      return [
        normalizeIdPart(getRawResourceName(edge)),
        first,
        second
      ].join('--');
    };

    const buildOrientedEdgeKey = (edge: BackendEdge): string => {
      const sourceSignature = buildEndpointSignature(edge.source, edge.sourceEndpoint, edge.sourceInterface);
      const targetSignature = buildEndpointSignature(edge.target, edge.targetEndpoint, edge.targetInterface);
      return `${sourceSignature}->${targetSignature}`;
    };

    const edgeMeta = backendEdges.map((edge, originalIndex) => ({
      edge,
      originalIndex,
      pairKey: [edge.source, edge.target].sort().join('|'),
      stableKey: buildStableEdgeKey(edge),
      orientedKey: buildOrientedEdgeKey(edge)
    }));

    const bucketsByPair = new Map<string, typeof edgeMeta>();
    for (const meta of edgeMeta) {
      const bucket = bucketsByPair.get(meta.pairKey) ?? [];
      bucket.push(meta);
      bucketsByPair.set(meta.pairKey, bucket);
    }

    const assignments = new Array<{
      id: string;
      pairIndex: number;
      totalInPair: number;
    }>(backendEdges.length);

    for (const bucket of bucketsByPair.values()) {
      bucket.sort((a, b) => {
        const byStableKey = a.stableKey.localeCompare(b.stableKey);
        if (byStableKey !== 0) return byStableKey;
        const byOrientedKey = a.orientedKey.localeCompare(b.orientedKey);
        if (byOrientedKey !== 0) return byOrientedKey;
        return a.originalIndex - b.originalIndex;
      });

      const totalInPair = bucket.length;
      const duplicateCounts = new Map<string, number>();
      for (let idx = 0; idx < bucket.length; idx++) {
        const entry = bucket[idx];
        const duplicateIndex = duplicateCounts.get(entry.stableKey) ?? 0;
        duplicateCounts.set(entry.stableKey, duplicateIndex + 1);
        const duplicateSuffix = duplicateIndex > 0 ? `--dup${duplicateIndex}` : '';
        assignments[entry.originalIndex] = {
          id: `edge--${entry.stableKey}${duplicateSuffix}`,
          pairIndex: idx,
          totalInPair
        };
      }
    }

    return backendEdges.map((edge, originalIndex) => {
      const assignment = assignments[originalIndex] ?? {
        id: `edge--fallback--${originalIndex}`,
        pairIndex: 0,
        totalInPair: 1
      };

      return {
        id: assignment.id,
        source: edge.source,
        target: edge.target,
        type: 'linkEdge',
        data: {
          sourceInterface: edge.sourceInterface,
          targetInterface: edge.targetInterface,
          sourceEndpoint: edge.sourceEndpoint,
          targetEndpoint: edge.targetEndpoint,
          state: edge.state,
          sourceState: edge.sourceState,
          targetState: edge.targetState,
          sourceOutBps: edge.sourceOutBps,
          targetOutBps: edge.targetOutBps,
          pairIndex: assignment.pairIndex,
          totalInPair: assignment.totalInPair,
          raw: edge.raw,
          rawResource: edge.rawResource
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
  const deviceNodesById = useMemo(() => {
    const lookup = new Map<string, TopologyNode>();
    for (const node of allNodes) {
      if (node.type === 'deviceNode') {
        lookup.set(node.id, node);
      }
    }
    return lookup;
  }, [allNodes]);
  const deviceNodeIds = useMemo(() => Array.from(deviceNodesById.keys()), [deviceNodesById]);
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
        const appearanceOverride = nodeAppearanceOverrides[node.id];
        const normalizedIconColor = normalizeHexColor(appearanceOverride?.iconColor);
        const mergedData = {
          ...node.data,
          iconKey: appearanceOverride?.iconKey,
          iconColor: normalizedIconColor
        };
        const nodeName = topologyNodeIdToName(node.id);
        const position = currentPositions[node.id] ?? currentPositions[nodeName];
        if (position) {
          nodes.push({
            ...node,
            position: { x: position.x, y: position.y },
            data: mergedData
          });
        } else {
          nodes.push({
            ...node,
            data: mergedData
          });
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
  }, [allNodes, currentPositions, nodeAppearanceOverrides, visibleNodeIds]);
  const visibleEdges = useMemo(
    () => allEdges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [allEdges, visibleNodeIds]
  );
  const buildTelemetryRateLabelInfo = useCallback((
    selection: TopologyTelemetryRateLabelSelection
  ): RateLabelInfo | null => {
    const edge = visibleEdges.find((candidate) => candidate.id === selection.edgeId);
    if (!edge || !topologyRef.current) {
      return null;
    }
    const transform = topologyRef.current.getTelemetryRateLabelTransform(selection.edgeId, selection.key);
    return buildRateLabelInfo(edge, selection, transform);
  }, [visibleEdges]);

  const updateTelemetryRateLabelInfoCard = useCallback((selection: TopologyTelemetryRateLabelSelection) => {
    const info = buildTelemetryRateLabelInfo(selection);
    if (info) {
      setInfoCard({ type: 'rateLabel', info });
    }
  }, [buildTelemetryRateLabelInfo]);
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
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setSelectedTelemetryRateLabel(null);
      setInfoCard({ type: 'empty' });
      setNodeIconEditor(null);
      setCurrentPositions({});
      setSavedPositions({});
    } else if (msg.command === 'data') {
      const backendNodes = msg.nodes ?? [];
      const normalizedSavedPositions = normalizeNodePositionMap(msg.savedPositions);
      const knownNodeIds = backendNodes.map((node) => node.id);
      const canonicalSavedPositions = canonicalizePositionMapForNodeIds(normalizedSavedPositions, knownNodeIds);
      const layoutedNodes = layoutByTier(backendNodes, canonicalSavedPositions);
      const processedEdges = processEdges(msg.edges ?? []);
      const baselinePositions = extractDeviceNodePositions(layoutedNodes);
      setAllNodes(layoutedNodes);
      setAllEdges(processedEdges);
      setSavedPositions(baselinePositions);
      setCurrentPositions(baselinePositions);
    } else if (msg.command === 'saveTopologyPositionsResult') {
      setIsSavingLayout(false);
      if (msg.ok) {
        const normalizedSavedPositions = normalizeNodePositionMap(msg.positions ?? currentPositions);
        const canonicalSavedPositions = canonicalizePositionMapForNodeIds(normalizedSavedPositions, deviceNodeIds);
        const nextSavedPositions = Object.keys(canonicalSavedPositions).length > 0
          ? canonicalSavedPositions
          : normalizedSavedPositions;
        setSavedPositions(nextSavedPositions);
        setCurrentPositions(nextSavedPositions);
        setSaveStatus({ level: 'success', text: msg.message ?? 'Layout saved.' });
      } else {
        setSaveStatus({ level: 'error', text: msg.message ?? 'Failed to save layout.' });
      }
    }
  }, [currentPositions, deviceNodeIds, layoutByTier, processEdges]));

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
    const validNodeIds = new Set(deviceNodesById.keys());
    setNodeAppearanceOverrides((previous) => {
      let changed = false;
      const next: Record<string, NodeAppearanceOverride> = {};
      for (const [nodeId, value] of Object.entries(previous)) {
        if (!validNodeIds.has(nodeId)) {
          changed = true;
          continue;
        }
        next[nodeId] = value;
      }
      return changed ? next : previous;
    });

    setNodeIconEditor((previous) => {
      if (!previous) {
        return previous;
      }
      return validNodeIds.has(previous.nodeId) ? previous : null;
    });
  }, [deviceNodesById]);

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

  useEffect(() => {
    if (!selectedTelemetryRateLabel) {
      return;
    }
    if (appearanceMode !== 'telemetry') {
      setSelectedTelemetryRateLabel(null);
      setInfoCard({ type: 'empty' });
      return;
    }
    const edgeExists = visibleEdges.some((edge) => edge.id === selectedTelemetryRateLabel.edgeId);
    if (!edgeExists) {
      setSelectedTelemetryRateLabel(null);
      setInfoCard({ type: 'empty' });
    }
  }, [appearanceMode, selectedTelemetryRateLabel, visibleEdges]);

  useEffect(() => {
    if (!selectedTelemetryRateLabel) {
      return;
    }
    updateTelemetryRateLabelInfoCard(selectedTelemetryRateLabel);
  }, [selectedTelemetryRateLabel, updateTelemetryRateLabelInfoCard]);

  // Handle node selection
  const handleNodeSelect = useCallback((node: TopologyNode) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setSelectedTelemetryRateLabel(null);
    setNodeIconEditor(null);

    const info = extractNodeInfo(node.data.raw);
    if (info) {
      setInfoCard({ type: 'node', nodeId: node.id, info, raw: node.data.raw });
    }
  }, []);

  // Handle edge selection
  const handleEdgeSelect = useCallback((edge: TopologyEdge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    setSelectedTelemetryRateLabel(null);
    setNodeIconEditor(null);

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
    setSelectedTelemetryRateLabel(null);
    setNodeIconEditor(null);
    setInfoCard({ type: 'empty' });
  }, []);

  const handleTelemetryRateLabelSelect = useCallback((
    selection: TopologyTelemetryRateLabelSelection | null
  ) => {
    if (!selection) {
      setSelectedTelemetryRateLabel(null);
      setSelectedEdgeId(null);
      setInfoCard({ type: 'empty' });
      return;
    }

    setSelectedTelemetryRateLabel(selection);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    updateTelemetryRateLabelInfoCard(selection);
  }, [updateTelemetryRateLabelInfoCard]);

  const handleTelemetryRateLabelTransformChange = useCallback((
    selection: TopologyTelemetryRateLabelSelection,
    transform: TopologyTelemetryRateLabelTransform
  ) => {
    setInfoCard((previous) => {
      if (previous.type !== 'rateLabel') {
        return previous;
      }
      if (previous.info.edgeId !== selection.edgeId || previous.info.key !== selection.key) {
        return previous;
      }
      if (
        previous.info.rotationDeg === transform.rotationDeg
        && previous.info.offsetX === transform.offset.x
        && previous.info.offsetY === transform.offset.y
      ) {
        return previous;
      }
      return {
        type: 'rateLabel',
        info: {
          ...previous.info,
          rotationDeg: transform.rotationDeg,
          offsetX: transform.offset.x,
          offsetY: transform.offset.y
        }
      };
    });
  }, []);

  const setSelectedTelemetryRateLabelRotation = useCallback((nextRotationDeg: number) => {
    if (!selectedTelemetryRateLabel || !topologyRef.current) {
      return;
    }
    topologyRef.current.setTelemetryRateLabelRotation(
      selectedTelemetryRateLabel.edgeId,
      selectedTelemetryRateLabel.key,
      nextRotationDeg
    );
    updateTelemetryRateLabelInfoCard(selectedTelemetryRateLabel);
  }, [selectedTelemetryRateLabel, updateTelemetryRateLabelInfoCard]);

  const rotateSelectedTelemetryRateLabelBy = useCallback((deltaDeg: number) => {
    if (!selectedTelemetryRateLabel || !topologyRef.current) {
      return;
    }
    const currentTransform = topologyRef.current.getTelemetryRateLabelTransform(
      selectedTelemetryRateLabel.edgeId,
      selectedTelemetryRateLabel.key
    );
    topologyRef.current.setTelemetryRateLabelRotation(
      selectedTelemetryRateLabel.edgeId,
      selectedTelemetryRateLabel.key,
      currentTransform.rotationDeg + deltaDeg
    );
    updateTelemetryRateLabelInfoCard(selectedTelemetryRateLabel);
  }, [selectedTelemetryRateLabel, updateTelemetryRateLabelInfoCard]);

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

  const handleOpenNodeIconEditor = useCallback(() => {
    if (infoCard.type !== 'node') {
      return;
    }

    const node = deviceNodesById.get(infoCard.nodeId);
    if (!node) {
      return;
    }

    const appearanceOverride = nodeAppearanceOverrides[infoCard.nodeId];
    const iconColorOverride = normalizeHexColor(appearanceOverride?.iconColor);
    setNodeIconEditor({
      nodeId: infoCard.nodeId,
      iconKey: resolveNodeIconKey(
        appearanceOverride?.iconKey,
        typeof node.data.role === 'string' ? node.data.role : undefined
      ),
      iconColor: iconColorOverride ?? DEFAULT_NODE_ICON_EDITOR_COLOR,
      useThemeColor: iconColorOverride == null
    });
  }, [deviceNodesById, infoCard, nodeAppearanceOverrides]);

  const handleApplyNodeIconEditor = useCallback(() => {
    if (!nodeIconEditor) {
      return;
    }

    const node = deviceNodesById.get(nodeIconEditor.nodeId);
    if (!node) {
      setNodeIconEditor(null);
      return;
    }

    const role = typeof node.data.role === 'string' ? node.data.role : undefined;
    const roleDefaultIconKey = resolveNodeIconKey(undefined, role);
    const iconColor = nodeIconEditor.useThemeColor
      ? undefined
      : normalizeHexColor(nodeIconEditor.iconColor);
    const nextOverride: NodeAppearanceOverride = {};

    if (nodeIconEditor.iconKey !== roleDefaultIconKey) {
      nextOverride.iconKey = nodeIconEditor.iconKey;
    }
    if (iconColor) {
      nextOverride.iconColor = iconColor;
    }

    setNodeAppearanceOverrides((previous) => {
      const current = previous[nodeIconEditor.nodeId];
      if (Object.keys(nextOverride).length === 0) {
        if (!current) {
          return previous;
        }
        const next = { ...previous };
        delete next[nodeIconEditor.nodeId];
        return next;
      }

      if (current?.iconKey === nextOverride.iconKey && current?.iconColor === nextOverride.iconColor) {
        return previous;
      }
      return {
        ...previous,
        [nodeIconEditor.nodeId]: nextOverride
      };
    });
    setNodeIconEditor(null);
  }, [deviceNodesById, nodeIconEditor]);

  const handleResetNodeIconEditor = useCallback(() => {
    if (!nodeIconEditor) {
      return;
    }
    setNodeAppearanceOverrides((previous) => {
      if (!(nodeIconEditor.nodeId in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[nodeIconEditor.nodeId];
      return next;
    });
    setNodeIconEditor(null);
  }, [nodeIconEditor]);

  const handleDevicePositionsChange = useCallback((positions: NodePositionMap) => {
    const normalizedIncoming = normalizeNodePositionMap(positions);
    const canonicalIncoming = canonicalizePositionMapForNodeIds(normalizedIncoming, deviceNodeIds);
    const nextIncoming = Object.keys(canonicalIncoming).length > 0 ? canonicalIncoming : normalizedIncoming;
    setCurrentPositions((previous) => {
      const merged = normalizeNodePositionMap({ ...previous, ...nextIncoming });
      return nodePositionMapsEqual(previous, merged) ? previous : merged;
    });
  }, [deviceNodeIds]);

  // Show export popup with theme-appropriate defaults
  const showExportPopupWithDefaults = useCallback(() => {
    setExportBgColor(theme.vscode.topology.editorBackground);
    setExportStatus(null);
    setShowExportPopup(true);
  }, [theme.vscode.topology.editorBackground]);

  const buildGrafanaBundleArtifacts = useCallback(
    async () => {
      if (!topologyRef.current) {
        throw new Error('Topology view is not ready yet');
      }

      const exportOptions = {
        backgroundColor: exportBgColor,
        transparentBg: exportBgTransparent,
        includeLabels: includeEdgeLabels,
        zoomPercent: borderZoom,
        paddingPx: borderPadding,
        nodeSizePx: grafanaNodeSizePx,
        interfaceScale: grafanaInterfaceSizePercent / 100,
        interfaceLabelOverrides: effectiveInterfaceLabelOverrides,
        nodeProximateLabels: true
      } as const;

      const prepared = await topologyRef.current.buildSvgExport(exportOptions);
      if (!prepared) {
        throw new Error('SVG export is not yet available');
      }

      const mappings = collectGrafanaEdgeCellMappings(prepared.edges, prepared.nodes, new Set<string>());
      let grafanaSvg = sanitizeSvgForGrafana(prepared.svgContent);
      if (excludeNodesWithoutLinks) {
        const linkedNodeIds = collectLinkedNodeIds(prepared.edges, prepared.nodes, new Set<string>());
        grafanaSvg = removeUnlinkedNodesFromSvg(grafanaSvg, linkedNodeIds);
        grafanaSvg = trimGrafanaSvgToTopologyContent(grafanaSvg, Math.max(6, borderPadding));
      }
      const rateLabelOffsetsByEdge = appearanceMode === 'telemetry'
        ? topologyRef.current.getTelemetryRateLabelOffsets()
        : undefined;
      grafanaSvg = applyGrafanaCellIdsToSvg(grafanaSvg, mappings, {
        trafficRatesOnHoverOnly,
        rateLabelOffsetsByEdge
      });
      if (includeGrafanaLegend) {
        grafanaSvg = addGrafanaTrafficLegend(grafanaSvg, trafficThresholds, trafficThresholdUnit);
      }

      return { grafanaSvg, mappings };
    },
    [
      borderPadding,
      borderZoom,
      appearanceMode,
      effectiveInterfaceLabelOverrides,
      excludeNodesWithoutLinks,
      exportBgColor,
      exportBgTransparent,
      grafanaInterfaceSizePercent,
      grafanaNodeSizePx,
      includeEdgeLabels,
      includeGrafanaLegend,
      trafficRatesOnHoverOnly,
      trafficThresholdUnit,
      trafficThresholds
    ]
  );

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

        const { grafanaSvg: rawGrafanaSvg, mappings } = await buildGrafanaBundleArtifacts();
        const grafanaSvg = makeGrafanaSvgResponsive(rawGrafanaSvg);

        const panelYaml = buildGrafanaPanelYaml(mappings, {
          trafficThresholds,
          includeHideRatesLegendToggle
        });
        const baseName = sanitizeExportBaseName(
          selectedNamespace === ALL_NAMESPACES ? 'topology' : selectedNamespace
        );
        const grafanaQueryNamespace = selectedNamespace === ALL_NAMESPACES ? undefined : selectedNamespace;
        const dashboardJson = buildGrafanaDashboardJson(panelYaml, grafanaSvg, baseName, {
          namespaceName: grafanaQueryNamespace
        });
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
    buildGrafanaBundleArtifacts,
    borderPadding,
    borderZoom,
    effectiveInterfaceLabelOverrides,
    exportBgColor,
    exportBgTransparent,
    exportGrafanaBundle,
    grafanaInterfaceSizePercent,
    grafanaNodeSizePx,
    includeEdgeLabels,
    includeHideRatesLegendToggle,
    postMessage,
    selectedNamespace,
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
  let nodeIconEditorNodeName = '';
  if (nodeIconEditor != null) {
    if (infoCard.type === 'node' && infoCard.nodeId === nodeIconEditor.nodeId) {
      nodeIconEditorNodeName = infoCard.info.name;
    } else {
      nodeIconEditorNodeName = topologyNodeIdToName(nodeIconEditor.nodeId);
    }
  }

  return (
    <div className="dashboard" style={topologyCssVars}>
      <Box
        component="header"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.25,
          mb: 2,
          px: 1.5,
          py: 1,
          border: `1px solid ${alpha(theme.palette.divider, 0.85)}`,
          borderRadius: 1.5,
          backgroundColor: alpha(theme.palette.background.paper, 0.9),
          boxShadow: `0 6px 18px ${alpha(theme.palette.common.black, 0.15)}`,
          flexWrap: 'wrap'
        }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Tooltip title={isSavingLayout ? 'Saving layout...' : 'Save layout'}>
            <span>
              <IconButton
                size="small"
                color="primary"
                onClick={handleSaveLayout}
                disabled={saveDisabled}
                aria-label={isSavingLayout ? 'Saving layout' : 'Save layout'}
              >
                <SaveOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Export SVG">
            <IconButton
              size="small"
              color="primary"
              onClick={showExportPopupWithDefaults}
              aria-label="Export SVG"
            >
              <ImageOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Canvas appearance">
            <IconButton
              size="small"
              onClick={() => setShowAppearancePopup(true)}
              aria-label="Canvas appearance"
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Chip
            size="small"
            variant="outlined"
            label={`Namespace: ${selectedNamespace}`}
            sx={{ ml: 0.75, borderColor: alpha(theme.palette.divider, 0.9) }}
          />
          {saveStatus && (
            <Chip
              size="small"
              color={saveStatus.level === 'success' ? 'success' : 'error'}
              variant="outlined"
              label={saveStatus.text}
            />
          )}
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="edge-label-mode-select-label">Interface labels</InputLabel>
            <Select
              labelId="edge-label-mode-select-label"
              value={labelMode}
              label="Interface labels"
              onChange={(e) => setLabelMode(e.target.value as 'hide' | 'show' | 'select')}
            >
              <MenuItem value="hide">Hide Labels</MenuItem>
              <MenuItem value="show">Show Labels</MenuItem>
              <MenuItem value="select">Show on Select</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 280 }}>
            <InputLabel id="node-filter-select-label">Node filter</InputLabel>
            <Select
              labelId="node-filter-select-label"
              value={selectedNodeLabelFilter}
              label="Node filter"
              onChange={(e) => setSelectedNodeLabelFilter(e.target.value)}
            >
              {nodeLabelFilterOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Box>
      <div className="body">
        <div className="topology-container">
          <TopologyFlow
            ref={topologyRef}
            nodes={visibleNodes}
            edges={visibleEdges}
            onNodeSelect={handleNodeSelect}
            onEdgeSelect={handleEdgeSelect}
            onTelemetryRateLabelSelect={handleTelemetryRateLabelSelect}
            onTelemetryRateLabelTransformChange={handleTelemetryRateLabelTransformChange}
            onNodeDoubleClick={handleNodeDoubleClick}
            onBackgroundClick={handleBackgroundClick}
            colorMode={colorMode}
            labelMode={labelMode}
            appearanceMode={appearanceMode}
            telemetryNodeSizePx={telemetryNodeSizePx}
            telemetryInterfaceScale={telemetryInterfaceSizePercent / 100}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            selectedTelemetryRateLabel={selectedTelemetryRateLabel}
            onDevicePositionsChange={handleDevicePositionsChange}
          />
        </div>
        <div className="info-card">
          {infoCard.type === 'empty' && <span>Select a node, link, or traffic-rate label</span>}
          {infoCard.type === 'node' && (
            <InfoCardNode
              info={infoCard.info}
              raw={infoCard.raw}
              onEditIcon={handleOpenNodeIconEditor}
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
          {infoCard.type === 'rateLabel' && (
            <InfoCardRateLabel
              info={infoCard.info}
              onRotateBy={rotateSelectedTelemetryRateLabelBy}
              onSetRotation={setSelectedTelemetryRateLabelRotation}
              onResetRotation={() => setSelectedTelemetryRateLabelRotation(0)}
            />
          )}
        </div>
      </div>
      {nodeIconEditor && (
        <div className="export-popup">
          <div className="export-popup-content appearance-popup-content">
            <h3>Edit Node Icon</h3>
            <p className="export-help-text">
              Node: {nodeIconEditorNodeName}
            </p>
            <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
              <InputLabel id="node-icon-select-label">Icon</InputLabel>
              <Select
                labelId="node-icon-select-label"
                value={nodeIconEditor.iconKey}
                label="Icon"
                renderValue={(value) => {
                  const selectedKey = value as NodeIconKey;
                  const SelectedIcon = getNodeIconByKey(selectedKey);
                  const optionLabel = NODE_ICON_OPTION_BY_VALUE.get(selectedKey)?.label ?? selectedKey;
                  return (
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.9 }}>
                      <SelectedIcon sx={{ fontSize: 18 }} />
                      <span>{optionLabel}</span>
                    </Box>
                  );
                }}
                onChange={(event) => setNodeIconEditor((previous) => {
                  if (!previous) {
                    return previous;
                  }
                  return { ...previous, iconKey: event.target.value as NodeIconKey };
                })}
              >
                {NODE_ICON_OPTIONS.map((option) => {
                  const OptionIcon = getNodeIconByKey(option.value);
                  return (
                    <MenuItem key={option.value} value={option.value}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                        <OptionIcon sx={{ fontSize: 18 }} />
                        <span>{option.label}</span>
                      </Box>
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={nodeIconEditor.useThemeColor}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setNodeIconEditor((previous) => {
                    if (!previous) {
                      return previous;
                    }
                    return { ...previous, useThemeColor: checked };
                  });
                }}
              />
              Use theme icon color
            </label>
            <label>
              Icon color
              <input
                type="color"
                value={nodeIconEditor.iconColor}
                onChange={(event) => setNodeIconEditor((previous) => {
                  if (!previous) {
                    return previous;
                  }
                  return { ...previous, iconColor: event.target.value };
                })}
                disabled={nodeIconEditor.useThemeColor}
              />
            </label>
            <div className="export-popup-buttons">
              <button className="export-btn" onClick={handleApplyNodeIconEditor}>Apply</button>
              <button className="export-btn" onClick={handleResetNodeIconEditor}>Reset</button>
              <button className="export-btn cancel" onClick={() => setNodeIconEditor(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {showAppearancePopup && (
        <div className="export-popup">
          <div className="export-popup-content appearance-popup-content">
            <h3>Canvas Appearance</h3>
            <label>
              Style
              <select
                value={appearanceMode}
                onChange={e => setAppearanceMode(parseAppearanceMode(e.target.value))}
              >
                <option value="default">Default</option>
                <option value="telemetry">Telemetry</option>
              </select>
            </label>
            {appearanceMode === 'telemetry' && (
              <div className="export-grid-two">
                <label>
                  Node size (px)
                  <input
                    type="number"
                    min={12}
                    max={240}
                    step={1}
                    value={telemetryNodeSizePx}
                    onChange={e => setTelemetryNodeSizePx(
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
                    value={telemetryInterfaceSizePercent}
                    onChange={e => setTelemetryInterfaceSizePercent(
                      parseBoundedNumber(e.target.value, 40, 400, DEFAULT_GRAFANA_INTERFACE_SIZE_PERCENT)
                    )}
                  />
                </label>
              </div>
            )}
            <div className="export-popup-buttons">
              <button className="export-btn" onClick={() => setShowAppearancePopup(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
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
