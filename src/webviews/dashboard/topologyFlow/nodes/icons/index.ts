import CloudIcon from '@mui/icons-material/Cloud';
import DeviceHubIcon from '@mui/icons-material/DeviceHub';
import DnsIcon from '@mui/icons-material/Dns';
import HubIcon from '@mui/icons-material/Hub';
import LanIcon from '@mui/icons-material/Lan';
import MemoryIcon from '@mui/icons-material/Memory';
import RouterIcon from '@mui/icons-material/Router';
import SecurityIcon from '@mui/icons-material/Security';
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet';
import StorageIcon from '@mui/icons-material/Storage';
import TerminalIcon from '@mui/icons-material/Terminal';

type NodeIconComponent = typeof DnsIcon;
export type NodeIconKey =
  | 'spine'
  | 'leaf'
  | 'borderleaf'
  | 'superspine'
  | 'switch'
  | 'server'
  | 'firewall'
  | 'cloud'
  | 'lan'
  | 'terminal'
  | 'memory'
  | 'default';

export const nodeIcons: Record<NodeIconKey, NodeIconComponent> = {
  spine: HubIcon,
  leaf: DeviceHubIcon,
  borderleaf: RouterIcon,
  superspine: HubIcon,
  switch: SettingsEthernetIcon,
  server: StorageIcon,
  firewall: SecurityIcon,
  cloud: CloudIcon,
  lan: LanIcon,
  terminal: TerminalIcon,
  memory: MemoryIcon,
  default: DnsIcon,
};

const NODE_ICON_LABELS: Record<NodeIconKey, string> = {
  default: 'Default',
  spine: 'Spine',
  superspine: 'Super Spine',
  leaf: 'Leaf',
  borderleaf: 'Border Leaf',
  switch: 'Switch',
  server: 'Server',
  firewall: 'Firewall',
  cloud: 'Cloud',
  lan: 'LAN',
  terminal: 'Terminal',
  memory: 'Memory'
};

export const NODE_ICON_OPTIONS: ReadonlyArray<{ value: NodeIconKey; label: string }> = (
  Object.keys(NODE_ICON_LABELS) as NodeIconKey[]
).map((value) => ({
  value,
  label: NODE_ICON_LABELS[value]
}));

