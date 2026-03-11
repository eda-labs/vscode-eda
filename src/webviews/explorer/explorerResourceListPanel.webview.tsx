import {
  CheckCircleOutline as CheckCircleOutlineIcon,
  Close as CloseIcon,
  DeleteOutline as DeleteOutlineIcon,
  Description as DescriptionIcon,
  Edit as EditIcon,
  FactCheck as FactCheckIcon,
  MoreVert as MoreVertIcon,
  OpenInNew as OpenInNewIcon,
  PlayArrow as PlayArrowIcon,
  RestartAlt as RestartAltIcon,
  Restore as RestoreIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Terminal as TerminalIcon,
  Undo as UndoIcon,
  Visibility as VisibilityIcon,
  type SvgIconComponent
} from '@mui/icons-material';
import {
  Alert,
  Box,
  Chip,
  IconButton,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GridColDef, GridRenderCellParams, GridSortModel } from '@mui/x-data-grid';

import type { ExplorerAction } from '../shared/explorer/types';
import { VSCodeButton, VsCodeDataGrid } from '../shared/components';
import { useMessageListener, usePostMessage, useReadySignal } from '../shared/hooks';
import { mountWebview } from '../shared/utils';

import type {
  ExplorerResourceListIncomingMessage,
  ExplorerResourceListItemPayload,
  ExplorerResourceListPayload,
  ExplorerResourceListViewKind
} from './explorerResourceListTypes';

interface ActionIconRule {
  terms: string[];
  icon: SvgIconComponent;
}

interface OverflowMenuState {
  anchorEl: HTMLElement;
  actions: ExplorerAction[];
}

interface HeaderQuickAction {
  id: string;
  label: string;
  commandId: string;
  icon: SvgIconComponent;
  destructive?: boolean;
}

interface ResourceGridRow {
  id: string;
  resource: ExplorerResourceListItemPayload;
  description: string;
  name: string;
  namespace: string;
  kind: string;
  stream: string;
  labels: string;
  apiVersion: string;
  state: string;
  alarmSeverity: string;
  alarmType: string;
  alarmResource: string;
  alarmLastChanged: string;
  deviationStatus: string;
  deviationPath: string;
  deviationNodeEndpoint: string;
  basketOperation: string;
  basketResourceCount: string;
  transactionId: string;
  transactionUser: string;
  transactionTimestamp: string;
  transactionDryRun: string;
}

const ALL_NAMESPACES_VALUE = '__all_namespaces__';
const INLINE_ACTION_LIMIT = 3;
const CMD_VIEW_RESOURCE = 'vscode-eda.viewResource';
const CMD_VIEW_STREAM_ITEM = 'vscode-eda.viewStreamItem';
const CMD_SHOW_ALARM_DETAILS = 'vscode-eda.showAlarmDetails';
const CMD_SHOW_DEVIATION_DETAILS = 'vscode-eda.showDeviationDetails';
const CMD_SHOW_BASKET_TRANSACTION = 'vscode-eda.showBasketTransaction';
const CMD_SHOW_TRANSACTION_DETAILS = 'vscode-eda.showTransactionDetails';
const CMD_ACCEPT_DEVIATION = 'vscode-eda.acceptDeviation';
const CMD_REJECT_DEVIATION = 'vscode-eda.rejectDeviation';
const CMD_EDIT_BASKET_ITEM = 'vscode-eda.editBasketItem';
const CMD_REMOVE_BASKET_ITEM = 'vscode-eda.removeBasketItem';
const CMD_REVERT_TRANSACTION = 'vscode-eda.revertTransaction';
const CMD_RESTORE_TRANSACTION = 'vscode-eda.restoreTransaction';
const CMD_COMMIT_BASKET = 'vscode-eda.commitBasket';
const CMD_DRY_RUN_BASKET = 'vscode-eda.dryRunBasket';
const CMD_DISCARD_BASKET = 'vscode-eda.discardBasket';
const CMD_REJECT_ALL_DEVIATIONS = 'vscode-eda.rejectAllDeviations';
const CMD_SET_TRANSACTION_LIMIT = 'vscode-eda.setTransactionLimit';
const SEVERITY_COLOR_MAP: Record<string, 'error' | 'warning' | 'info' | 'success' | 'default'> = {
  critical: 'error',
  major: 'error',
  warning: 'warning',
  minor: 'info',
  info: 'success'
};
const ACTION_ICON_BY_COMMAND: Record<string, SvgIconComponent> = {
  [CMD_VIEW_STREAM_ITEM]: VisibilityIcon,
  [CMD_VIEW_RESOURCE]: DescriptionIcon,
  [CMD_SHOW_ALARM_DETAILS]: VisibilityIcon,
  [CMD_SHOW_DEVIATION_DETAILS]: VisibilityIcon,
  [CMD_SHOW_BASKET_TRANSACTION]: DescriptionIcon,
  [CMD_SHOW_TRANSACTION_DETAILS]: DescriptionIcon,
  [CMD_ACCEPT_DEVIATION]: CheckCircleOutlineIcon,
  [CMD_REJECT_DEVIATION]: CloseIcon,
  [CMD_EDIT_BASKET_ITEM]: EditIcon,
  [CMD_REMOVE_BASKET_ITEM]: DeleteOutlineIcon,
  [CMD_REVERT_TRANSACTION]: UndoIcon,
  [CMD_RESTORE_TRANSACTION]: RestoreIcon,
  [CMD_COMMIT_BASKET]: PlayArrowIcon,
  [CMD_DRY_RUN_BASKET]: FactCheckIcon,
  [CMD_DISCARD_BASKET]: DeleteOutlineIcon,
  [CMD_SET_TRANSACTION_LIMIT]: SettingsIcon
};

