import type { ExplorerNode, ExplorerTabId } from '../shared/explorer/types';
import type { NokiaExplorerIconName } from './nokiaExplorerIcons';

const SECTION_ICON_MAP: Record<ExplorerTabId, NokiaExplorerIconName> = {
  dashboards: 'home',
  resources: 'workflow',
  help: 'maintenance'
};

const NODE_LABEL_ICON_MAP: Record<string, NokiaExplorerIconName> = {
  home: 'home',
  alarms: 'alarmclock',
  transactions: 'timehistory',
  workflows: 'workflow',
  system: 'computer',
  tools: 'maintenance',
  targets: 'gpsfixed',
  deviations: 'checkcirclewarning',
  nodes: 'backhaulnode',
  allocations: 'formnumberfield',
  aifabrics: 'mapscale',
  components: 'module',
  configuration: 'statusconfigsquare',
  dcinterconnect: 'summaryview',
  'default routing': 'router',
  dhcp: 'icmpping',
  fabrics: 'sitemap',
  filters: 'filter',
  kafka: 'summaryview',
  maintenance: 'foldersettings',
  'management router': 'device',
  oam: 'anomaly',
  'overlay routing': 'routercircle',
  prometheus: 'summaryview',
  qos: 'trafficqos',
  'routing policies': 'routesmanaged',
  security: 'security',
  'site profiles': 'loglist',
  'system interface': 'port',
  timing: 'timeltr',
  topology: 'network',
  'virtual networks': 'sitevirtual'
};

const NODE_CONTEXT_ICON_MAP: Record<string, NokiaExplorerIconName> = {
  'resource-category': 'summaryview',
  stream: 'summaryview',
  'stream-item': 'summaryview',
  pod: 'computer',
  toponode: 'backhaulnode',
  'k8s-root': 'computer',
  'k8s-namespace': 'sitevirtual',
  'eda-dashboard': 'summaryview',
  'eda-alarm': 'alarmclock',
  'eda-deviation': 'checkcirclewarning',
  'basket-item': 'formnumberfield',
  'help-link': 'maintenance'
};

function normalizeIconLookupKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function sectionIconName(sectionId: ExplorerTabId): NokiaExplorerIconName {
  return SECTION_ICON_MAP[sectionId];
}

export function nodeIconName(node: ExplorerNode): NokiaExplorerIconName | undefined {
  const normalizedLabel = normalizeIconLookupKey(node.label);
  const byLabel = NODE_LABEL_ICON_MAP[normalizedLabel];
  if (byLabel) {
    return byLabel;
  }

  if (node.contextValue) {
    return NODE_CONTEXT_ICON_MAP[node.contextValue];
  }
  return undefined;
}
