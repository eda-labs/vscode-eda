import DeviceHubIcon from '@mui/icons-material/DeviceHub';
import DnsIcon from '@mui/icons-material/Dns';
import HubIcon from '@mui/icons-material/Hub';
import RouterIcon from '@mui/icons-material/Router';

type NodeIconComponent = typeof DnsIcon;

export const nodeIcons: Record<string, NodeIconComponent> = {
  spine: HubIcon,
  leaf: DeviceHubIcon,
  borderleaf: RouterIcon,
  superspine: HubIcon,
  default: DnsIcon,
};

export function getNodeIcon(role: string | undefined): NodeIconComponent {
  if (!role) return nodeIcons.default;
  const key = role.toLowerCase();
  return nodeIcons[key] ?? nodeIcons.default;
}

export function getNodeRoleMonogram(role: string | undefined): string {
  if (!role) {
    return 'N';
  }

  return role.trim().charAt(0).toUpperCase() || 'N';
}