const STATUS_COLOR_MAP: Record<string, string> = {
  green: 'success.main',
  red: 'error.main',
  yellow: 'warning.main',
  blue: 'info.main',
  gray: 'text.disabled'
};
const HEADER_ACTION_BUTTON_SX = {
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1,
  color: 'text.primary',
  width: 28,
  height: 28,
  '&:hover': {
    borderColor: 'primary.main',
    bgcolor: 'action.hover'
  }
} as const;

const ACTION_ICON_RULES: ActionIconRule[] = [
  { terms: ['viewstreamitem', 'viewresource', 'showyaml', 'yaml'], icon: VisibilityIcon },
  { terms: ['edit', 'switchtoedit'], icon: EditIcon },
  { terms: ['delete', 'discard', 'remove'], icon: DeleteOutlineIcon },
  { terms: ['reject'], icon: CloseIcon },
  { terms: ['accept', 'commit'], icon: PlayArrowIcon },
  { terms: ['dryrun'], icon: FactCheckIcon },
  { terms: ['open', 'showdashboard'], icon: OpenInNewIcon },
  { terms: ['terminal', 'ssh', 'logs', 'describe'], icon: TerminalIcon },
  { terms: ['restart', 'revert', 'restore'], icon: RestartAltIcon },
  { terms: ['settransactionlimit', 'settings'], icon: SettingsIcon }
];

function commandIncludesAny(command: string, terms: string[]): boolean {
  return terms.some(term => command.includes(term));
}

function actionIcon(action: ExplorerAction): SvgIconComponent {
  const direct = ACTION_ICON_BY_COMMAND[action.command];
  if (direct) {
    return direct;
  }
  const command = action.command.toLowerCase();
  const matchedRule = ACTION_ICON_RULES.find(rule => commandIncludesAny(command, rule.terms));
  return matchedRule?.icon ?? MoreVertIcon;
}

function isDestructiveAction(action: ExplorerAction): boolean {
  const command = action.command.toLowerCase();
  return command.includes('delete')
    || command.includes('discard')
    || command.includes('remove')
    || command.includes('reject');
}

function statusColor(indicator: string | undefined): string {
  if (!indicator) {
    return 'text.disabled';
  }
  return STATUS_COLOR_MAP[indicator] || 'text.disabled';
}

function isSameAction(left: ExplorerAction, right: ExplorerAction): boolean {
  return left.id === right.id
    || (left.command === right.command && left.label === right.label);
}

