import {
  Close as CloseIcon,
  DeleteOutline as DeleteOutlineIcon,
  Description as DescriptionIcon,
  Edit as EditIcon,
  FactCheck as FactCheckIcon,
  MoreVert as MoreVertIcon,
  OpenInNew as OpenInNewIcon,
  PlayArrow as PlayArrowIcon,
  RestartAlt as RestartAltIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Terminal as TerminalIcon,
  Visibility as VisibilityIcon,
  type SvgIconComponent
} from '@mui/icons-material';
import {
  Alert,
  Box,
  Chip,
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
  ExplorerResourceListPayload
} from './explorerResourceListTypes';

interface ActionIconRule {
  terms: string[];
  icon: SvgIconComponent;
}

interface OverflowMenuState {
  anchorEl: HTMLElement;
  actions: ExplorerAction[];
}

interface ResourceGridRow {
  id: string;
  resource: ExplorerResourceListItemPayload;
  name: string;
  namespace: string;
  kind: string;
  stream: string;
  labels: string;
  apiVersion: string;
  state: string;
}

const ALL_NAMESPACES_VALUE = '__all_namespaces__';
const INLINE_ACTION_LIMIT = 3;
const CMD_VIEW_RESOURCE = 'vscode-eda.viewResource';
const CMD_VIEW_STREAM_ITEM = 'vscode-eda.viewStreamItem';

const STATUS_COLOR_MAP: Record<string, string> = {
  green: 'success.main',
  red: 'error.main',
  yellow: 'warning.main',
  blue: 'info.main',
  gray: 'text.disabled'
};

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

function toGridRow(resource: ExplorerResourceListItemPayload): ResourceGridRow {
  return {
    id: resource.id,
    resource,
    name: normalizeSingleLine(resource.name),
    namespace: normalizeSingleLine(resource.namespace),
    kind: normalizeSingleLine(resource.kind),
    stream: normalizeSingleLine(resource.stream),
    labels: resource.labels || '-',
    apiVersion: normalizeSingleLine(resource.apiVersion),
    state: normalizeSingleLine(resourceState(resource))
  };
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

  const invokeAction = useCallback((action: ExplorerAction) => {
    postMessage({
      command: 'invokeCommand',
      commandId: action.command,
      args: action.args
    });
  }, [postMessage]);

  const filteredResources = useMemo(() => {
    if (!payload) {
      return [];
    }

    const filter = filterText.trim().toLowerCase();
    if (!filter) {
      return payload.resources;
    }

    return payload.resources.filter((resource) => {
      return [
        resource.name,
        resource.namespace,
        resource.kind,
        resource.stream,
        resource.labels,
        resource.apiVersion,
        resource.state,
        resource.statusDescription,
        resource.label
      ].some((value) => typeof value === 'string' && value.toLowerCase().includes(filter));
    });
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

  const renderLabelsCell = useCallback((params: GridRenderCellParams<ResourceGridRow>) => {
    return (
      <Box sx={{ py: 0.25, whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>
        {String(params.value ?? '-')}
      </Box>
    );
  }, []);

  const columns = useMemo<GridColDef<ResourceGridRow>[]>(() => [
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      minWidth: 120,
      sortable: false,
      filterable: false,
      renderCell: renderActionsCell
    },
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
  ], [renderActionsCell, renderLabelsCell, renderStateCell]);

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

      <TextField
        size="small"
        value={filterText}
        onChange={(event) => setFilterText(event.target.value)}
        placeholder="Filter resources"
        sx={{ mb: 2, width: { xs: '100%', md: 380 } }}
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

      <VsCodeDataGrid<ResourceGridRow>
        rows={rows}
        columns={columns}
        noRowsMessage="No resources found"
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
