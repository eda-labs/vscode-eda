// Helper type for node/link data
export interface NodeData {
  metadata?: { name?: string; labels?: Record<string, string> };
  status?: Record<string, unknown>;
  spec?: Record<string, unknown>;
}

export interface LinkData {
  local?: { node?: string; interface?: string };
  remote?: { node?: string; interface?: string };
  type?: string;
  state?: string;
  sourceState?: string;
  targetState?: string;
  rawResource?: unknown;
}

// Helper to build info table row
function buildInfoRow(label: string, value: string | undefined): string {
  return value ? `<tr><td>${label}</td><td>${value}</td></tr>` : '';
}

// Helper to build section header
function buildSectionRow(title: string): string {
  return `<tr class="section"><td colspan="2">${title}</td></tr>`;
}

// Helper to safely get nested property with fallback
function getNestedProp(
  obj: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const val = obj?.[key];
    if (val !== undefined) return String(val);
  }
  return undefined;
}

// Helper to get property from spec or status
function getSpecOrStatus(
  spec: Record<string, unknown> | undefined,
  status: Record<string, unknown> | undefined,
  key: string
): string {
  return (spec?.[key] ?? status?.[key] ?? '') as string;
}

// Extract node metadata for display
function extractNodeMetadata(data: NodeData): { name: string; labels: string } {
  const name = data?.metadata?.name ?? '';
  const labelsObj = data?.metadata?.labels ?? {};
  const labels = Object.keys(labelsObj)
    .map(k => `${k}: ${String(labelsObj[k])}`)
    .join('<br>');
  return { name, labels };
}

// Extract node status fields
function extractNodeStatusFields(
  status: Record<string, unknown> | undefined,
  spec: Record<string, unknown> | undefined
): Record<string, string | undefined> {
  const productionAddr = spec?.productionAddress as Record<string, unknown> | undefined;
  return {
    statusVal: getNestedProp(status, 'status'),
    sync: getNestedProp(status, 'sync'),
    nodeDetails: getNestedProp(status, 'node-details') ?? getNestedProp(productionAddr, 'ipv4'),
    nodeState: getNestedProp(status, 'node-state', 'nodeState'),
    nppState: getNestedProp(status, 'npp-state', 'nppState'),
    os: getSpecOrStatus(spec, status, 'operatingSystem'),
    platform: getSpecOrStatus(spec, status, 'platform'),
    version: getSpecOrStatus(spec, status, 'version')
  };
}

// Extract node info for display
export function extractNodeInfo(data: NodeData): string {
  const { name, labels } = extractNodeMetadata(data);
  const status = data?.status as Record<string, unknown> | undefined;
  const spec = data?.spec as Record<string, unknown> | undefined;
  const fields = extractNodeStatusFields(status, spec);

  return `
    <h3><span class="codicon codicon-server-environment"></span> <a href="#" class="node-link">${name}</a></h3>
    <table class="info-table">
      ${buildInfoRow('Labels', labels)}
      ${buildInfoRow('Status', fields.statusVal)}
      ${buildInfoRow('Sync', fields.sync)}
      ${buildInfoRow('Node Details', fields.nodeDetails)}
      ${buildInfoRow('Node State', fields.nodeState)}
      ${buildInfoRow('NPP State', fields.nppState)}
      ${buildInfoRow('Operating System', fields.os)}
      ${buildInfoRow('Platform', fields.platform)}
      ${buildInfoRow('Version', fields.version)}
    </table>
  `;
}

// Extract link info for display
export function extractLinkInfo(data: LinkData): string {
  const local = data?.local;
  const remote = data?.remote;

  return `
    <h3><span class="codicon codicon-plug"></span> <a href="#" class="link-resource">${local?.node ?? ''} \u2192 ${remote?.node ?? ''}</a></h3>
    <table class="info-table">
      ${buildInfoRow('Type', data?.type)}
      ${buildInfoRow('State', data?.state)}
      ${buildSectionRow('Local Endpoint')}
      ${buildInfoRow('State', data?.sourceState)}
      ${buildInfoRow('Interface', local?.interface)}
      ${buildSectionRow('Remote Endpoint')}
      ${buildInfoRow('State', data?.targetState)}
      ${buildInfoRow('Interface', remote?.interface)}
    </table>
  `;
}

export function shortenInterfaceName(name: string | undefined): string {
  if (!name) return '';
  return name.replace(/ethernet-/gi, 'e-');
}