// Material icon path data used for SVG export so icons remain visible in exported files.
const NODE_ICON_PATHS: Record<NodeIconKey, readonly string[]> = {
  spine: [
    'M8.4 18.2c.38.5.6 1.12.6 1.8 0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3c.44 0 .85.09 1.23.26l1.41-1.77c-.92-1.03-1.29-2.39-1.09-3.69l-2.03-.68c-.54.83-1.46 1.38-2.52 1.38-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3c0 .07 0 .14-.01.21l2.03.68c.64-1.21 1.82-2.09 3.22-2.32V5.91C9.96 5.57 9 4.4 9 3c0-1.66 1.34-3 3-3s3 1.34 3 3c0 1.4-.96 2.57-2.25 2.91v2.16c1.4.23 2.58 1.11 3.22 2.32L18 9.71V9.5c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3c-1.06 0-1.98-.55-2.52-1.37l-2.03.68c.2 1.29-.16 2.65-1.09 3.69l1.41 1.77Q17.34 17 18 17c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3c0-.68.22-1.3.6-1.8l-1.41-1.77c-1.35.75-3.01.76-4.37 0z'
  ],
  superspine: [
    'M8.4 18.2c.38.5.6 1.12.6 1.8 0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3c.44 0 .85.09 1.23.26l1.41-1.77c-.92-1.03-1.29-2.39-1.09-3.69l-2.03-.68c-.54.83-1.46 1.38-2.52 1.38-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3c0 .07 0 .14-.01.21l2.03.68c.64-1.21 1.82-2.09 3.22-2.32V5.91C9.96 5.57 9 4.4 9 3c0-1.66 1.34-3 3-3s3 1.34 3 3c0 1.4-.96 2.57-2.25 2.91v2.16c1.4.23 2.58 1.11 3.22 2.32L18 9.71V9.5c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3c-1.06 0-1.98-.55-2.52-1.37l-2.03.68c.2 1.29-.16 2.65-1.09 3.69l1.41 1.77Q17.34 17 18 17c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3c0-.68.22-1.3.6-1.8l-1.41-1.77c-1.35.75-3.01.76-4.37 0z'
  ],
  leaf: ['m17 16-4-4V8.82C14.16 8.4 15 7.3 15 6c0-1.66-1.34-3-3-3S9 4.34 9 6c0 1.3.84 2.4 2 2.82V12l-4 4H3v5h5v-3.05l4-4.2 4 4.2V21h5v-5z'],
  borderleaf: ['m20.2 5.9.8-.8C19.6 3.7 17.8 3 16 3s-3.6.7-5 2.1l.8.8C13 4.8 14.5 4.2 16 4.2s3 .6 4.2 1.7m-.9.8c-.9-.9-2.1-1.4-3.3-1.4s-2.4.5-3.3 1.4l.8.8c.7-.7 1.6-1 2.5-1s1.8.3 2.5 1zM19 13h-2V9h-2v4H5c-1.1 0-2 .9-2 2v4c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-4c0-1.1-.9-2-2-2M8 18H6v-2h2zm3.5 0h-2v-2h2zm3.5 0h-2v-2h2z'],
  switch: ['M7.77 6.76 6.23 5.48.82 12l5.41 6.52 1.54-1.28L3.42 12zM7 13h2v-2H7zm10-2h-2v2h2zm-6 2h2v-2h-2zm6.77-7.52-1.54 1.28L20.58 12l-4.35 5.24 1.54 1.28L23.18 12z'],
  server: ['M2 20h20v-4H2zm2-3h2v2H4zM2 4v4h20V4zm4 3H4V5h2zm-4 7h20v-4H2zm2-3h2v2H4z'],
  firewall: ['M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11z'],
  cloud: ['M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96'],
  lan: ['M13 22h8v-7h-3v-4h-5V9h3V2H8v7h3v2H6v4H3v7h8v-7H8v-2h8v2h-3z'],
  terminal: ['M20 4H4c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.89-2-2-2m0 14H4V8h16zm-2-1h-6v-2h6zM7.5 17l-1.41-1.41L8.67 13l-2.59-2.59L7.5 9l4 4z'],
  memory: ['M15 9H9v6h6zm-2 4h-2v-2h2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2zm-4 6H7V7h10z'],
  default: ['M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1M7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2M20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1M7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2']
};

function normalizeNodeIconKey(value: string | undefined): NodeIconKey | null {
  if (!value) {
    return null;
  }
  const key = value.trim().toLowerCase() as NodeIconKey;
  return key in nodeIcons ? key : null;
}

export function resolveNodeIconKey(iconKey: string | undefined, role: string | undefined): NodeIconKey {
  const normalizedIconKey = normalizeNodeIconKey(iconKey);
  if (normalizedIconKey !== null) {
    return normalizedIconKey;
  }

  const normalizedRole = normalizeNodeIconKey(role);
  return normalizedRole ?? 'default';
}

export function getNodeIconForNode(iconKey: string | undefined, role: string | undefined): NodeIconComponent {
  return nodeIcons[resolveNodeIconKey(iconKey, role)];
}

export function getNodeIconByKey(iconKey: NodeIconKey): NodeIconComponent {
  return nodeIcons[iconKey];
}

export function getNodeIcon(role: string | undefined): NodeIconComponent {
  return getNodeIconForNode(undefined, role);
}

export function getNodeIconSvgPathDataForNode(iconKey: string | undefined, role: string | undefined): readonly string[] {
  return NODE_ICON_PATHS[resolveNodeIconKey(iconKey, role)];
}

export function getNodeIconSvgPathData(role: string | undefined): readonly string[] {
  return getNodeIconSvgPathDataForNode(undefined, role);
}

export function getNodeRoleMonogram(role: string | undefined): string {
  if (!role) {
    return 'N';
  }

  return role.trim().charAt(0).toUpperCase() || 'N';
}