function appendUniqueAction(target: ExplorerAction[], action: ExplorerAction): void {
  if (target.some(existing => isSameAction(existing, action))) {
    return;
  }
  target.push(action);
}

function rowActions(resource: ExplorerResourceListItemPayload): ExplorerAction[] {
  const combined: ExplorerAction[] = [];
  if (resource.primaryAction) {
    appendUniqueAction(combined, resource.primaryAction);
  }
  for (const action of resource.actions) {
    appendUniqueAction(combined, action);
  }

  return combined.filter(action => action.command !== CMD_VIEW_STREAM_ITEM);
}

function rowPrimaryAction(actions: ExplorerAction[]): ExplorerAction | undefined {
  const preferred = actions.find(action => action.command === CMD_VIEW_RESOURCE);
  if (preferred) {
    return preferred;
  }
  return actions[0];
}

function resourceState(resource: ExplorerResourceListItemPayload): string {
  return resource.state
    || resource.statusDescription
    || '-';
}

function normalizeSingleLine(value: string | undefined): string {
  if (!value) {
    return '-';
  }
  const normalized = value
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0);
  return normalized || '-';
}

function normalizeBoolean(value: boolean | undefined): string {
  if (value === undefined) {
    return '-';
  }
  return value ? 'Yes' : 'No';
}

