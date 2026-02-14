/* eslint-disable sonarjs/no-duplicate-string, sonarjs/no-hardcoded-passwords */

import {
  EXPLORER_TAB_LABELS,
  type ExplorerAction,
  type ExplorerNode,
  type ExplorerSectionSnapshot,
  type ExplorerTabId
} from '../../../src/webviews/shared/explorer/types';

import type { DevPreviewWebviewId, DevWebviewId } from './webviewCatalog';

const ALL_NAMESPACES = 'All Namespaces';
const DEFAULT_NAMESPACES = [ALL_NAMESPACES, 'fabric-a', 'fabric-b'];
const DEFAULT_CLIENT_SECRET = 'dev-client-secret-1234';
const OPEN_PREVIEW_EVENT_SOURCE = 'eda-webviews-dev';
const DASHBOARD_PREVIEW_BY_NAME: Readonly<Record<string, DevPreviewWebviewId>> = {
  Fabric: 'fabricDashboard',
  Nodes: 'toponodesDashboard',
  Queries: 'queriesDashboard',
  'Resource Browser': 'resourceBrowser',
  Simnodes: 'simnodesDashboard',
  Topology: 'topologyFlowDashboard',
  Workflows: 'workflowsDashboard'
};

const DEV_DEVIATION_KEY = 'fabric-a/leaf02-bgp-hold-time';

interface WebviewCommand {
  command: string;
  [key: string]: unknown;
}

type SendMessage = (message: Record<string, unknown>) => void;

export interface MockHost {
  onMessage: (message: WebviewCommand) => void;
  dispose: () => void;
}

export interface MockHostOptions {
  previewParams: URLSearchParams;
}

interface DiffResource {
  type?: string;
  group?: string;
  version?: string;
  kind?: string;
  name?: string;
  namespace?: string;
}

interface TargetRecord {
  url: string;
  context?: string;
  coreNamespace?: string;
  edaUsername?: string;
  edaPassword?: string;
  clientSecret?: string;
  skipTlsVerify?: boolean;
}

interface QueryResults {
  columns: string[];
  rows: unknown[][];
  status: string;
}

interface DataGridFixture {
  columns: string[];
  rowsByNamespace: Readonly<Record<string, readonly unknown[][]>>;
}

