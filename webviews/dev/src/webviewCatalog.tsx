export type DevWebviewId =
  | 'alarmDetails'
  | 'nodeConfig'
  | 'targetWizard'
  | 'transactionDetails'
  | 'transactionDiffs'
  | 'fabricDashboard'
  | 'queriesDashboard'
  | 'resourceBrowser'
  | 'simnodesDashboard'
  | 'topologyFlowDashboard'
  | 'toponodesDashboard';

export interface DevWebviewOption {
  id: DevWebviewId;
  label: string;
}

export const DEV_WEBVIEWS: readonly DevWebviewOption[] = [
  { id: 'alarmDetails', label: 'Alarm Details' },
  { id: 'nodeConfig', label: 'Node Config' },
  { id: 'targetWizard', label: 'Target Wizard' },
  { id: 'transactionDetails', label: 'Transaction Details' },
  { id: 'transactionDiffs', label: 'Transaction Diffs' },
  { id: 'fabricDashboard', label: 'Fabric Dashboard' },
  { id: 'queriesDashboard', label: 'Queries Dashboard' },
  { id: 'resourceBrowser', label: 'Resource Browser' },
  { id: 'simnodesDashboard', label: 'Simnodes Dashboard' },
  { id: 'topologyFlowDashboard', label: 'Topology Flow Dashboard' },
  { id: 'toponodesDashboard', label: 'Toponodes Dashboard' }
] as const;

const webviewIdSet: ReadonlySet<string> = new Set(DEV_WEBVIEWS.map(option => option.id));

export function isDevWebviewId(value: string): value is DevWebviewId {
  return webviewIdSet.has(value);
}

export function getDevWebviewLabel(id: DevWebviewId): string {
  return DEV_WEBVIEWS.find(option => option.id === id)?.label ?? id;
}