function booleanSearchToken(
  value: boolean | undefined,
  trueText: string,
  falseText: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value ? trueText : falseText;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function resolveViewKind(payload: ExplorerResourceListPayload): ExplorerResourceListViewKind {
  if (payload.viewKind) {
    return payload.viewKind;
  }

  if (payload.title === 'Alarms') {
    return 'alarms';
  }
  if (payload.title === 'Deviations') {
    return 'deviations';
  }
  if (payload.title === 'Basket') {
    return 'basket';
  }
  if (payload.title === 'Transactions') {
    return 'transactions';
  }
  return 'resources';
}

function defaultSortModel(viewKind: ExplorerResourceListViewKind): GridSortModel {
  if (viewKind === 'alarms') {
    return [{ field: 'alarmLastChanged', sort: 'desc' }];
  }
  if (viewKind === 'transactions') {
    return [{ field: 'transactionId', sort: 'desc' }];
  }
  return [{ field: 'name', sort: 'asc' }];
}

function severityColor(value: string): 'error' | 'warning' | 'info' | 'success' | 'default' {
  const normalized = value.trim().toLowerCase();
  return SEVERITY_COLOR_MAP[normalized] ?? 'default';
}

function formatBasketResourceCount(value: number | undefined): string {
  if (value === undefined) {
    return '-';
  }
  return String(value);
}

function toGridRowDetailFields(details: ExplorerResourceListItemPayload['details']): Pick<
  ResourceGridRow,
  | 'alarmSeverity'
  | 'alarmType'
  | 'alarmResource'
  | 'alarmLastChanged'
  | 'deviationStatus'
  | 'deviationPath'
  | 'deviationNodeEndpoint'
  | 'basketOperation'
  | 'basketResourceCount'
  | 'transactionId'
  | 'transactionUser'
  | 'transactionTimestamp'
  | 'transactionDryRun'
> {
  return {
    alarmSeverity: normalizeSingleLine(details?.alarmSeverity),
    alarmType: normalizeSingleLine(details?.alarmType),
    alarmResource: normalizeSingleLine(details?.alarmResource),
    alarmLastChanged: formatTimestamp(details?.alarmLastChanged),
    deviationStatus: normalizeSingleLine(details?.deviationStatus),
    deviationPath: normalizeSingleLine(details?.deviationPath),
    deviationNodeEndpoint: normalizeSingleLine(details?.deviationNodeEndpoint),
    basketOperation: normalizeSingleLine(details?.basketOperation),
    basketResourceCount: formatBasketResourceCount(details?.basketResourceCount),
    transactionId: normalizeSingleLine(details?.transactionId),
    transactionUser: normalizeSingleLine(details?.transactionUser),
    transactionTimestamp: formatTimestamp(details?.transactionTimestamp),
    transactionDryRun: normalizeBoolean(details?.transactionDryRun)
  };
}

function toGridRow(resource: ExplorerResourceListItemPayload): ResourceGridRow {
  return {
    id: resource.id,
    resource,
    description: normalizeSingleLine(resource.description),
    name: normalizeSingleLine(resource.name),
    namespace: normalizeSingleLine(resource.namespace),
    kind: normalizeSingleLine(resource.kind),
    stream: normalizeSingleLine(resource.stream),
    labels: resource.labels || '-',
    apiVersion: normalizeSingleLine(resource.apiVersion),
    state: normalizeSingleLine(resourceState(resource)),
    ...toGridRowDetailFields(resource.details)
  };
}

function resourceBaseSearchValues(resource: ExplorerResourceListItemPayload): Array<string | undefined> {
  return [
    resource.name,
    resource.namespace,
    resource.kind,
    resource.stream,
    resource.labels,
    resource.apiVersion,
    resource.state,
    resource.statusDescription,
    resource.description,
    resource.label
  ];
}

function resourceTelemetrySearchValues(details: ExplorerResourceListItemPayload['details']): Array<string | undefined> {
  return [
    details?.alarmSeverity,
    details?.alarmType,
    details?.alarmResource,
    details?.alarmLastChanged,
    details?.deviationStatus,
    details?.deviationPath,
    details?.deviationNodeEndpoint,
    details?.basketOperation,
    details?.basketResourceCount !== undefined ? String(details.basketResourceCount) : undefined
  ];
}

function resourceTransactionSearchValues(details: ExplorerResourceListItemPayload['details']): Array<string | undefined> {
  return [
    details?.transactionId,
    details?.transactionUser,
    details?.transactionTimestamp,
    booleanSearchToken(details?.transactionDryRun, 'yes', 'no'),
    booleanSearchToken(details?.transactionSuccess, 'success', 'failure')
  ];
}

function resourceDetailSearchValues(details: ExplorerResourceListItemPayload['details']): Array<string | undefined> {
  return [
    ...resourceTelemetrySearchValues(details),
    ...resourceTransactionSearchValues(details)
  ];
}

function matchesResourceFilter(resource: ExplorerResourceListItemPayload, filter: string): boolean {
  const searchableValues = [
    ...resourceBaseSearchValues(resource),
    ...resourceDetailSearchValues(resource.details)
  ];
  return searchableValues.some((value) => typeof value === 'string' && value.toLowerCase().includes(filter));
}

function ExplorerResourceListPanelWebview() {
  const postMessage = usePostMessage();
  const [payload, setPayload] = useState<ExplorerResourceListPayload | null>(null);
  const [filterText, setFilterText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<OverflowMenuState | null>(null);
  const [sortModel, setSortModel] = useState<GridSortModel>([
    { field: 'name', sort: 'asc' }
  ]);
  const viewKind = useMemo<ExplorerResourceListViewKind>(() => {
    if (!payload) {
      return 'resources';
    }
    return resolveViewKind(payload);
  }, [payload]);

  useReadySignal();

  useMessageListener<ExplorerResourceListIncomingMessage>(useCallback((message) => {
    if (message.command === 'setData') {
      setPayload(message.payload);
      setErrorMessage(null);
      setMenuState(null);
      return;
    }

    if (message.command === 'error') {
      setErrorMessage(message.message);
    }
  }, []));

  const invokeCommandById = useCallback((commandId: string, args?: unknown[]) => {
    postMessage({
      command: 'invokeCommand',
      commandId,
      args
    });
  }, [postMessage]);

  const invokeAction = useCallback((action: ExplorerAction) => {
    invokeCommandById(action.command, action.args);
  }, [invokeCommandById]);

  const headerQuickActions = useMemo<HeaderQuickAction[]>(() => {
    if (viewKind === 'basket') {
      return [
        {
          id: 'basket-commit',
          label: 'Commit Basket',
          commandId: CMD_COMMIT_BASKET,
          icon: PlayArrowIcon
        },
        {
          id: 'basket-dry-run',
          label: 'Dry Run Basket',
          commandId: CMD_DRY_RUN_BASKET,
          icon: FactCheckIcon
        },
        {
          id: 'basket-discard',
          label: 'Discard Basket',
          commandId: CMD_DISCARD_BASKET,
          icon: DeleteOutlineIcon,
          destructive: true
        }
      ];
    }

    if (viewKind === 'deviations') {
      return [
        {
          id: 'deviations-reject-all',
          label: 'Reject All Deviations',
          commandId: CMD_REJECT_ALL_DEVIATIONS,
          icon: CloseIcon,
          destructive: true
        }
      ];
    }

    if (viewKind === 'transactions') {
      return [
        {
          id: 'transactions-settings',
          label: 'Set Transaction Limit',
          commandId: CMD_SET_TRANSACTION_LIMIT,
          icon: SettingsIcon
        }
      ];
    }

    return [];
  }, [viewKind]);

  const filteredResources = useMemo(() => {
    if (!payload) {
      return [];
    }

    const filter = filterText.trim().toLowerCase();
    if (!filter) {
      return payload.resources;
    }

    return payload.resources.filter(resource => matchesResourceFilter(resource, filter));
  }, [filterText, payload]);

  const closeActionMenu = useCallback(() => {
    setMenuState(null);
  }, []);

  useEffect(() => {
    if (!menuState) {
      return;
    }

    const handleWindowBlur = () => closeActionMenu();
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [closeActionMenu, menuState]);

  useEffect(() => {
    setSortModel(defaultSortModel(viewKind));
  }, [viewKind]);

  const rows = useMemo<ResourceGridRow[]>(
    () => filteredResources.map(toGridRow),
    [filteredResources]
  );

  const renderActionsCell = useCallback((params: GridRenderCellParams<ResourceGridRow>) => {
    const resource = params.row.resource;
    const actions = rowActions(resource);
    const primaryAction = rowPrimaryAction(actions);
    const prioritizedActions = primaryAction
      ? [primaryAction, ...actions.filter(action => !isSameAction(action, primaryAction))]
      : actions;
    const inlineActions = prioritizedActions.slice(0, INLINE_ACTION_LIMIT);
    const overflowActions = prioritizedActions.slice(INLINE_ACTION_LIMIT);

    return (
      <Stack direction="row" spacing={0.1}>
        {inlineActions.map((action) => {
          const IconComponent = action.command === CMD_VIEW_RESOURCE
            ? DescriptionIcon
            : actionIcon(action);

          return (
            <Tooltip key={`${resource.id}:${action.id}`} title={action.label}>
              <span>
                <VSCodeButton
                  variant="icon"
                  size="sm"
                  onClick={() => invokeAction(action)}
                >
                  <IconComponent fontSize="small" />
                </VSCodeButton>
              </span>
            </Tooltip>
          );
        })}

        {overflowActions.length > 0 && (
          <Tooltip title="More actions">
            <span>
              <VSCodeButton
                variant="icon"
                size="sm"
                onClick={(event) => {
                  const target = event.currentTarget as HTMLElement;
                  setMenuState({
                    anchorEl: target,
                    actions: overflowActions
                  });
                }}
              >
                <MoreVertIcon fontSize="small" />
              </VSCodeButton>
            </span>
          </Tooltip>
        )}
      </Stack>
    );
  }, [invokeAction]);

  const renderStateCell = useCallback((params: GridRenderCellParams<ResourceGridRow>) => {
    const resource = params.row.resource;
    return (
      <Stack direction="row" alignItems="center" spacing={0.7}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: statusColor(resource.statusIndicator)
          }}
        />
        <Typography variant="body2" noWrap>{params.value as string}</Typography>
      </Stack>
    );
  }, []);

  const renderSeverityCell = useCallback((params: GridRenderCellParams<ResourceGridRow>) => {
    const value = String(params.value ?? '-');
    if (value === '-') {
      return <Typography variant="body2">-</Typography>;
    }
    return (
      <Chip
        size="small"
        label={value.toUpperCase()}
        color={severityColor(value)}
        variant="outlined"
      />
    );
  }, []);

  const renderDryRunCell = useCallback((params: GridRenderCellParams<ResourceGridRow>) => {
    const value = String(params.value ?? '-');
    if (value === '-') {
      return <Typography variant="body2">-</Typography>;
    }
    return (
      <Chip
        size="small"
        label={value}
        color={value === 'Yes' ? 'warning' : 'default'}
        variant="outlined"
      />
    );
  }, []);

  const renderLabelsCell = useCallback((params: GridRenderCellParams<ResourceGridRow>) => {
    return (
      <Box sx={{ py: 0.25, whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>
        {String(params.value ?? '-')}
      </Box>
    );
  }, []);

  const columns = useMemo<GridColDef<ResourceGridRow>[]>(() => {
    const actionsColumn: GridColDef<ResourceGridRow> = {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      minWidth: 120,
      sortable: false,
      filterable: false,
      renderCell: renderActionsCell
    };

    if (viewKind === 'alarms') {
      return [
        actionsColumn,
        { field: 'name', headerName: 'Name', minWidth: 200, width: 260 },
        { field: 'namespace', headerName: 'Namespace', minWidth: 150, width: 190 },
        {
          field: 'alarmSeverity',
          headerName: 'Severity',
          minWidth: 120,
          width: 140,
          renderCell: renderSeverityCell
        },
        { field: 'alarmType', headerName: 'Type', minWidth: 140, width: 190 },
        { field: 'alarmResource', headerName: 'Resource', minWidth: 220, width: 300 },
        { field: 'alarmLastChanged', headerName: 'Last Changed', minWidth: 180, width: 220 },
        { field: 'description', headerName: 'Description', minWidth: 260, width: 360 }
      ];
    }

    if (viewKind === 'deviations') {
      return [
        actionsColumn,
        { field: 'name', headerName: 'Name', minWidth: 200, width: 260 },
        { field: 'namespace', headerName: 'Namespace', minWidth: 150, width: 190 },
        {
          field: 'deviationStatus',
          headerName: 'Status',
          minWidth: 150,
          width: 190,
          renderCell: renderStateCell
        },
        { field: 'kind', headerName: 'Kind', minWidth: 140, width: 180 },
        { field: 'deviationNodeEndpoint', headerName: 'Node', minWidth: 180, width: 240 },
        { field: 'deviationPath', headerName: 'Path', minWidth: 260, width: 360 }
      ];
    }

    if (viewKind === 'basket') {
      return [
        actionsColumn,
        { field: 'name', headerName: 'Resource', minWidth: 220, width: 300 },
        { field: 'namespace', headerName: 'Namespace', minWidth: 150, width: 190 },
        { field: 'kind', headerName: 'Kind', minWidth: 150, width: 200 },
        { field: 'basketOperation', headerName: 'Operation', minWidth: 130, width: 150 },
        { field: 'basketResourceCount', headerName: 'Count', minWidth: 100, width: 120 },
        { field: 'description', headerName: 'Details', minWidth: 220, width: 300 }
      ];
    }

    if (viewKind === 'transactions') {
      return [
        actionsColumn,
        { field: 'transactionId', headerName: 'ID', minWidth: 110, width: 130 },
        { field: 'transactionUser', headerName: 'User', minWidth: 140, width: 180 },
        {
          field: 'state',
          headerName: 'State',
          minWidth: 150,
          width: 190,
          renderCell: renderStateCell
        },
        { field: 'transactionTimestamp', headerName: 'Updated', minWidth: 180, width: 220 },
        {
          field: 'transactionDryRun',
          headerName: 'Dry Run',
          minWidth: 120,
          width: 130,
          renderCell: renderDryRunCell
        },
        { field: 'description', headerName: 'Description', minWidth: 240, width: 360 }
      ];
    }

    return [
      actionsColumn,
      { field: 'name', headerName: 'Name', minWidth: 180, width: 220 },
      { field: 'namespace', headerName: 'Namespace', minWidth: 140, width: 180 },
      { field: 'kind', headerName: 'Kind', minWidth: 150, width: 180 },
      { field: 'stream', headerName: 'Stream', minWidth: 170, width: 210 },
      {
        field: 'labels',
        headerName: 'Labels',
        minWidth: 220,
        width: 320,
        renderCell: renderLabelsCell
      },
      { field: 'apiVersion', headerName: 'API Version', minWidth: 170, width: 220 },
      {
        field: 'state',
        headerName: 'State',
        minWidth: 180,
        width: 220,
        renderCell: renderStateCell
      }
    ];
  }, [renderActionsCell, renderDryRunCell, renderLabelsCell, renderSeverityCell, renderStateCell, viewKind]);

  const filterPlaceholder = useMemo(() => {
    if (viewKind === 'alarms') {
      return 'Filter alarms';
    }
    if (viewKind === 'deviations') {
      return 'Filter deviations';
    }
    if (viewKind === 'basket') {
      return 'Filter basket items';
    }
    if (viewKind === 'transactions') {
      return 'Filter transactions';
    }
    return 'Filter resources';
  }, [viewKind]);

  const noRowsMessage = useMemo(() => {
    if (viewKind === 'alarms') {
      return 'No alarms found';
    }
    if (viewKind === 'deviations') {
      return 'No deviations found';
    }
    if (viewKind === 'basket') {
      return 'No basket items found';
    }
    if (viewKind === 'transactions') {
      return 'No transactions found';
    }
    return 'No resources found';
  }, [viewKind]);

  if (!payload) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">Loading resources...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1600, mx: 'auto' }}>
      {errorMessage && (
        <Alert severity="error" onClose={() => setErrorMessage(null)} sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
      )}

      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>{payload.title}</Typography>
        <Stack direction="row" spacing={0.75}>
          <Chip
            size="small"
            label={payload.namespace === ALL_NAMESPACES_VALUE ? 'All Namespaces' : payload.namespace}
            color="info"
            variant="outlined"
          />
          <Chip
            size="small"
            label={`${filteredResources.length}/${payload.resources.length}`}
            color="default"
            variant="outlined"
          />
        </Stack>
      </Stack>

      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 2 }}>
        <TextField
          size="small"
          value={filterText}
          onChange={(event) => setFilterText(event.target.value)}
          placeholder={filterPlaceholder}
          sx={{ flex: 1, minWidth: 0 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              )
            }
          }}
        />

        {headerQuickActions.map((action) => {
          const Icon = action.icon;
          return (
            <Tooltip key={action.id} title={action.label}>
              <IconButton
                size="small"
                aria-label={action.label}
                onClick={() => invokeCommandById(action.commandId)}
                sx={{
                  ...HEADER_ACTION_BUTTON_SX,
                  ...(action.destructive
                    ? {
                      color: 'error.main',
                      borderColor: 'error.main',
                      '&:hover': {
                        borderColor: 'error.dark',
                        bgcolor: 'rgba(211, 47, 47, 0.12)'
                      }
                    }
                    : {})
                }}
              >
                <Icon fontSize="small" />
              </IconButton>
            </Tooltip>
          );
        })}
      </Stack>

      <VsCodeDataGrid<ResourceGridRow>
        rows={rows}
        columns={columns}
        noRowsMessage={noRowsMessage}
        footer={(
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            Count: {rows.length}
          </Typography>
        )}
        dataGridProps={{
          sortModel,
          onSortModelChange: setSortModel,
          getRowHeight: () => 'auto'
        }}
      />

      <Menu
        anchorEl={menuState?.anchorEl ?? null}
        open={Boolean(menuState)}
        onClose={closeActionMenu}
        onClick={closeActionMenu}
        slotProps={{
          list: { dense: true },
          paper: {
            sx: {
              minWidth: 240,
              border: '1px solid',
              borderColor: 'divider'
            }
          }
        }}
      >
        {(menuState?.actions ?? []).map((action) => {
          const IconComponent = actionIcon(action);
          const destructive = isDestructiveAction(action);
          return (
            <MenuItem
              key={action.id}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                invokeAction(action);
              }}
              sx={destructive ? { color: 'error.main' } : undefined}
            >
              <ListItemIcon sx={{ minWidth: 24, color: destructive ? 'error.main' : 'text.primary' }}>
                <IconComponent fontSize="small" />
              </ListItemIcon>
              <Typography variant="body2">{action.label}</Typography>
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}

mountWebview(ExplorerResourceListPanelWebview);
