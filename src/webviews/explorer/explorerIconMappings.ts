import type { ExplorerNode, ExplorerTabId } from '../shared/explorer/types';
import type { NokiaExplorerIconName } from './nokiaExplorerIcons';

const SECTION_ICON_MAP: Record<ExplorerTabId, NokiaExplorerIconName> = {
  dashboards: 'dashboard',
  resources: 'keypad',
  help: 'maintenance'
};

type IconMapEntry = readonly [label: string, iconName: NokiaExplorerIconName];

const NODE_LABEL_ICON_ENTRIES: readonly IconMapEntry[] = [
  ['AAA', 'adminlock'],
  ['AI', 'aiicon'],
  ['AI Fabrics', 'mapscale'],
  ['Alarm Management', 'alarmlistadmin'],
  ['Alarms', 'alarmclock'],
  ['Allocations', 'formnumberfield'],
  ['App Management', 'plugin'],
  ['Basket', 'store'],
  ['Components', 'module'],
  ['Configuration', 'statusconfigsquare'],
  ['Dashboard', 'dashboard'],
  ['Dashboards', 'dashboard'],
  ['DC Interconnect', 'summaryview'],
  ['Default Routing', 'router'],
  ['Deviations', 'checkcirclewarning'],
  ['DHCP', 'icmpping'],
  ['Fabrics', 'sitemap'],
  ['Filters', 'filter'],
  ['Help', 'maintenance'],
  ['Home', 'home'],
  ['Kafka', 'summaryview'],
  ['Maintenance', 'foldersettings'],
  ['Management', 'settings'],
  ['Management Router', 'device'],
  ['Merge Requests', 'arrowupsquare'],
  ['Micro Segmentation', 'filter'],
  ['MPLS', 'routesmanaged'],
  ['Node Onboarding', 'backhaulnode'],
  ['Nodes', 'backhaulnode'],
  ['OAM', 'anomaly'],
  ['Overlay Routing', 'routercircle'],
  ['Platform', 'settings'],
  ['Pods', 'computer'],
  ['Prometheus', 'summaryview'],
  ['QoS', 'trafficqos'],
  ['Queries', 'logsearch'],
  ['Resource Browser', 'keypad'],
  ['Resources', 'keypad'],
  ['Routing Policies', 'routesmanaged'],
  ['Secrets', 'security'],
  ['Security', 'security'],
  ['Simnodes', 'computer'],
  ['Site Profiles', 'loglist'],
  ['System', 'computer'],
  ['System Interface', 'port'],
  ['Timing', 'timeltr'],
  ['Tools', 'maintenance'],
  ['Targets', 'gpsfixed'],
  ['Topo Builder', 'workflow'],
  ['Topologies', 'sitemap'],
  ['Topology', 'network'],
  ['Transactions', 'timehistory'],
  ['Underlay Routing', 'site'],
  ['User Management', 'adminsettings'],
  ['Virtual Networks', 'sitevirtual'],
  ['Workflows', 'workflow']
];