interface TopologyFixture {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

interface FabricSnapshot {
  topoNodeStats: { total: number; synced: number; notSynced: number };
  interfaceStats: { total: number; up: number; down: number };
  fabricHealth: number;
  spineStats: { count: number; health: number };
  leafStats: { count: number; health: number };
  borderLeafStats: { count: number; health: number };
  superSpineStats: { count: number; health: number };
  trafficBaseIn: number;
  trafficBaseOut: number;
}

interface DeviationDetailsFixture {
  name: string;
  namespace: string;
  kind: string;
  apiVersion: string;
  status: string;
  valueDiff?: string;
  resourceYaml?: string;
  errorMessage?: string;
  rawJson: string;
}

const alarmFixture = {
  name: 'LinkDown-Spine01-Leaf01',
  kind: 'Alarm',
  type: 'Connectivity',
  severity: 'Major',
  namespace: 'fabric-a',
  group: 'topology.eda.nokia.com',
  sourceGroup: 'topolinks',
  sourceKind: 'TopoLink',
  sourceResource: 'spine01--leaf01',
  parentAlarm: 'None',
  clusterSpecific: 'false',
  jspath: '$.status.operationalState',
  resource: 'topolinks/fabric-a/spine01--leaf01',
  probableCause: 'Optical signal is not detected on one or both link endpoints.',
  remedialAction: 'Validate transceivers and cabling, then clear and re-check the alarm.',
  description: 'Fabric uplink between spine01 and leaf01 is currently down.',
  rawJson: stringifyFixture({
    name: 'LinkDown-Spine01-Leaf01',
    state: 'Active',
    raisedAt: '2026-02-12T17:55:01Z',
    severity: 'Major',
    details: {
      source: 'spine01:ethernet-1/1',
      target: 'leaf01:ethernet-1/49',
      operationalState: 'down'
    }
  })
};

const alarmInterfaceFixture = {
  name: 'InterfaceDown-Leaf11-E1/53',
  kind: 'Alarm',
  type: 'Interface',
  severity: 'Minor',
  namespace: 'fabric-b',
  group: 'core.eda.nokia.com',
  sourceGroup: 'interfaces',
  sourceKind: 'Interface',
  sourceResource: 'leaf11-ethernet-1-53',
  parentAlarm: 'None',
  clusterSpecific: 'false',
  jspath: '$.status.operationalState',
  resource: 'interfaces/fabric-b/leaf11-ethernet-1-53',
  probableCause: 'Interface transitioned to down state.',
  remedialAction: 'Validate remote endpoint and optics on ethernet-1/53.',
  description: 'Leaf11 interface ethernet-1/53 is down.',
  rawJson: stringifyFixture({
    name: 'InterfaceDown-Leaf11-E1/53',
    state: 'Active',
    raisedAt: '2026-02-13T08:25:19Z',
    severity: 'Minor',
    details: {
      source: 'leaf11:ethernet-1/53',
      operationalState: 'down'
    }
  })
};

const alarmFixtureByName: Readonly<Record<string, typeof alarmFixture>> = {
  [alarmFixture.name]: alarmFixture,
  [alarmInterfaceFixture.name]: alarmInterfaceFixture
};

const nodeConfigFixtureText = `system {
    name spine01
    admin-state enable
}
interface ethernet-1/1 {
    description "Uplink to leaf01"
    admin-state enable
    subinterface 0 {
        ipv4 {
            address 10.0.0.1/31
        }
    }
}
network-instance default {
    interface ethernet-1/1.0 {
    }
    protocols {
        bgp {
            admin-state enable
            autonomous-system 65000
        }
    }
}`;

const nodeConfigFixtureAnnotations = [
  {
    cr: {
      name: 'spine01-system',
      gvk: {
        group: 'core.eda.nokia.com',
        version: 'v1',
        kind: 'NodeConfig'
      }
    },
    lines: [{ startLine: 1, endLine: 4 }]
  },
  {
    cr: {
      name: 'spine01-uplink',
      gvk: {
        group: 'core.eda.nokia.com',
        version: 'v1',
        kind: 'InterfaceConfig'
      }
    },
    lines: [{ startLine: 5, endLine: 13 }]
  },
  {
    cr: {
      name: 'spine01-bgp',
      gvk: {
        group: 'routing.eda.nokia.com',
        version: 'v1alpha1',
        kind: 'BgpNeighbor'
      }
    },
    lines: [{ startLine: 14, endLine: 22 }]
  }
];

const targetFixture: TargetRecord[] = [
  {
    url: 'https://eda-fabric-a.example.local',
    context: 'cluster-fabric-a',
    coreNamespace: 'eda-system',
    edaUsername: 'admin',
    edaPassword: 'admin',
    clientSecret: DEFAULT_CLIENT_SECRET
  },
  {
    url: 'https://eda-fabric-b.example.local',
    context: 'cluster-fabric-b',
    coreNamespace: 'eda-system',
    edaUsername: 'automation',
    edaPassword: 'password',
    clientSecret: 'dev-client-secret-9876',
    skipTlsVerify: true
  }
];

const transactionDetailsFixture = {
  id: '1042',
  state: 'Completed',
  success: 'Yes',
  username: 'admin',
  dryRun: 'No',
  description: 'Apply leaf uplink and BGP policy update',
  deleteResources: ['fabric-a/obsolete-policy'],
  inputCrs: [
    {
      name: {
        namespace: 'fabric-a',
        gvk: { kind: 'TopoNode' },
        name: 'leaf01'
      }
    },
    {
      name: {
        namespace: 'fabric-a',
        gvk: { kind: 'BgpNeighbor' },
        name: 'leaf01-peer-spine01'
      }
    }
  ],
  changedCrs: [
    {
      namespace: 'fabric-a',
      gvk: { kind: 'BgpNeighbor' },
      names: ['leaf01-peer-spine01']
    },
    {
      namespace: 'fabric-a',
      gvk: { kind: 'InterfaceConfig' },
      names: ['leaf01-uplink-ethernet-1-49']
    }
  ],
  nodesWithConfigChanges: [
    {
      name: 'leaf01',
      namespace: 'fabric-a',
      errors: []
    },
    {
      name: 'spine01',
      namespace: 'fabric-a',
      errors: ['failed validate: leaf01 error_str:"BGP hold timer mismatch" cr_name:"leaf01-peer-spine01"']
    }
  ],
  intentsRun: [
    {
      intentName: { name: 'leaf-bgp-advertisement' },
      errors: [{ message: 'No export policy assigned for route-target 65100:42' }]
    }
  ],
  rawJson: stringifyFixture({
    id: '1042',
    state: 'Completed',
    nodesWithChanges: ['leaf01', 'spine01'],
    timestamp: '2026-02-13T10:42:00Z'
  })
};

const transactionDetailsRunningFixture = {
  id: '1041',
  state: 'Running',
  success: 'No',
  username: 'automation',
  dryRun: 'Yes',
  description: 'Sync topology intent',
  deleteResources: [],
  inputCrs: [
    {
      name: {
        namespace: 'fabric-b',
        gvk: { kind: 'TopoLink' },
        name: 'superspine01--leaf11'
      }
    }
  ],
  changedCrs: [
    {
      namespace: 'fabric-b',
      gvk: { kind: 'TopoLink' },
      names: ['superspine01--leaf11']
    }
  ],
  nodesWithConfigChanges: [
    {
      name: 'leaf11',
      namespace: 'fabric-b',
      errors: []
    }
  ],
  intentsRun: [],
  rawJson: stringifyFixture({
    id: '1041',
    state: 'Running',
    dryRun: true,
    timestamp: '2026-02-13T10:39:12Z'
  })
};

const transactionDetailsFixtureById: Readonly<Record<string, typeof transactionDetailsFixture>> = {
  [transactionDetailsFixture.id]: transactionDetailsFixture,
  [transactionDetailsRunningFixture.id]: transactionDetailsRunningFixture
};

const deviationDetailsFixtureByKey: Readonly<Record<string, DeviationDetailsFixture>> = {
  [DEV_DEVIATION_KEY]: {
    name: 'leaf02-bgp-hold-time',
    namespace: 'fabric-a',
    kind: 'Deviation',
    apiVersion: 'routing.eda.nokia.com/v1alpha1',
    status: 'Pending',
    valueDiff: [
      '- hold-time: 180',
      '+ hold-time: 90'
    ].join('\n'),
    resourceYaml: [
      'apiVersion: routing.eda.nokia.com/v1alpha1',
      'kind: BgpNeighbor',
      'metadata:',
      '  name: leaf02-peer-spine01',
      '  namespace: fabric-a',
      'spec:',
      '  peerAddress: 10.0.0.2',
      '  peerAs: 65000',
      '  holdTime: 180'
    ].join('\n'),
    rawJson: stringifyFixture({
      name: 'leaf02-bgp-hold-time',
      namespace: 'fabric-a',
      kind: 'Deviation',
      apiVersion: 'routing.eda.nokia.com/v1alpha1',
      status: 'Pending',
      metadata: {
        name: 'leaf02-bgp-hold-time',
        namespace: 'fabric-a'
      }
    })
  }
};

const transactionDiffListFixture = {
  diffs: [
    {
      group: 'routing.eda.nokia.com',
      version: 'v1alpha1',
      kind: 'BgpNeighbor',
      name: 'leaf01-peer-spine01',
      namespace: 'fabric-a'
    },
    {
      group: 'core.eda.nokia.com',
      version: 'v1',
      kind: 'InterfaceConfig',
      name: 'leaf01-uplink-ethernet-1-49',
      namespace: 'fabric-a'
    }
  ],
  nodes: [
    {
      name: 'leaf01',
      namespace: 'fabric-a'
    }
  ]
};

const transactionDiffListFixtureById: Readonly<Record<string, typeof transactionDiffListFixture>> = {
  '1042': transactionDiffListFixture,
  '1041': {
    diffs: [
      {
        group: 'core.eda.nokia.com',
        version: 'v1',
        kind: 'TopoLink',
        name: 'superspine01--leaf11',
        namespace: 'fabric-b'
      }
    ],
    nodes: [
      {
        name: 'leaf11',
        namespace: 'fabric-b'
      }
    ]
  }
};

const transactionDiffPayloads: Readonly<Record<string, { before: { data: string }; after: { data: string } }>> = {
  'resource:leaf01-peer-spine01': {
    before: {
      data: [
        'neighbor 10.0.0.0 {',
        '    peer-as 65000',
        '    hold-time 90',
        '    admin-state disable',
        '}'
      ].join('\n')
    },
    after: {
      data: [
        'neighbor 10.0.0.0 {',
        '    peer-as 65000',
        '    hold-time 180',
        '    admin-state enable',
        '}'
      ].join('\n')
    }
  },
  'resource:leaf01-uplink-ethernet-1-49': {
    before: {
      data: [
        'interface ethernet-1/49 {',
        '    admin-state disable',
        '}'
      ].join('\n')
    },
    after: {
      data: [
        'interface ethernet-1/49 {',
        '    description "Uplink to spine01"',
        '    admin-state enable',
        '}'
      ].join('\n')
    }
  },
  'node:leaf01': {
    before: {
      data: [
        'system {',
        '    name leaf01',
        '}',
        'interface ethernet-1/49 {',
        '    admin-state disable',
        '}'
      ].join('\n')
    },
    after: {
      data: [
        'system {',
        '    name leaf01',
        '}',
        'interface ethernet-1/49 {',
        '    description "Fabric uplink"',
        '    admin-state enable',
        '}'
      ].join('\n')
    }
  }
};

const resourceDefinitions = [
  { name: 'toponodes.core.eda.nokia.com', kind: 'TopoNode' },
  { name: 'topolinks.core.eda.nokia.com', kind: 'TopoLink' },
  { name: 'bgpneighbors.routing.eda.nokia.com', kind: 'BgpNeighbor' }
] as const;

const resourceDataByName: Readonly<Record<string, { kind: string; description: string; yaml: string; schema: Record<string, unknown> }>> = {
  'toponodes.core.eda.nokia.com': {
    kind: 'TopoNode',
    description: 'Represents a managed topology node in the selected namespace.',
    yaml: [
      'apiVersion: core.eda.nokia.com/v1',
      'kind: TopoNode'
    ].join('\n'),
    schema: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          required: ['operatingSystem', 'platform'],
          properties: {
            operatingSystem: {
              type: 'string',
              description: 'Operating system type for the node (for example, srl or linux).'
            },
            platform: {
              type: 'string',
              description: 'Hardware platform identifier.'
            }
          }
        },
        status: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description: 'Operational status reported by EDA.'
            },
            sync: {
              type: 'string',
              description: 'Configuration sync state.'
            }
          }
        }
      }
    }
  },
  'topolinks.core.eda.nokia.com': {
    kind: 'TopoLink',
    description: 'Describes physical or logical links between topology nodes.',
    yaml: [
      'apiVersion: core.eda.nokia.com/v1',
      'kind: TopoLink'
    ].join('\n'),
    schema: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          required: ['links'],
          properties: {
            links: {
              type: 'array',
              description: 'List of local and remote endpoint mappings.',
              items: {
                type: 'object',
                properties: {
                  local: {
                    type: 'object',
                    properties: {
                      node: { type: 'string' },
                      interface: { type: 'string' }
                    }
                  },
                  remote: {
                    type: 'object',
                    properties: {
                      node: { type: 'string' },
                      interface: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  'bgpneighbors.routing.eda.nokia.com': {
    kind: 'BgpNeighbor',
    description: 'BGP neighbor resource for routing policy and timers.',
    yaml: [
      'apiVersion: routing.eda.nokia.com/v1alpha1',
      'kind: BgpNeighbor'
    ].join('\n'),
    schema: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          required: ['peerAddress', 'peerAs'],
          properties: {
            peerAddress: {
              type: 'string',
              description: 'Peer IP address in IPv4/IPv6 format.'
            },
            peerAs: {
              type: 'integer',
              description: 'Peer autonomous system number.'
            },
            holdTime: {
              type: 'integer',
              description: 'BGP hold timer value in seconds.'
            }
          }
        }
      }
    }
  }
};

const simnodesFixture: DataGridFixture = {
  columns: ['name', 'namespace', 'operatingSystem', 'pod-status', 'managementAddress', 'labels'],
  rowsByNamespace: {
    'fabric-a': [
      ['sim-a-leaf01', 'fabric-a', 'srl', 'Running', '172.20.10.21', 'role=leaf'],
      ['sim-a-leaf02', 'fabric-a', 'srl', 'Starting', '172.20.10.22', 'role=leaf']
    ],
    'fabric-b': [
      ['sim-b-leaf01', 'fabric-b', 'linux', 'Running', '172.20.20.11', 'role=borderleaf'],
      ['sim-b-leaf02', 'fabric-b', 'linux', 'Failed', '172.20.20.12', 'role=borderleaf']
    ]
  }
};

const toponodesFixture: DataGridFixture = {
  columns: ['name', 'namespace', 'operatingSystem', 'node-details', 'status', 'sync', 'labels'],
  rowsByNamespace: {
    'fabric-a': [
      ['spine01', 'fabric-a', 'srl', '10.1.0.11', 'Ready', 'InSync', 'role=spine'],
      ['leaf01', 'fabric-a', 'srl', '10.1.0.21', 'Ready', 'InSync', 'role=leaf'],
      ['leaf02', 'fabric-a', 'srl', '10.1.0.22', 'Warning', 'Drifted', 'role=leaf']
    ],
    'fabric-b': [
      ['superspine01', 'fabric-b', 'srl', '10.2.0.11', 'Ready', 'InSync', 'role=superspine'],
      ['leaf11', 'fabric-b', 'srl', '10.2.0.21', 'Ready', 'InSync', 'role=leaf']
    ]
  }
};

const workflowsFixture: DataGridFixture = {
  columns: ['name', 'namespace', 'workflow-type', 'workflow-status', 'created'],
  rowsByNamespace: {
    'fabric-a': [
      ['leaf-upgrade-001', 'fabric-a', 'operatingsystem-image-gvk', 'Running', '2026-02-13T10:17:00Z'],
      ['neighbor-audit-019', 'fabric-a', 'protocols-checkdefaultbgppeers-gvk', 'Succeeded', '2026-02-13T10:04:12Z']
    ],
    'fabric-b': [
      ['edgeping-744', 'fabric-b', 'services-edgeping-gvk', 'Failed', '2026-02-13T09:58:07Z']
    ]
  }
};

const topologyFixtureByNamespace: Readonly<Record<string, TopologyFixture>> = {
  [ALL_NAMESPACES]: {
    nodes: [
      createTopologyNode('fabric-a/spine01', 'spine01', 1, 'spine', 'fabric-a', '10.1.0.11'),
      createTopologyNode('fabric-a/leaf01', 'leaf01', 2, 'leaf', 'fabric-a', '10.1.0.21'),
      createTopologyNode('fabric-a/leaf02', 'leaf02', 2, 'leaf', 'fabric-a', '10.1.0.22'),
      createTopologyNode('fabric-b/superspine01', 'superspine01', 1, 'superspine', 'fabric-b', '10.2.0.11'),
      createTopologyNode('fabric-b/leaf11', 'leaf11', 2, 'leaf', 'fabric-b', '10.2.0.21')
    ],
    edges: [
      createTopologyEdge('fabric-a/spine01', 'fabric-a/leaf01', 'ethernet-1/1', 'ethernet-1/49'),
      createTopologyEdge('fabric-a/spine01', 'fabric-a/leaf02', 'ethernet-1/2', 'ethernet-1/49'),
      createTopologyEdge('fabric-b/superspine01', 'fabric-b/leaf11', 'ethernet-1/5', 'ethernet-1/53')
    ]
  },
  'fabric-a': {
    nodes: [
      createTopologyNode('fabric-a/spine01', 'spine01', 1, 'spine', 'fabric-a', '10.1.0.11'),
      createTopologyNode('fabric-a/leaf01', 'leaf01', 2, 'leaf', 'fabric-a', '10.1.0.21'),
      createTopologyNode('fabric-a/leaf02', 'leaf02', 2, 'leaf', 'fabric-a', '10.1.0.22')
    ],
    edges: [
      createTopologyEdge('fabric-a/spine01', 'fabric-a/leaf01', 'ethernet-1/1', 'ethernet-1/49'),
      createTopologyEdge('fabric-a/spine01', 'fabric-a/leaf02', 'ethernet-1/2', 'ethernet-1/49')
    ]
  },
  'fabric-b': {
    nodes: [
      createTopologyNode('fabric-b/superspine01', 'superspine01', 1, 'superspine', 'fabric-b', '10.2.0.11'),
      createTopologyNode('fabric-b/leaf11', 'leaf11', 2, 'leaf', 'fabric-b', '10.2.0.21')
    ],
    edges: [
      createTopologyEdge('fabric-b/superspine01', 'fabric-b/leaf11', 'ethernet-1/5', 'ethernet-1/53')
    ]
  }
};

const fabricSnapshotByNamespace: Readonly<Record<string, FabricSnapshot>> = {
  [ALL_NAMESPACES]: {
    topoNodeStats: { total: 12, synced: 10, notSynced: 2 },
    interfaceStats: { total: 192, up: 187, down: 5 },
    fabricHealth: 92,
    spineStats: { count: 2, health: 95 },
    leafStats: { count: 8, health: 91 },
    borderLeafStats: { count: 1, health: 88 },
    superSpineStats: { count: 1, health: 96 },
    trafficBaseIn: 6_200_000_000,
    trafficBaseOut: 5_800_000_000
  },
  'fabric-a': {
    topoNodeStats: { total: 7, synced: 6, notSynced: 1 },
    interfaceStats: { total: 104, up: 101, down: 3 },
    fabricHealth: 90,
    spineStats: { count: 1, health: 92 },
    leafStats: { count: 5, health: 89 },
    borderLeafStats: { count: 1, health: 86 },
    superSpineStats: { count: 0, health: 0 },
    trafficBaseIn: 3_900_000_000,
    trafficBaseOut: 3_600_000_000
  },
  'fabric-b': {
    topoNodeStats: { total: 5, synced: 4, notSynced: 1 },
    interfaceStats: { total: 88, up: 86, down: 2 },
    fabricHealth: 94,
    spineStats: { count: 1, health: 98 },
    leafStats: { count: 3, health: 94 },
    borderLeafStats: { count: 0, health: 0 },
    superSpineStats: { count: 1, health: 96 },
    trafficBaseIn: 2_300_000_000,
    trafficBaseOut: 2_200_000_000
  }
};

const explorerSectionsFixture: ReadonlyArray<ExplorerSectionSnapshot> = [
  createExplorerSection(
    'dashboards',
    [
      createExplorerNode('dashboards/fabric', 'Fabric', {
        contextValue: 'eda-dashboard',
        primaryAction: createExplorerAction(
          'open-dashboard-fabric',
          'Open Dashboard',
          'vscode-eda.showDashboard',
          ['Fabric']
        )
      }),
      createExplorerNode('dashboards/nodes', 'Nodes', {
        contextValue: 'eda-dashboard',
        primaryAction: createExplorerAction(
          'open-dashboard-nodes',
          'Open Dashboard',
          'vscode-eda.showDashboard',
          ['Nodes']
        )
      }),
      createExplorerNode('dashboards/queries', 'Queries', {
        contextValue: 'eda-dashboard',
        primaryAction: createExplorerAction(
          'open-dashboard-queries',
          'Open Dashboard',
          'vscode-eda.showDashboard',
          ['Queries']
        )
      }),
      createExplorerNode('dashboards/resource-browser', 'Resource Browser', {
        contextValue: 'eda-dashboard',
        primaryAction: createExplorerAction(
          'open-dashboard-resource-browser',
          'Open Dashboard',
          'vscode-eda.showDashboard',
          ['Resource Browser']
        )
      }),
      createExplorerNode('dashboards/simnodes', 'Simnodes', {
        contextValue: 'eda-dashboard',
        primaryAction: createExplorerAction(
          'open-dashboard-simnodes',
          'Open Dashboard',
          'vscode-eda.showDashboard',
          ['Simnodes']
        )
      }),
      createExplorerNode('dashboards/topology', 'Topology', {
        contextValue: 'eda-dashboard',
        primaryAction: createExplorerAction(
          'open-dashboard-topology',
          'Open Dashboard',
          'vscode-eda.showDashboard',
          ['Topology']
        )
      }),
      createExplorerNode('dashboards/workflows', 'Workflows', {
        contextValue: 'eda-dashboard',
        primaryAction: createExplorerAction(
          'open-dashboard-workflows',
          'Open Dashboard',
          'vscode-eda.showDashboard',
          ['Workflows']
        )
      })
    ],
    []
  ),
  createExplorerSection(
    'resources',
    [
      createExplorerNode('resources/fabric-a', 'fabric-a', {
        contextValue: 'namespace',
        children: [
          createExplorerNode('resources/fabric-a/core', 'core', {
            contextValue: 'stream-group',
            children: [
              createExplorerNode('resources/fabric-a/core/toponodes', 'toponodes', {
                contextValue: 'stream',
                children: [
                  createStreamResourceNode('resources/fabric-a/core/toponodes/spine01', 'spine01', {
                    namespace: 'fabric-a',
                    streamGroup: 'core',
                    resourceType: 'toponodes',
                    kind: 'TopoNode',
                    contextValue: 'toponode',
                    statusIndicator: 'green',
                    statusDescription: 'Ready - InSync'
                  }),
                  createStreamResourceNode('resources/fabric-a/core/toponodes/leaf01', 'leaf01', {
                    namespace: 'fabric-a',
                    streamGroup: 'core',
                    resourceType: 'toponodes',
                    kind: 'TopoNode',
                    contextValue: 'toponode',
                    statusIndicator: 'green',
                    statusDescription: 'Ready - InSync'
                  }),
                  createStreamResourceNode('resources/fabric-a/core/toponodes/leaf02', 'leaf02', {
                    namespace: 'fabric-a',
                    streamGroup: 'core',
                    resourceType: 'toponodes',
                    kind: 'TopoNode',
                    contextValue: 'toponode',
                    statusIndicator: 'yellow',
                    statusDescription: 'Warning - Drifted'
                  })
                ]
              }),
              createExplorerNode('resources/fabric-a/core/topolinks', 'topolinks', {
                contextValue: 'stream',
                children: [
                  createStreamResourceNode('resources/fabric-a/core/topolinks/spine01--leaf01', 'spine01--leaf01', {
                    namespace: 'fabric-a',
                    streamGroup: 'core',
                    resourceType: 'topolinks',
                    kind: 'TopoLink',
                    contextValue: 'stream-item',
                    statusIndicator: 'red',
                    statusDescription: 'Down'
                  })
                ]
              })
            ]
          }),
          createExplorerNode('resources/fabric-a/routing', 'routing', {
            contextValue: 'stream-group',
            children: [
              createExplorerNode('resources/fabric-a/routing/bgpneighbors', 'bgpneighbors', {
                contextValue: 'stream',
                children: [
                  createStreamResourceNode('resources/fabric-a/routing/bgpneighbors/leaf01-peer-spine01', 'leaf01-peer-spine01', {
                    namespace: 'fabric-a',
                    streamGroup: 'routing',
                    resourceType: 'bgpneighbors',
                    kind: 'BgpNeighbor',
                    contextValue: 'stream-item',
                    statusIndicator: 'green',
                    statusDescription: 'Established'
                  }),
                  createStreamResourceNode('resources/fabric-a/routing/bgpneighbors/leaf02-peer-spine01', 'leaf02-peer-spine01', {
                    namespace: 'fabric-a',
                    streamGroup: 'routing',
                    resourceType: 'bgpneighbors',
                    kind: 'BgpNeighbor',
                    contextValue: 'stream-item',
                    statusIndicator: 'yellow',
                    statusDescription: 'Idle'
                  })
                ]
              })
            ]
          })
        ]
      }),
      createExplorerNode('resources/fabric-b', 'fabric-b', {
        contextValue: 'namespace',
        children: [
          createExplorerNode('resources/fabric-b/core', 'core', {
            contextValue: 'stream-group',
            children: [
              createExplorerNode('resources/fabric-b/core/toponodes', 'toponodes', {
                contextValue: 'stream',
                children: [
                  createStreamResourceNode('resources/fabric-b/core/toponodes/superspine01', 'superspine01', {
                    namespace: 'fabric-b',
                    streamGroup: 'core',
                    resourceType: 'toponodes',
                    kind: 'TopoNode',
                    contextValue: 'toponode',
                    statusIndicator: 'green',
                    statusDescription: 'Ready - InSync'
                  }),
                  createStreamResourceNode('resources/fabric-b/core/toponodes/leaf11', 'leaf11', {
                    namespace: 'fabric-b',
                    streamGroup: 'core',
                    resourceType: 'toponodes',
                    kind: 'TopoNode',
                    contextValue: 'toponode',
                    statusIndicator: 'green',
                    statusDescription: 'Ready - InSync'
                  })
                ]
              }),
              createExplorerNode('resources/fabric-b/core/topolinks', 'topolinks', {
                contextValue: 'stream',
                children: [
                  createStreamResourceNode('resources/fabric-b/core/topolinks/superspine01--leaf11', 'superspine01--leaf11', {
                    namespace: 'fabric-b',
                    streamGroup: 'core',
                    resourceType: 'topolinks',
                    kind: 'TopoLink',
                    contextValue: 'stream-item',
                    statusIndicator: 'green',
                    statusDescription: 'Up'
                  })
                ]
              })
            ]
          }),
          createExplorerNode('resources/fabric-b/routing', 'routing', {
            contextValue: 'stream-group',
            children: [
              createExplorerNode('resources/fabric-b/routing/bgpneighbors', 'bgpneighbors', {
                contextValue: 'stream',
                children: [
                  createStreamResourceNode('resources/fabric-b/routing/bgpneighbors/leaf11-peer-superspine01', 'leaf11-peer-superspine01', {
                    namespace: 'fabric-b',
                    streamGroup: 'routing',
                    resourceType: 'bgpneighbors',
                    kind: 'BgpNeighbor',
                    contextValue: 'stream-item',
                    statusIndicator: 'green',
                    statusDescription: 'Established'
                  })
                ]
              })
            ]
          })
        ]
      }),
      createExplorerNode('resources/kubernetes', 'Kubernetes', {
        contextValue: 'k8s-root',
        children: [
          createExplorerNode('resources/kubernetes/eda-system', 'eda-system', {
            contextValue: 'k8s-namespace',
            children: [
              createExplorerNode('resources/kubernetes/eda-system/pods', 'pods', {
                contextValue: 'stream',
                children: [
                  createStreamResourceNode('resources/kubernetes/eda-system/pods/eda-api-6fcb99f586-r87gs', 'eda-api-6fcb99f586-r87gs', {
                    namespace: 'eda-system',
                    streamGroup: 'kubernetes',
                    resourceType: 'pods',
                    kind: 'Pod',
                    contextValue: 'pod',
                    statusIndicator: 'green',
                    statusDescription: 'Running'
                  }),
                  createStreamResourceNode('resources/kubernetes/eda-system/pods/eda-controller-6989cd4d6f-pzkm9', 'eda-controller-6989cd4d6f-pzkm9', {
                    namespace: 'eda-system',
                    streamGroup: 'kubernetes',
                    resourceType: 'pods',
                    kind: 'Pod',
                    contextValue: 'pod',
                    statusIndicator: 'green',
                    statusDescription: 'Running'
                  })
                ]
              }),
              createExplorerNode('resources/kubernetes/eda-system/deployments', 'deployments', {
                contextValue: 'stream',
                children: [
                  createStreamResourceNode('resources/kubernetes/eda-system/deployments/eda-controller', 'eda-controller', {
                    namespace: 'eda-system',
                    streamGroup: 'kubernetes',
                    resourceType: 'deployments',
                    kind: 'Deployment',
                    contextValue: 'k8s-deployment-instance',
                    statusIndicator: 'green',
                    statusDescription: 'Available'
                  })
                ]
              })
            ]
          })
        ]
      })
    ],
    [createExplorerAction('create-resource', 'Create Resource', 'vscode-eda.createResource')]
  ),
  createExplorerSection(
    'alarms',
    [
      createExplorerNode('alarms/linkdown-spine01-leaf01', 'MAJOR - Connectivity', {
        contextValue: 'eda-alarm',
        description: 'ns: fabric-a',
        statusIndicator: 'red',
        statusDescription: 'Major',
        primaryAction: createExplorerAction(
          'open-alarm-linkdown-spine01-leaf01',
          'Show Alarm Details',
          'vscode-eda.showAlarmDetails',
          [alarmFixture]
        )
      }),
      createExplorerNode('alarms/interface-down-leaf11', 'MINOR - Interface', {
        contextValue: 'eda-alarm',
        description: 'ns: fabric-b',
        statusIndicator: 'yellow',
        statusDescription: 'Minor',
        primaryAction: createExplorerAction(
          'open-alarm-interface-down-leaf11',
          'Show Alarm Details',
          'vscode-eda.showAlarmDetails',
          [alarmInterfaceFixture]
        )
      })
    ],
    []
  ),
  createExplorerSection(
    'deviations',
    [
      createExplorerNode('deviations/leaf02-bgp-hold-time', 'leaf02-bgp-hold-time', {
        contextValue: 'eda-deviation',
        description: 'ns: fabric-a (Pending)',
        statusIndicator: 'yellow',
        statusDescription: 'Drifted',
        primaryAction: createExplorerAction(
          'open-deviation-leaf02-bgp-hold-time',
          'Show Deviation Details',
          'vscode-eda.showDeviationDetails',
          [
            {
              name: 'leaf02-bgp-hold-time',
              namespace: 'fabric-a',
              kind: 'Deviation',
              apiVersion: 'routing.eda.nokia.com/v1alpha1',
              status: 'Pending',
              metadata: {
                name: 'leaf02-bgp-hold-time',
                namespace: 'fabric-a'
              }
            }
          ]
        )
      })
    ],
    [createExplorerAction('reject-all-deviations', 'Reject All Deviations', 'vscode-eda.rejectAllDeviations')]
  ),
  createExplorerSection(
    'basket',
    [
      createExplorerNode('basket/leaf01-bgp-policy', 'leaf01-bgp-policy', {
        description: 'BgpNeighbor / fabric-a',
        statusIndicator: 'blue',
        primaryAction: createExplorerAction(
          'edit-basket-leaf01-bgp-policy',
          'Edit Draft',
          'vscode-eda.basket.edit',
          ['leaf01-bgp-policy']
        )
      }),
      createExplorerNode('basket/leaf11-uplink-desc', 'leaf11-uplink-desc', {
        description: 'InterfaceConfig / fabric-b',
        statusIndicator: 'blue',
        primaryAction: createExplorerAction(
          'edit-basket-leaf11-uplink-desc',
          'Edit Draft',
          'vscode-eda.basket.edit',
          ['leaf11-uplink-desc']
        )
      })
    ],
    [
      createExplorerAction('commit-basket', 'Commit Basket', 'vscode-eda.commitBasket'),
      createExplorerAction('dry-run-basket', 'Dry Run Basket', 'vscode-eda.dryRunBasket'),
      createExplorerAction('discard-basket', 'Discard Basket', 'vscode-eda.discardBasket')
    ]
  ),
  createExplorerSection(
    'transactions',
    [
      createExplorerNode('transactions/1042', '1042 - admin', {
        contextValue: 'transaction',
        description: 'Completed - 2026-02-13T10:42:00Z',
        statusIndicator: 'green',
        statusDescription: 'Completed',
        primaryAction: createExplorerAction(
          'open-transaction-1042',
          'Show Transaction Details',
          'vscode-eda.showTransactionDetails',
          ['1042']
        )
      }),
      createExplorerNode('transactions/1041', '1041 - automation', {
        contextValue: 'transaction',
        description: 'Running - 2026-02-13T10:39:12Z',
        statusIndicator: 'yellow',
        statusDescription: 'Running',
        primaryAction: createExplorerAction(
          'open-transaction-1041',
          'Show Transaction Details',
          'vscode-eda.showTransactionDetails',
          ['1041']
        )
      })
    ],
    [createExplorerAction('set-transaction-limit', 'Set Transaction Limit', 'vscode-eda.setTransactionLimit')]
  ),
  createExplorerSection(
    'help',
    [
      createExplorerNode('help/open-docs', 'Open Documentation', {
        description: 'EDA extension usage guides',
        primaryAction: createExplorerAction(
          'open-help-docs',
          'Open Documentation',
          'vscode-eda.help.docs'
        )
      }),
      createExplorerNode('help/configure-targets', 'Configure Targets', {
        description: 'Manage API endpoints and credentials',
        primaryAction: createExplorerAction(
          'open-configure-targets',
          'Configure Targets',
          'vscode-eda.configureTargets'
        )
      })
    ],
    []
  )
];

export function createMockHost(
  webviewId: DevWebviewId,
  send: SendMessage,
  options: MockHostOptions = { previewParams: new URLSearchParams() }
): MockHost {
  const factory = mockFactoryByWebview[webviewId];
  return factory(send, options);
}

const mockFactoryByWebview: Readonly<Record<DevWebviewId, (send: SendMessage, options: MockHostOptions) => MockHost>> = {
  edaExplorer: (send) => createExplorerMock(send),
  alarmDetails: createAlarmMock,
  deviationDetails: createDeviationDetailsMock,
  nodeConfig: (send) => createNodeConfigMock(send),
  targetWizard: (send) => createTargetWizardMock(send),
  transactionDetails: createTransactionDetailsMock,
  transactionDiffs: createTransactionDiffsMock,
  fabricDashboard: (send) => createFabricDashboardMock(send),
  queriesDashboard: (send) => createQueriesDashboardMock(send),
  resourceBrowser: (send) => createResourceBrowserMock(send),
  simnodesDashboard: (send) => createDataGridMock(send, simnodesFixture),
  topologyFlowDashboard: (send) => createTopologyFlowMock(send),
  toponodesDashboard: (send) => createDataGridMock(send, toponodesFixture),
  workflowsDashboard: (send) => createWorkflowsDashboardMock(send)
};

function createExplorerMock(send: SendMessage): MockHost {
  let filterText = '';

  const sendSnapshot = (): void => {
    send({
      command: 'snapshot',
      filterText,
      sections: buildExplorerSections(filterText)
    });
  };

  const handleSetFilter = (value: unknown): void => {
    if (typeof value !== 'string') {
      return;
    }

    filterText = value;
    send({ command: 'filterState', filterText });

    try {
      sendSnapshot();
    } catch {
      send({ command: 'error', message: 'Invalid regular expression for filter.' });
    }
  };

  const handleInvokeCommand = (commandId: unknown, args: unknown): void => {
    if (typeof commandId !== 'string') {
      return;
    }

    const commandHandlers: Record<string, (value: unknown) => void> = {
      'vscode-eda.showDashboard': (value) => {
        const dashboardName = firstStringArgument(value);
        const previewWebview = dashboardName ? DASHBOARD_PREVIEW_BY_NAME[dashboardName] : undefined;
        if (previewWebview) {
          notifyParentToOpenPreview(previewWebview);
        }
      },
      'vscode-eda.showAlarmDetails': (value) => {
        const alarm = firstObjectArgument(value);
        const alarmName = stringField(alarm, 'name');
        notifyParentToOpenPreview('alarmDetails', alarmName ? { alarm: alarmName } : undefined);
      },
      'vscode-eda.showDeviationDetails': (value) => {
        const deviation = firstObjectArgument(value);
        const key = buildDeviationKey(deviation);
        notifyParentToOpenPreview('deviationDetails', key ? { deviation: key } : undefined);
      },
      'vscode-eda.showTransactionDetails': (value) => {
        const transactionId = firstStringArgument(value);
        notifyParentToOpenPreview('transactionDetails', transactionId ? { transactionId } : undefined);
      },
      'vscode-eda.viewStreamItem': () => {
        notifyParentToOpenPreview('resourceBrowser');
      },
      'vscode-eda.configureTargets': () => {
        notifyParentToOpenPreview('targetWizard');
      }
    };

    const handler = commandHandlers[commandId];
    if (handler) {
      handler(args);
    }
  };

  return {
    onMessage: (message) => {
      switch (message.command) {
        case 'ready':
        case 'requestRefresh':
          sendSnapshot();
          return;
        case 'setFilter':
          handleSetFilter(message.value);
          return;
        case 'invokeCommand':
          handleInvokeCommand(message.commandId, message.args);
          return;
        default:
          return;
      }
    },
    dispose: () => {}
  };
}

function createAlarmMock(send: SendMessage, options: MockHostOptions): MockHost {
  const alarmName = options.previewParams.get('alarm');
  const alarmData = alarmName ? alarmFixtureByName[alarmName] ?? alarmFixture : alarmFixture;

  return {
    onMessage: (message) => {
      if (message.command === 'ready') {
        send({ command: 'init', data: alarmData });
      }
    },
    dispose: () => {}
  };
}

function createDeviationDetailsMock(send: SendMessage, options: MockHostOptions): MockHost {
  const deviationKey = options.previewParams.get('deviation') ?? DEV_DEVIATION_KEY;
  const details = deviationDetailsFixtureByKey[deviationKey] ?? deviationDetailsFixtureByKey[DEV_DEVIATION_KEY];

  return {
    onMessage: (message) => {
      if (message.command === 'ready') {
        send({ command: 'init', data: details });
      }
    },
    dispose: () => {}
  };
}

function createNodeConfigMock(send: SendMessage): MockHost {
  let colorMode: 'full' | 'less' | 'none' = 'full';

  return {
    onMessage: (message) => {
      if (message.command === 'ready') {
        send({
          command: 'loadData',
          config: nodeConfigFixtureText,
          annotations: nodeConfigFixtureAnnotations,
          colorMode
        });
      }

      if (message.command === 'saveColorMode') {
        const nextMode = message.colorMode;
        if (nextMode === 'full' || nextMode === 'less' || nextMode === 'none') {
          colorMode = nextMode;
        }
      }
    },
    dispose: () => {}
  };
}

function createTargetWizardMock(send: SendMessage): MockHost {
  let selectedIndex = 0;
  let targets = [...targetFixture];

  return {
    onMessage: (message) => {
      if (message.command === 'ready') {
        sendTargetInit(send, targets, selectedIndex);
      }

      if (message.command === 'select' && typeof message.index === 'number') {
        selectedIndex = message.index;
      }

      if (message.command === 'confirmDelete' && typeof message.index === 'number') {
        targets = targets.filter((_, index) => index !== message.index);
        selectedIndex = Math.max(0, Math.min(selectedIndex, targets.length - 1));
        send({ command: 'deleteConfirmed', index: message.index });
      }

      if (message.command === 'retrieveClientSecret') {
        send({ command: 'clientSecretRetrieved', clientSecret: DEFAULT_CLIENT_SECRET });
      }

      if (message.command === 'commit' && Array.isArray(message.targets)) {
        const normalizedTargets = message.targets.filter(isTargetRecord);
        if (normalizedTargets.length > 0) {
          targets = normalizedTargets;
        }
      }
    },
    dispose: () => {}
  };
}

function createTransactionDetailsMock(send: SendMessage, options: MockHostOptions): MockHost {
  const transactionId = options.previewParams.get('transactionId') ?? transactionDetailsFixture.id;
  const data = transactionDetailsFixtureById[transactionId] ?? transactionDetailsFixture;
  const effectiveTransactionId = String(data.id ?? transactionId);

  return {
    onMessage: (message) => {
      if (message.command === 'ready') {
        send({ command: 'init', data });
        return;
      }

      if (message.command === 'showDiffs') {
        notifyParentToOpenPreview('transactionDiffs', { transactionId: effectiveTransactionId });
      }
    },
    dispose: () => {}
  };
}

function createTransactionDiffsMock(send: SendMessage, options: MockHostOptions): MockHost {
  const transactionId = options.previewParams.get('transactionId') ?? transactionDetailsFixture.id;
  const diffsFixture = transactionDiffListFixtureById[transactionId] ?? transactionDiffListFixture;

  return {
    onMessage: (message) => {
      if (message.command === 'ready') {
        send({
          command: 'diffs',
          diffs: diffsFixture.diffs,
          nodes: diffsFixture.nodes
        });
      }

      if (message.command === 'loadDiff' && typeof message.resource === 'object' && message.resource !== null) {
        const payload = resolveDiffPayload(message.resource as DiffResource);
        if (payload) {
          send({ command: 'diff', diff: payload, resource: message.resource as Record<string, unknown> });
        } else {
          send({ command: 'error', message: 'No preview diff fixture available for this resource.' });
        }
      }
    },
    dispose: () => {}
  };
}

function createFabricDashboardMock(send: SendMessage): MockHost {
  let selectedNamespace = ALL_NAMESPACES;
  let tick = 0;

  const sendSnapshot = (): void => {
    const snapshot = fabricSnapshotByNamespace[selectedNamespace] ?? fabricSnapshotByNamespace[ALL_NAMESPACES];
    send({ command: 'topoNodeStats', stats: snapshot.topoNodeStats });
    send({ command: 'interfaceStats', stats: snapshot.interfaceStats });
    send({ command: 'fabricHealth', health: snapshot.fabricHealth });
    send({ command: 'fabricSpineStats', stats: snapshot.spineStats });
    send({ command: 'fabricLeafStats', stats: snapshot.leafStats });
    send({ command: 'fabricBorderLeafStats', stats: snapshot.borderLeafStats });
    send({ command: 'fabricSuperSpineStats', stats: snapshot.superSpineStats });
  };

  const sendTraffic = (): void => {
    tick += 1;
    const snapshot = fabricSnapshotByNamespace[selectedNamespace] ?? fabricSnapshotByNamespace[ALL_NAMESPACES];
    const wave = Math.sin(tick / 3);
    send({
      command: 'trafficStats',
      stats: {
        in: Math.max(0, Math.round(snapshot.trafficBaseIn * (1 + wave * 0.08))),
        out: Math.max(0, Math.round(snapshot.trafficBaseOut * (1 - wave * 0.06)))
      }
    });
  };

  const timerId = window.setInterval(sendTraffic, 1_500);

  return {
    onMessage: (message) => {
      if (message.command === 'ready') {
        send({
          command: 'init',
          namespaces: DEFAULT_NAMESPACES,
          selected: selectedNamespace
        });
        sendSnapshot();
        sendTraffic();
      }

      if (message.command === 'getTopoNodeStats') {
        if (typeof message.namespace === 'string' && fabricSnapshotByNamespace[message.namespace]) {
          selectedNamespace = message.namespace;
        } else {
          selectedNamespace = ALL_NAMESPACES;
        }
        sendSnapshot();
        sendTraffic();
      }
    },
    dispose: () => {
      window.clearInterval(timerId);
    }
  };
}

function createQueriesDashboardMock(send: SendMessage): MockHost {
  const timeoutIds = new Set<number>();

  const schedule = (callback: () => void): void => {
    const timeoutId = window.setTimeout(() => {
      timeoutIds.delete(timeoutId);
      callback();
    }, 120);
    timeoutIds.add(timeoutId);
  };

  return {
    onMessage: (message) => {
      if (message.command === 'ready') {
        send({
          command: 'init',
          namespaces: DEFAULT_NAMESPACES,
          selected: ALL_NAMESPACES
        });
        const initialResults = buildQueryResults('', 'eql');
        send({ command: 'results', ...initialResults });
      }

      if (message.command === 'autocomplete') {
        const query = String(message.query ?? '');
        const list = query.startsWith('.')
          ? ['.namespace.resources.toponodes', '.namespace.resources.topolinks', '.namespace.resources.interfaces']
          : [];
        send({ command: 'autocomplete', list });
      }

      if (message.command === 'runQuery') {
        const queryType = String(message.queryType ?? 'eql');
        const query = String(message.query ?? '');

        send({ command: 'clear' });

        if (queryType === 'nql') {
          send({
            command: 'convertedQuery',
            eqlQuery: '.namespace.resources.toponodes | where status=="Ready"',
            queryType: 'nql',
            description: 'Converted from natural-language intent for ready nodes.'
          });
        }

        if (queryType === 'emb') {
          send({
            command: 'convertedQuery',
            eqlQuery: '.namespace.resources.topolinks | where state=="down"',
            queryType: 'emb',
            description: 'Top embedding match for unstable links.',
            alternatives: [
              {
                query: '.namespace.resources.toponodes | where sync=="Drifted"',
                description: 'Find nodes with config drift.',
                score: 0.87
              },
              {
                query: '.namespace.resources.interfaces | where operationalState=="down"',
                description: 'Find down interfaces.',
                score: 0.82
              }
            ]
          });
        }

        schedule(() => {
          const results = buildQueryResults(query, queryType);
          send({ command: 'results', ...results });
        });
      }
    },
    dispose: () => {
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
      timeoutIds.clear();
    }
  };
}

function createResourceBrowserMock(send: SendMessage): MockHost {
  return {
    onMessage: (message) => {
      if (message.command === 'ready') {
        send({
          command: 'resources',
          list: resourceDefinitions,
          selected: resourceDefinitions[0].name
        });
      }

      if (message.command === 'showResource' && typeof message.name === 'string') {
        const resourceData = resourceDataByName[message.name];
        if (resourceData) {
          send({
            command: 'resourceData',
            kind: resourceData.kind,
            description: resourceData.description,
            yaml: resourceData.yaml,
            schema: resourceData.schema
          });
        }
      }
    },
    dispose: () => {}
  };
}

function createDataGridMock(send: SendMessage, fixture: DataGridFixture): MockHost {
  let selectedNamespace = ALL_NAMESPACES;

  const sendResults = (): void => {
    const rows = resolveFixtureRows(fixture, selectedNamespace);
    send({
      command: 'results',
      columns: fixture.columns,
      rows,
      status: `Count: ${rows.length}`,
      hasKubernetesContext: true
    });
  };

  return {
    onMessage: (message) => {
      if (message.command === 'ready') {
        send({
          command: 'init',
          namespaces: DEFAULT_NAMESPACES,
          selected: selectedNamespace,
          hasKubernetesContext: true
        });
        sendResults();
      }

      if (message.command === 'setNamespace') {
        if (typeof message.namespace === 'string' && (DEFAULT_NAMESPACES as string[]).includes(message.namespace)) {
          selectedNamespace = message.namespace;
        } else {
          selectedNamespace = ALL_NAMESPACES;
        }
        sendResults();
      }
    },
    dispose: () => {}
  };
}

function createWorkflowsDashboardMock(send: SendMessage): MockHost {
  let selectedNamespace = ALL_NAMESPACES;
  let createdCounter = 1;
  const rowsByNamespace: Record<string, unknown[][]> = {};

  for (const [namespace, rows] of Object.entries(workflowsFixture.rowsByNamespace)) {
    rowsByNamespace[namespace] = rows.map(row => [...row]);
  }

  const getRows = (namespace: string): unknown[][] => {
    if (namespace === ALL_NAMESPACES) {
      return Object.values(rowsByNamespace)
        .flatMap(rows => rows)
        .map(row => [...row]);
    }
    return (rowsByNamespace[namespace] ?? []).map(row => [...row]);
  };

  const sendResults = (): void => {
    const rows = getRows(selectedNamespace);
    send({
      command: 'results',
      columns: workflowsFixture.columns,
      rows,
      status: `Count: ${rows.length}`,
      hasKubernetesContext: true
    });
  };

  const nextWorkflowName = (): string => {
    const name = `workflow-${String(createdCounter).padStart(3, '0')}`;
    createdCounter += 1;
    return name;
  };

  const applySelectedNamespace = (value: unknown): void => {
    if (typeof value === 'string' && (DEFAULT_NAMESPACES as string[]).includes(value)) {
      selectedNamespace = value;
      return;
    }
    selectedNamespace = ALL_NAMESPACES;
  };

  const resolveCreateTargetNamespace = (value: unknown): string => {
    if (typeof value === 'string' && value !== ALL_NAMESPACES) {
      return value;
    }
    if (selectedNamespace !== ALL_NAMESPACES) {
      return selectedNamespace;
    }
    return 'fabric-a';
  };

  const addCreatedWorkflowRow = (value: unknown): void => {
    const targetNamespace = resolveCreateTargetNamespace(value);
    const row: unknown[] = [
      nextWorkflowName(),
      targetNamespace,
      'oam-ping-gvk',
      'Running',
      new Date().toISOString()
    ];

    if (!rowsByNamespace[targetNamespace]) {
      rowsByNamespace[targetNamespace] = [];
    }
    rowsByNamespace[targetNamespace].unshift(row);
  };

  return {
    onMessage: (message) => {
      switch (message.command) {
        case 'ready':
          send({
            command: 'init',
            namespaces: DEFAULT_NAMESPACES,
            selected: selectedNamespace,
            hasKubernetesContext: true
          });
          sendResults();
          break;
        case 'setNamespace':
          applySelectedNamespace(message.namespace);
          sendResults();
          break;
        case 'createWorkflow':
          addCreatedWorkflowRow(message.namespace);
          sendResults();
          break;
      }
    },
    dispose: () => {}
  };
}

function createTopologyFlowMock(send: SendMessage): MockHost {
  let selectedNamespace = ALL_NAMESPACES;

  const sendData = (): void => {
    const fixture = topologyFixtureByNamespace[selectedNamespace] ?? topologyFixtureByNamespace[ALL_NAMESPACES];
    send({ command: 'data', nodes: fixture.nodes, edges: fixture.edges });
  };

  return {
    onMessage: (message) => {
      if (message.command === 'ready') {
        send({
          command: 'init',
          namespaces: DEFAULT_NAMESPACES,
          selected: selectedNamespace
        });
        sendData();
      }

      if (message.command === 'setNamespace') {
        if (typeof message.namespace === 'string' && topologyFixtureByNamespace[message.namespace]) {
          selectedNamespace = message.namespace;
        } else {
          selectedNamespace = ALL_NAMESPACES;
        }
        sendData();
      }
    },
    dispose: () => {}
  };
}

function sendTargetInit(send: SendMessage, targets: TargetRecord[], selected: number): void {
  send({
    command: 'init',
    targets,
    selected,
    contexts: ['cluster-fabric-a', 'cluster-fabric-b', 'kind-dev']
  });
}

function resolveDiffPayload(resource: DiffResource): { before: { data: string }; after: { data: string } } | null {
  const type = resource.type === 'node' ? 'node' : 'resource';
  const name = resource.name;
  if (!name) {
    return null;
  }
  const key = `${type}:${name}`;
  return transactionDiffPayloads[key] ?? null;
}

function buildQueryResults(query: string, queryType: string): QueryResults {
  const baseColumns = ['name', 'namespace', 'kind', 'state', 'updatedAt'];
  const timestamp = '2026-02-13T12:00:00Z';

  if (queryType === 'nql') {
    return {
      columns: baseColumns,
      rows: [
        ['leaf01', 'fabric-a', 'TopoNode', 'Ready', timestamp],
        ['leaf11', 'fabric-b', 'TopoNode', 'Ready', timestamp],
        ['spine01', 'fabric-a', 'TopoNode', 'Ready', timestamp]
      ],
      status: 'Count: 3'
    };
  }

  if (queryType === 'emb') {
    return {
      columns: baseColumns,
      rows: [
        ['link-spine01-leaf01', 'fabric-a', 'TopoLink', 'down', timestamp],
        ['link-superspine01-leaf11', 'fabric-b', 'TopoLink', 'up', timestamp]
      ],
      status: 'Count: 2'
    };
  }

  if (query.toLowerCase().includes('interface')) {
    return {
      columns: ['name', 'namespace', 'node', 'operationalState', 'speed'],
      rows: [
        ['ethernet-1/1', 'fabric-a', 'spine01', 'up', '100G'],
        ['ethernet-1/49', 'fabric-a', 'leaf01', 'down', '100G'],
        ['ethernet-1/53', 'fabric-b', 'leaf11', 'up', '100G']
      ],
      status: 'Count: 3'
    };
  }

  return {
    columns: baseColumns,
    rows: [
      ['spine01', 'fabric-a', 'TopoNode', 'Ready', timestamp],
      ['leaf01', 'fabric-a', 'TopoNode', 'Warning', timestamp],
      ['leaf11', 'fabric-b', 'TopoNode', 'Ready', timestamp]
    ],
    status: 'Count: 3'
  };
}

function resolveFixtureRows(fixture: DataGridFixture, namespace: string): unknown[][] {
  if (namespace === ALL_NAMESPACES) {
    return Object.values(fixture.rowsByNamespace)
      .flatMap(rows => rows)
      .map(row => [...row]);
  }

  return [...(fixture.rowsByNamespace[namespace] ?? [])].map(row => [...row]);
}

function isTargetRecord(value: unknown): value is TargetRecord {
  return Boolean(value) && typeof value === 'object' && typeof (value as Record<string, unknown>).url === 'string';
}

function createTopologyNode(
  id: string,
  label: string,
  tier: number,
  role: string,
  namespace: string,
  nodeAddress: string
): Record<string, unknown> {
  return {
    id,
    label,
    tier,
    role,
    raw: {
      metadata: {
        name: label,
        namespace,
        labels: {
          role
        }
      },
      spec: {
        operatingSystem: 'srl',
        platform: '7220 IXR-D3',
        version: '24.7.1',
        productionAddress: {
          ipv4: nodeAddress
        }
      },
      status: {
        status: 'Ready',
        sync: 'InSync',
        'node-state': 'Up',
        'npp-state': 'Up',
        'node-details': nodeAddress
      }
    }
  };
}

function createTopologyEdge(
  source: string,
  target: string,
  sourceInterface: string,
  targetInterface: string
): Record<string, unknown> {
  const sourceParts = source.split('/');
  const targetParts = target.split('/');
  const sourceNode = sourceParts[sourceParts.length - 1] || source;
  const targetNode = targetParts[targetParts.length - 1] || target;

  return {
    source,
    target,
    sourceInterface,
    targetInterface,
    sourceState: 'up',
    targetState: 'up',
    state: 'up',
    raw: {
      local: {
        node: sourceNode,
        interface: sourceInterface
      },
      remote: {
        node: targetNode,
        interface: targetInterface
      }
    },
    rawResource: {
      spec: {
        type: 'fabric'
      },
      status: {
        operationalState: 'up'
      }
    }
  };
}

function createExplorerAction(id: string, label: string, command: string, args?: unknown[]): ExplorerAction {
  if (!args) {
    return { id, label, command };
  }

  return { id, label, command, args };
}

interface ExplorerNodeOptions {
  description?: string;
  tooltip?: string;
  contextValue?: string;
  statusIndicator?: string;
  statusDescription?: string;
  primaryAction?: ExplorerAction;
  actions?: ExplorerAction[];
  children?: ExplorerNode[];
}

function createExplorerNode(id: string, label: string, options: ExplorerNodeOptions = {}): ExplorerNode {
  return {
    id,
    label,
    description: options.description,
    tooltip: options.tooltip,
    contextValue: options.contextValue,
    statusIndicator: options.statusIndicator,
    statusDescription: options.statusDescription,
    primaryAction: options.primaryAction,
    actions: options.actions ?? (options.primaryAction ? [options.primaryAction] : []),
    children: options.children ?? []
  };
}

interface StreamResourceNodeOptions {
  namespace: string;
  streamGroup: string;
  resourceType: string;
  kind: string;
  contextValue: string;
  statusIndicator: string;
  statusDescription: string;
}

function createStreamResourceNode(id: string, label: string, options: StreamResourceNodeOptions): ExplorerNode {
  return createExplorerNode(id, label, {
    contextValue: options.contextValue,
    statusIndicator: options.statusIndicator,
    statusDescription: options.statusDescription,
    primaryAction: createExplorerAction(
      `open-resource-${id}`,
      'View Stream Item',
      'vscode-eda.viewStreamItem',
      [createMockResourceCommandArgument(label, options)]
    )
  });
}

function createMockResourceCommandArgument(
  label: string,
  options: StreamResourceNodeOptions
): Record<string, unknown> {
  const raw = {
    apiVersion: inferApiVersion(options.kind),
    kind: options.kind,
    metadata: {
      name: label,
      namespace: options.namespace
    }
  };

  return {
    label,
    name: label,
    namespace: options.namespace,
    resourceType: options.resourceType,
    streamGroup: options.streamGroup,
    contextValue: options.contextValue,
    kind: options.kind,
    resource: {
      name: label,
      namespace: options.namespace,
      resourceType: options.resourceType,
      streamGroup: options.streamGroup,
      kind: options.kind,
      raw
    },
    rawResource: raw
  };
}

function inferApiVersion(kind: string): string {
  if (kind === 'TopoNode' || kind === 'TopoLink') {
    return 'core.eda.nokia.com/v1';
  }

  if (kind === 'BgpNeighbor') {
    return 'routing.eda.nokia.com/v1alpha1';
  }

  if (kind === 'Pod' || kind === 'Deployment') {
    return 'v1';
  }

  return 'v1';
}

function createExplorerSection(
  id: ExplorerTabId,
  nodes: ExplorerNode[],
  toolbarActions: ExplorerAction[]
): ExplorerSectionSnapshot {
  return {
    id,
    label: EXPLORER_TAB_LABELS[id],
    count: countExplorerLeafNodes(nodes),
    nodes,
    toolbarActions
  };
}

function buildExplorerSections(filterText: string): ExplorerSectionSnapshot[] {
  const trimmedFilter = filterText.trim();
  const sections = explorerSectionsFixture.map(cloneExplorerSection);

  if (trimmedFilter.length === 0) {
    return sections;
  }

  let matcher: RegExp;
  try {
    matcher = new RegExp(trimmedFilter, 'i');
  } catch {
    throw new Error('invalid-regex');
  }

  return sections.map(section => {
    const nodes = filterExplorerNodes(section.nodes, matcher);
    return {
      ...section,
      nodes,
      count: countExplorerLeafNodes(nodes)
    };
  });
}

function cloneExplorerSection(section: ExplorerSectionSnapshot): ExplorerSectionSnapshot {
  return {
    ...section,
    nodes: cloneExplorerNodes(section.nodes),
    toolbarActions: section.toolbarActions.map(action => ({ ...action }))
  };
}

function cloneExplorerNodes(nodes: ExplorerNode[]): ExplorerNode[] {
  return nodes.map(node => ({
    ...node,
    primaryAction: node.primaryAction ? { ...node.primaryAction } : undefined,
    actions: node.actions.map(action => ({ ...action })),
    children: cloneExplorerNodes(node.children)
  }));
}

function filterExplorerNodes(nodes: ExplorerNode[], matcher: RegExp): ExplorerNode[] {
  return nodes.flatMap(node => {
    const filteredChildren = filterExplorerNodes(node.children, matcher);
    const matchesSelf = matcher.test(node.label)
      || matcher.test(node.description ?? '')
      || matcher.test(node.tooltip ?? '')
      || matcher.test(node.statusDescription ?? '');

    if (!matchesSelf && filteredChildren.length === 0) {
      return [];
    }

    return [{ ...node, children: filteredChildren }];
  });
}

function countExplorerLeafNodes(nodes: ExplorerNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.children.length === 0) {
      return count + 1;
    }
    return count + countExplorerLeafNodes(node.children);
  }, 0);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function firstStringArgument(args: unknown): string | null {
  if (!isUnknownArray(args) || args.length === 0) {
    return null;
  }

  return typeof args[0] === 'string' ? args[0] : null;
}

function firstObjectArgument(args: unknown): Record<string, unknown> | null {
  if (!isUnknownArray(args) || args.length === 0) {
    return null;
  }

  const value = args[0];
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function stringField(value: Record<string, unknown> | null, field: string): string | null {
  if (!value) {
    return null;
  }

  const fieldValue = value[field];
  return typeof fieldValue === 'string' ? fieldValue : null;
}

function buildDeviationKey(value: Record<string, unknown> | null): string | null {
  if (!value) {
    return null;
  }

  const name = stringField(value, 'name')
    ?? stringField((value.metadata as Record<string, unknown> | undefined) ?? null, 'name');
  const namespace = stringField(value, 'namespace')
    ?? stringField((value.metadata as Record<string, unknown> | undefined) ?? null, 'namespace');

  if (!name || !namespace) {
    return null;
  }

  return `${namespace}/${name}`;
}

function notifyParentToOpenPreview(webviewId: DevPreviewWebviewId, params?: Record<string, string>): void {
  window.parent.postMessage(
    {
      source: OPEN_PREVIEW_EVENT_SOURCE,
      command: 'openPreview',
      webview: webviewId,
      params
    },
    window.location.origin
  );
}

function stringifyFixture(value: unknown): string { return JSON.stringify(value, null, 2); }
