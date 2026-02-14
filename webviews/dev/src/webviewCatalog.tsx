export type DevWebviewId =
  | 'edaExplorer'
  | 'alarmDetails'
  | 'deviationDetails'
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

export type DevPreviewWebviewId = Exclude<DevWebviewId, 'edaExplorer'>;

export interface DevWebviewOption {
  id: DevWebviewId;
  label: string;
}

export interface DevPreviewWebviewOption {
  id: DevPreviewWebviewId;
  label: string;
}

export const DEV_EXPLORER_WEBVIEW: DevWebviewOption = {
  id: 'edaExplorer',
  label: 'EDA Explorer'
};

export const DEV_PREVIEW_WEBVIEWS: readonly DevPreviewWebviewOption[] = [
  { id: 'alarmDetails', label: 'Alarm Details' },
  { id: 'deviationDetails', label: 'Deviation Details' },
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

export const DEV_WEBVIEWS: readonly DevWebviewOption[] = [
  DEV_EXPLORER_WEBVIEW,
  ...DEV_PREVIEW_WEBVIEWS
] as const;

const webviewIdSet: ReadonlySet<string> = new Set(DEV_WEBVIEWS.map(option => option.id));
const previewWebviewIdSet: ReadonlySet<string> = new Set(DEV_PREVIEW_WEBVIEWS.map(option => option.id));

export function isDevWebviewId(value: string): value is DevWebviewId {
  return webviewIdSet.has(value);
}

export function isDevPreviewWebviewId(value: string): value is DevPreviewWebviewId {
  return previewWebviewIdSet.has(value);
}

export function getDevWebviewLabel(id: DevWebviewId): string {
  return DEV_WEBVIEWS.find(option => option.id === id)?.label ?? id;
}