const RESOURCE_TYPE_ICON_ENTRIES: readonly IconMapEntry[] = [
  ['aaa', 'adminlock'],
  ['aifabrics', 'mapscale'],
  ['ai', 'aiicon'],
  ['alarms', 'alarmclock'],
  ['alarmpolicies', 'alarmlistadmin'],
  ['allocations', 'formnumberfield'],
  ['appmanagement', 'plugin'],
  ['aspathsets', 'routesmanaged'],
  ['authenticationpolicies', 'security'],
  ['bgpgroups', 'routercircle'],
  ['bgppeers', 'router'],
  ['bridgedomaininterconnects', 'sitevirtual'],
  ['bridgedomains', 'sitevirtual'],
  ['bridgeinterfaces', 'port'],
  ['catalogs', 'plugin'],
  ['chassis', 'module'],
  ['clusterroles', 'adminlock'],
  ['components', 'module'],
  ['configlets', 'statusconfigsquare'],
  ['controlplanefilters', 'filter'],
  ['dashboards', 'dashboard'],
  ['defaultaggregateroutes', 'routesmanaged'],
  ['defaultbgpgroups', 'routercircle'],
  ['defaultbgppeers', 'router'],
  ['defaultinterfaces', 'port'],
  ['defaultldpinterfaces', 'port'],
  ['defaultldprouters', 'router'],
  ['defaultmtus', 'port'],
  ['defaultospfareas', 'network'],
  ['defaultospfinstances', 'routesmanaged'],
  ['defaultospfinterfaces', 'port'],
  ['defaultroutereflectorclients', 'router'],
  ['defaultroutereflectors', 'routercircle'],
  ['defaultrouters', 'router'],
  ['defaultstaticroutes', 'routesmanaged'],
  ['deviations', 'checkcirclewarning'],
  ['dhcprelays', 'icmpping'],
  ['egresspolicys', 'trafficqos'],
  ['fabrics', 'sitemap'],
  ['fabricmodules', 'module'],
  ['fans', 'module'],
  ['filters', 'filter'],
  ['forwardingclasss', 'trafficqos'],
  ['httpproxies', 'settings'],
  ['ingresspolicys', 'trafficqos'],
  ['interfaces', 'port'],
  ['interfacemodules', 'module'],
  ['irbinterfaces', 'port'],
  ['keychaindeployments', 'security'],
  ['keychains', 'secretkeys'],
  ['logoutputs', 'loglist'],
  ['mcprompttemplates', 'aiicon'],
  ['mcpprompttemplates', 'aiicon'],
  ['mcpresourcedefinitions', 'aiicon'],
  ['mcpsettings', 'settings'],
  ['mcptooldefinitions', 'maintenance'],
  ['merge-requests', 'arrowupsquare'],
  ['merge requests', 'arrowupsquare'],
  ['mirrors', 'anomaly'],
  ['nodes', 'backhaulnode'],
  ['nodegroups', 'adminsettings'],
  ['nodeusers', 'admin'],
  ['ospfareas', 'network'],
  ['ospfinstances', 'routesmanaged'],
  ['ospfinterfaces', 'port'],
  ['passwordpolicy', 'secretkeys'],
  ['pods', 'computer'],
  ['policies', 'routesmanaged'],
  ['policyattachments', 'trafficqos'],
  ['policydeployments', 'trafficqos'],
  ['prefixsets', 'filter'],
  ['providers', 'aiicon'],
  ['queries', 'logsearch'],
  ['queues', 'trafficqos'],
  ['registries', 'store'],
  ['roles', 'admin'],
  ['routedinterfaces', 'port'],
  ['routereflectorclients', 'router'],
  ['routereflectors', 'routercircle'],
  ['routerinterconnects', 'routercircle'],
  ['routers', 'routercircle'],
  ['satellites', 'network'],
  ['servergroups', 'security'],
  ['staticroutes', 'routesmanaged'],
  ['store', 'store'],
  ['subnets', 'formnumberfield'],
  ['systeminterfaces', 'port'],
  ['systemloadbalancers', 'trafficqos'],
  ['tagsets', 'routesmanaged'],
  ['thresholds', 'anomaly'],
  ['topolinks', 'network'],
  ['topologies', 'sitemap'],
  ['toponodes', 'backhaulnode'],
  ['transactions', 'timehistory'],
  ['udpproxies', 'settings'],
  ['userManagement', 'adminsettings'],
  ['user management', 'adminsettings'],
  ['virtualnetworks', 'service'],
  ['vlans', 'sitevirtual'],
  ['workflows', 'workflow']
];

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
    .replace(/\s*\(\d+\)\s*$/u, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function createIconMap(entries: readonly IconMapEntry[]): Record<string, NokiaExplorerIconName> {
  const map: Record<string, NokiaExplorerIconName> = {};
  for (const [label, iconName] of entries) {
    const normalized = normalizeIconLookupKey(label);
    map[normalized] = iconName;
    map[normalized.replace(/\s+/g, '')] = iconName;
  }
  return map;
}

const NODE_LABEL_ICON_MAP = createIconMap(NODE_LABEL_ICON_ENTRIES);
const RESOURCE_TYPE_ICON_MAP = createIconMap(RESOURCE_TYPE_ICON_ENTRIES);

function lookupIconName(
  map: Record<string, NokiaExplorerIconName>,
  value: string | undefined
): NokiaExplorerIconName | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = normalizeIconLookupKey(value);
  return map[normalized] ?? map[normalized.replace(/\s+/g, '')];
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function commandArgIconName(commandArg: unknown): NokiaExplorerIconName | undefined {
  const record = toRecord(commandArg);
  if (!record) {
    return undefined;
  }
  return lookupIconName(RESOURCE_TYPE_ICON_MAP, stringValue(record.resourceType))
    ?? lookupIconName(RESOURCE_TYPE_ICON_MAP, stringValue(record.kind))
    ?? lookupIconName(NODE_LABEL_ICON_MAP, stringValue(record.streamGroup));
}

export function sectionIconName(sectionId: ExplorerTabId): NokiaExplorerIconName {
  return SECTION_ICON_MAP[sectionId];
}

export function nodeIconName(node: ExplorerNode): NokiaExplorerIconName | undefined {
  const byResourceType = lookupIconName(RESOURCE_TYPE_ICON_MAP, node.resourceType)
    ?? commandArgIconName(node.commandArg);
  const byLabel = lookupIconName(NODE_LABEL_ICON_MAP, node.label);
  const byStreamGroup = lookupIconName(NODE_LABEL_ICON_MAP, node.resourceCategory)
    ?? lookupIconName(NODE_LABEL_ICON_MAP, node.streamGroup);

  return byResourceType ?? byLabel ?? byStreamGroup ?? (node.contextValue ? NODE_CONTEXT_ICON_MAP[node.contextValue] : undefined);
}
