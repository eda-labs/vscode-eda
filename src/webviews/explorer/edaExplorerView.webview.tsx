import {
  Add as AddIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
  DeleteOutline as DeleteOutlineIcon,
  Edit as EditIcon,
  ExpandMore as ExpandMoreIcon,
  FactCheck as FactCheckIcon,
  MoreVert as MoreVertIcon,
  OpenInNew as OpenInNewIcon,
  PlayArrow as PlayArrowIcon,
  RestartAlt as RestartAltIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  ShoppingBasket as ShoppingBasketIcon,
  Terminal as TerminalIcon,
  type SvgIconComponent
} from '@mui/icons-material';
import {
  Alert,
  Badge,
  Box,
  IconButton,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';

import { useMessageListener, usePostMessage, useReadySignal } from '../shared/hooks';
import {
  EXPLORER_TAB_ORDER,
  type ExplorerAction,
  type ExplorerIncomingMessage,
  type ExplorerNode,
  type ExplorerSectionSnapshot,
  type ExplorerTabId
} from '../shared/explorer/types';
import { mountWebview } from '../shared/utils';

interface ExplorerNodeLabelProps {
  node: ExplorerNode;
  onInvokeAction: (action: ExplorerAction) => void;
}

const COLOR_ERROR_MAIN = 'error.main';
const STATUS_COLOR_MAP: Record<string, string> = {
  green: 'success.main',
  red: COLOR_ERROR_MAIN,
  yellow: 'warning.main',
  blue: 'info.main',
  gray: 'text.disabled'
};
const DEFAULT_STATUS_COLOR = 'text.disabled';
const COLOR_TEXT_PRIMARY = 'text.primary';
const COLOR_PRIMARY_MAIN = 'primary.main';
const COLOR_DIVIDER = 'divider';
const DEFAULT_EXPANDED_SECTIONS = new Set<ExplorerTabId>(['dashboards', 'resources']);
const FILTER_UPDATE_DEBOUNCE_MS = 250;

const TOOLBAR_ICON_BUTTON_SX = {
  width: 24,
  height: 24,
  borderRadius: 1,
  border: '1px solid',
  borderColor: COLOR_DIVIDER,
  color: COLOR_TEXT_PRIMARY,
  bgcolor: (theme: Theme) => alpha(theme.palette.background.default, 0.45),
  '&:hover': {
    borderColor: COLOR_PRIMARY_MAIN,
    bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.14)
  }
} as const;

function statusColor(indicator: string | undefined): string {
  if (!indicator) {
    return DEFAULT_STATUS_COLOR;
  }
  return STATUS_COLOR_MAP[indicator] || DEFAULT_STATUS_COLOR;
}

function isExpandedByDefault(sectionId: ExplorerTabId): boolean {
  return DEFAULT_EXPANDED_SECTIONS.has(sectionId);
}

function formatSectionTitle(section: ExplorerSectionSnapshot): string {
  if (section.id === 'dashboards' || section.id === 'help') {
    return section.label;
  }
  return `${section.label} (${section.count})`;
}

function flattenNodeIds(nodes: ExplorerNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    ids.push(...flattenNodeIds(node.children));
  }
  return ids;
}

function flattenExpandableNodeIds(nodes: ExplorerNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.children.length === 0) {
      continue;
    }
    ids.push(node.id);
    ids.push(...flattenExpandableNodeIds(node.children));
  }
  return ids;
}

type ToolbarActionIconId =
  | 'createResource'
  | 'rejectAllDeviations'
  | 'commitBasket'
  | 'dryRunBasket'
  | 'discardBasket'
  | 'setTransactionLimit';

const TOOLBAR_ACTION_ICONS: Record<ToolbarActionIconId, SvgIconComponent> = {
  createResource: AddIcon,
  rejectAllDeviations: CloseIcon,
  commitBasket: PlayArrowIcon,
  dryRunBasket: FactCheckIcon,
  discardBasket: DeleteOutlineIcon,
  setTransactionLimit: SettingsIcon
};

function toolbarActionIconId(action: ExplorerAction): ToolbarActionIconId | undefined {
  if (action.command === 'vscode-eda.createResource') {
    return 'createResource';
  }
  if (action.command === 'vscode-eda.rejectAllDeviations') {
    return 'rejectAllDeviations';
  }
  if (action.command === 'vscode-eda.commitBasket') {
    return 'commitBasket';
  }
  if (action.command === 'vscode-eda.dryRunBasket') {
    return 'dryRunBasket';
  }
  if (action.command === 'vscode-eda.discardBasket') {
    return 'discardBasket';
  }
  if (action.command === 'vscode-eda.setTransactionLimit') {
    return 'setTransactionLimit';
  }

  return undefined;
}

function entryActionIcon(action: ExplorerAction): SvgIconComponent {
  const command = action.command.toLowerCase();

  if (command.includes('create')) {
    return AddIcon;
  }
  if (command.includes('edit') || command.includes('switchtoedit')) {
    return EditIcon;
  }
  if (command.includes('delete') || command.includes('discard') || command.includes('remove')) {
    return DeleteOutlineIcon;
  }
  if (command.includes('reject')) {
    return CloseIcon;
  }
  if (command.includes('accept') || command.includes('commit')) {
    return PlayArrowIcon;
  }
  if (command.includes('showdashboard')) {
    return OpenInNewIcon;
  }
  if (command.includes('dryrun')) {
    return FactCheckIcon;
  }
  if (command.includes('view') || command.includes('show') || command.includes('describe') || command.includes('logs')) {
    return SearchIcon;
  }
  if (command.includes('terminal') || command.includes('ssh')) {
    return TerminalIcon;
  }
  if (command.includes('restart') || command.includes('revert') || command.includes('restore')) {
    return RestartAltIcon;
  }
  if (command.includes('settransactionlimit')) {
    return SettingsIcon;
  }

  return MoreVertIcon;
}

function isDestructiveEntryAction(action: ExplorerAction): boolean {
  const command = action.command.toLowerCase();
  return command.includes('delete')
    || command.includes('discard')
    || command.includes('remove')
    || command.includes('reject');
}

function ExplorerNodeLabel({ node, onInvokeAction }: Readonly<ExplorerNodeLabelProps>) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const hasActions = node.actions.length > 0;

  const handleMenuOpen = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setMenuPosition(null);
  }, []);

  const handleRowContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!hasActions) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setAnchorEl(null);
    setMenuPosition({ top: event.clientY + 2, left: event.clientX + 2 });
  }, [hasActions]);

  const handleMenuClose = useCallback(() => {
    setAnchorEl(null);
    setMenuPosition(null);
  }, []);

  const handlePrimaryAction = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!node.primaryAction) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onInvokeAction(node.primaryAction);
  }, [node.primaryAction, onInvokeAction]);

  const menuOpen = Boolean(anchorEl || menuPosition);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleMenuClose();
      }
    };

    window.addEventListener('blur', handleMenuClose);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleMenuClose);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [menuOpen, handleMenuClose]);

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.75}
      onContextMenu={handleRowContextMenu}
      sx={{ width: '100%' }}
    >
      <Box
        onClick={handlePrimaryAction}
        sx={{
          minWidth: 0,
          flex: 1,
          cursor: node.primaryAction ? 'pointer' : 'default'
        }}
      >
        <Tooltip title={node.tooltip || ''} enterDelay={400}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
            {node.statusIndicator && (
              <Box
                sx={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  flex: '0 0 auto',
                  bgcolor: statusColor(node.statusIndicator)
                }}
              />
            )}
            <Typography variant="body2" noWrap sx={{ fontWeight: node.primaryAction ? 600 : 500 }}>
              {node.label}
            </Typography>
          </Stack>
        </Tooltip>
        {(node.description || node.statusDescription) && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {node.description || node.statusDescription}
          </Typography>
        )}
      </Box>

      {hasActions && (
        <>
          <IconButton
            size="small"
            onClick={handleMenuOpen}
            aria-label={`Actions for ${node.label}`}
            sx={{ width: 22, height: 22, p: 0.25, color: COLOR_TEXT_PRIMARY }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            anchorReference={menuPosition ? 'anchorPosition' : 'anchorEl'}
            anchorPosition={menuPosition ?? undefined}
            open={menuOpen}
            onClose={handleMenuClose}
            onClick={handleMenuClose}
            slotProps={{
              list: { dense: true },
              paper: {
                sx: {
                  minWidth: 210,
                  border: '1px solid',
                  borderColor: COLOR_DIVIDER,
                  '& .MuiMenuItem-root': {
                    minHeight: 30,
                    py: 0.25
                  }
                }
              }
            }}
          >
            {node.actions.map(action => {
              const IconComponent = entryActionIcon(action);
              const isDestructive = isDestructiveEntryAction(action);
              return (
                <MenuItem
                  key={action.id}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onInvokeAction(action);
                  }}
                  sx={isDestructive ? { color: COLOR_ERROR_MAIN } : undefined}
                >
                  <ListItemIcon sx={{ minWidth: 24, color: isDestructive ? COLOR_ERROR_MAIN : COLOR_TEXT_PRIMARY }}>
                    <IconComponent fontSize="small" />
                  </ListItemIcon>
                  <Typography variant="body2">{action.label}</Typography>
                </MenuItem>
              );
            })}
          </Menu>
        </>
      )}
    </Stack>
  );
}

interface SectionTreeProps {
  section: ExplorerSectionSnapshot;
  expandedItems: string[];
  onExpandedItemsChange: (itemIds: string[]) => void;
  onInvokeAction: (action: ExplorerAction) => void;
}

interface SectionToolbarActionsProps {
  actions: ExplorerAction[];
  onInvokeAction: (action: ExplorerAction) => void;
}

interface SectionCollapseToggleButtonProps {
  sectionLabel: string;
  isCollapsed: boolean;
  onToggle: (event: MouseEvent<HTMLElement>) => void;
}

interface ResourceSectionToggleButtonProps {
  section: ExplorerSectionSnapshot;
  expandedItems: string[];
  onEnsureResourcesSectionExpanded: () => void;
  onExpandAllInSection: (sectionId: ExplorerTabId, nodes: ExplorerNode[]) => void;
  onCollapseAllInSection: (sectionId: ExplorerTabId) => void;
}

interface ExplorerSectionCardProps {
  section: ExplorerSectionSnapshot;
  expandedItems: string[];
  isCollapsed: boolean;
  isDropTarget: boolean;
  isBeingDragged: boolean;
  onSetSectionRef: (sectionId: ExplorerTabId, element: HTMLDivElement | null) => void;
  onSectionDragStart: (sectionId: ExplorerTabId) => (event: DragEvent<HTMLDivElement>) => void;
  onSectionDragOver: (sectionId: ExplorerTabId) => (event: DragEvent<HTMLDivElement>) => void;
  onSectionDrop: (sectionId: ExplorerTabId) => (event: DragEvent<HTMLDivElement>) => void;
  onSectionDragEnd: () => void;
  onToggleSectionCollapsed: (sectionId: ExplorerTabId) => void;
  onInvokeAction: (action: ExplorerAction) => void;
  onExpandedItemsChange: (sectionId: ExplorerTabId, itemIds: string[]) => void;
  onEnsureResourcesSectionExpanded: () => void;
  onExpandAllInSection: (sectionId: ExplorerTabId, nodes: ExplorerNode[]) => void;
  onCollapseAllInSection: (sectionId: ExplorerTabId) => void;
}

function renderTreeNodes(nodes: ExplorerNode[], onInvokeAction: (action: ExplorerAction) => void): ReactNode[] {
  return nodes.map(node => (
    <TreeItem
      key={node.id}
      itemId={node.id}
      label={<ExplorerNodeLabel node={node} onInvokeAction={onInvokeAction} />}
    >
      {renderTreeNodes(node.children, onInvokeAction)}
    </TreeItem>
  ));
}

function SectionTree({ section, expandedItems, onExpandedItemsChange, onInvokeAction }: Readonly<SectionTreeProps>) {
  if (section.nodes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No items found.
      </Typography>
    );
  }

  const contentRowPaddingY = section.id === 'dashboards' ? 0.1 : 0.3;

  return (
    <SimpleTreeView
      expandedItems={expandedItems}
      onExpandedItemsChange={(_event, itemIds) => onExpandedItemsChange(itemIds)}
      slots={{
        expandIcon: ChevronRightIcon,
        collapseIcon: ExpandMoreIcon
      }}
      sx={{
        minHeight: 0,
        '& .MuiTreeItem-content': { py: contentRowPaddingY },
        '& .MuiTreeItem-label': { width: '100%' }
      }}
    >
      {renderTreeNodes(section.nodes, onInvokeAction)}
    </SimpleTreeView>
  );
}

function getSectionPaperSx(isDropTarget: boolean) {
  return {
    flexShrink: 0,
    overflow: 'hidden',
    borderColor: isDropTarget ? COLOR_PRIMARY_MAIN : COLOR_DIVIDER,
    transition: 'border-color 0.12s ease, box-shadow 0.12s ease',
    boxShadow: isDropTarget
      ? (theme: Theme) => `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.35)}`
      : 'none'
  };
}

function getSectionHeaderSx(isCollapsed: boolean, isBeingDragged: boolean) {
  return {
    px: 0.75,
    py: 0.4,
    display: 'flex',
    alignItems: 'center',
    gap: 0.35,
    borderBottom: isCollapsed ? 'none' : '1px solid',
    borderColor: COLOR_DIVIDER,
    cursor: isBeingDragged ? 'grabbing' : 'grab',
    userSelect: 'none',
    bgcolor: (theme: Theme) => isBeingDragged
      ? alpha(theme.palette.primary.main, 0.1)
      : alpha(theme.palette.background.default, 0.55)
  };
}

function areAllNodesExpanded(nodes: ExplorerNode[], expandedItems: string[]): boolean {
  const nodeIds = flattenNodeIds(nodes);
  return nodeIds.length > 0 && nodeIds.every(id => expandedItems.includes(id));
}

function SectionToolbarActions({ actions, onInvokeAction }: Readonly<SectionToolbarActionsProps>) {
  return (
    <Stack direction="row" spacing={0.25}>
      {actions.map(action => {
        const iconId = toolbarActionIconId(action);
        if (!iconId) {
          return null;
        }

        const IconComponent = TOOLBAR_ACTION_ICONS[iconId];
        return (
          <Tooltip key={action.id} title={action.label}>
            <IconButton
              size="small"
              aria-label={action.label}
              sx={TOOLBAR_ICON_BUTTON_SX}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onInvokeAction(action);
              }}
            >
              <IconComponent fontSize="small" />
            </IconButton>
          </Tooltip>
        );
      })}
    </Stack>
  );
}

function SectionCollapseToggleButton({ sectionLabel, isCollapsed, onToggle }: Readonly<SectionCollapseToggleButtonProps>) {
  return (
    <IconButton
      size="small"
      onClick={onToggle}
      aria-label={isCollapsed ? `Expand ${sectionLabel}` : `Collapse ${sectionLabel}`}
      sx={{ color: COLOR_TEXT_PRIMARY, p: 0.25 }}
    >
      {isCollapsed ? <ChevronRightIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
    </IconButton>
  );
}

function ResourceSectionToggleButton({
  section,
  expandedItems,
  onEnsureResourcesSectionExpanded,
  onExpandAllInSection,
  onCollapseAllInSection
}: Readonly<ResourceSectionToggleButtonProps>) {
  if (section.id !== 'resources') {
    return null;
  }

  const areAllResourcesExpanded = areAllNodesExpanded(section.nodes, expandedItems);
  return (
    <Tooltip title={areAllResourcesExpanded ? 'Collapse All Resources' : 'Expand All Resources'}>
      <IconButton
        size="small"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();

          if (areAllResourcesExpanded) {
            onCollapseAllInSection(section.id);
            return;
          }

          onEnsureResourcesSectionExpanded();
          onExpandAllInSection(section.id, section.nodes);
        }}
        aria-label={areAllResourcesExpanded ? 'Collapse all resources' : 'Expand all resources'}
        sx={{ color: COLOR_TEXT_PRIMARY }}
      >
        {areAllResourcesExpanded ? <ChevronRightIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}

function ExplorerSectionCard({
  section,
  expandedItems,
  isCollapsed,
  isDropTarget,
  isBeingDragged,
  onSetSectionRef,
  onSectionDragStart,
  onSectionDragOver,
  onSectionDrop,
  onSectionDragEnd,
  onToggleSectionCollapsed,
  onInvokeAction,
  onExpandedItemsChange,
  onEnsureResourcesSectionExpanded,
  onExpandAllInSection,
  onCollapseAllInSection
}: Readonly<ExplorerSectionCardProps>) {
  return (
    <Paper
      variant="outlined"
      ref={(element: HTMLDivElement | null) => {
        onSetSectionRef(section.id, element);
      }}
      sx={getSectionPaperSx(isDropTarget)}
    >
      <Box
        draggable
        onDragStart={onSectionDragStart(section.id)}
        onDragOver={onSectionDragOver(section.id)}
        onDrop={onSectionDrop(section.id)}
        onDragEnd={onSectionDragEnd}
        sx={getSectionHeaderSx(isCollapsed, isBeingDragged)}
      >
        <SectionCollapseToggleButton
          sectionLabel={section.label}
          isCollapsed={isCollapsed}
          onToggle={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleSectionCollapsed(section.id);
          }}
        />
        <Box
          onClick={() => onToggleSectionCollapsed(section.id)}
          sx={{ minWidth: 0, flex: 1, cursor: 'pointer' }}
        >
          <Typography variant="body2" noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.2 }}>
            {formatSectionTitle(section)}
          </Typography>
        </Box>
        <SectionToolbarActions
          actions={section.toolbarActions}
          onInvokeAction={onInvokeAction}
        />
        <ResourceSectionToggleButton
          section={section}
          expandedItems={expandedItems}
          onEnsureResourcesSectionExpanded={onEnsureResourcesSectionExpanded}
          onExpandAllInSection={onExpandAllInSection}
          onCollapseAllInSection={onCollapseAllInSection}
        />
      </Box>

      {!isCollapsed && (
        <Box sx={{ p: 1 }}>
          <SectionTree
            section={section}
            expandedItems={expandedItems}
            onExpandedItemsChange={(itemIds) => onExpandedItemsChange(section.id, itemIds)}
            onInvokeAction={onInvokeAction}
          />
        </Box>
      )}
    </Paper>
  );
}

function getSectionById(sections: ExplorerSectionSnapshot[], tabId: ExplorerTabId): ExplorerSectionSnapshot | undefined {
  return sections.find(section => section.id === tabId);
}

function isExplorerTabId(value: string): value is ExplorerTabId {
  return EXPLORER_TAB_ORDER.includes(value as ExplorerTabId);
}

function mergeSectionOrder(currentOrder: ExplorerTabId[], sections: ExplorerSectionSnapshot[]): ExplorerTabId[] {
  const visibleIds = sections.map(section => section.id);
  const visibleIdSet = new Set(visibleIds);

  const nextOrder = currentOrder.filter(sectionId => visibleIdSet.has(sectionId));
  for (const sectionId of visibleIds) {
    if (!nextOrder.includes(sectionId)) {
      nextOrder.push(sectionId);
    }
  }
  return nextOrder;
}

function reorderSections(
  currentOrder: ExplorerTabId[],
  sourceId: ExplorerTabId,
  targetId: ExplorerTabId
): ExplorerTabId[] {
  if (sourceId === targetId) {
    return currentOrder;
  }

  const nextOrder = currentOrder.filter(sectionId => sectionId !== sourceId);
  const targetIndex = nextOrder.indexOf(targetId);
  if (targetIndex < 0) {
    return currentOrder;
  }

  nextOrder.splice(targetIndex, 0, sourceId);
  return nextOrder;
}

function EdaExplorerView() {
  const postMessage = usePostMessage();
  const [sections, setSections] = useState<ExplorerSectionSnapshot[]>([]);
  const [sectionOrder, setSectionOrder] = useState<ExplorerTabId[]>(EXPLORER_TAB_ORDER);
  const [collapsedBySection, setCollapsedBySection] = useState<Partial<Record<ExplorerTabId, boolean>>>({});
  const [filterText, setFilterText] = useState('');
  const [expandedByTab, setExpandedByTab] = useState<Partial<Record<ExplorerTabId, string[]>>>({
    resources: []
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<ExplorerTabId | null>(null);
  const [dragOverSection, setDragOverSection] = useState<ExplorerTabId | null>(null);
  const sectionRefs = useRef<Partial<Record<ExplorerTabId, HTMLDivElement | null>>>({});
  const resourcesExpandedBeforeFilterRef = useRef<string[] | null>(null);
  const resourcesCollapsedBeforeFilterRef = useRef<boolean | null>(null);
  const pendingFilterSyncRef = useRef<string | null>(null);

  useReadySignal();

  useMessageListener<ExplorerIncomingMessage>(useCallback((message) => {
    if (message.command === 'snapshot') {
      const pendingFilter = pendingFilterSyncRef.current;
      if (pendingFilter !== null && message.filterText !== pendingFilter) {
        return;
      }
      if (pendingFilter !== null && message.filterText === pendingFilter) {
        pendingFilterSyncRef.current = null;
      }

      const filterActive = message.filterText.length > 0;
      const resourceNodes = getSectionById(message.sections, 'resources')?.nodes ?? [];

      setSections(message.sections);
      setSectionOrder(currentOrder => mergeSectionOrder(currentOrder, message.sections));
      setCollapsedBySection(current => {
        const next: Partial<Record<ExplorerTabId, boolean>> = {};
        for (const section of message.sections) {
          next[section.id] = current[section.id] ?? !isExpandedByDefault(section.id);
        }
        if (filterActive) {
          if (resourcesCollapsedBeforeFilterRef.current === null) {
            resourcesCollapsedBeforeFilterRef.current = next.resources ?? !isExpandedByDefault('resources');
          }
          next.resources = false;
        } else if (resourcesCollapsedBeforeFilterRef.current !== null) {
          next.resources = resourcesCollapsedBeforeFilterRef.current;
          resourcesCollapsedBeforeFilterRef.current = null;
        }
        return next;
      });
      setExpandedByTab(current => {
        if (filterActive) {
          if (resourcesExpandedBeforeFilterRef.current === null) {
            resourcesExpandedBeforeFilterRef.current = current.resources ?? [];
          }
          return {
            ...current,
            resources: flattenExpandableNodeIds(resourceNodes)
          };
        }
        if (resourcesExpandedBeforeFilterRef.current !== null) {
          const restoredResources = resourcesExpandedBeforeFilterRef.current;
          resourcesExpandedBeforeFilterRef.current = null;
          return {
            ...current,
            resources: restoredResources
          };
        }
        return current;
      });
      setFilterText(message.filterText);
      return;
    }

    if (message.command === 'filterState') {
      const pendingFilter = pendingFilterSyncRef.current;
      if (pendingFilter !== null && message.filterText !== pendingFilter) {
        return;
      }
      if (pendingFilter !== null && message.filterText === pendingFilter) {
        pendingFilterSyncRef.current = null;
      }

      setFilterText(message.filterText);
      return;
    }

    if (message.command === 'expandAllResources') {
      const resourceNodes = getSectionById(sections, 'resources')?.nodes ?? [];
      setExpandedByTab(current => ({
        ...current,
        resources: flattenNodeIds(resourceNodes)
      }));
      return;
    }

    if (message.command === 'error') {
      setErrorMessage(message.message);
    }
  }, [sections]));

  const sectionsById = useMemo(() => {
    const map = new Map<ExplorerTabId, ExplorerSectionSnapshot>();
    for (const section of sections) {
      map.set(section.id, section);
    }
    return map;
  }, [sections]);

  const orderedSections = useMemo(() => {
    const visible: ExplorerSectionSnapshot[] = [];
    for (const sectionId of sectionOrder) {
      const section = sectionsById.get(sectionId);
      if (section) {
        visible.push(section);
      }
    }
    return visible;
  }, [sectionOrder, sectionsById]);

  const basketCount = useMemo(() => sectionsById.get('basket')?.count ?? 0, [sectionsById]);
  const filterUpdateTimeoutRef = useRef<number | null>(null);

  const invokeAction = useCallback((action: ExplorerAction) => {
    postMessage({
      command: 'invokeCommand',
      commandId: action.command,
      args: action.args
    });
  }, [postMessage]);

  const handleFilterChange = useCallback((value: string) => {
    setFilterText(value);
    pendingFilterSyncRef.current = value;

    if (filterUpdateTimeoutRef.current !== null) {
      window.clearTimeout(filterUpdateTimeoutRef.current);
      filterUpdateTimeoutRef.current = null;
    }

    if (value.length === 0) {
      postMessage({
        command: 'setFilter',
        value
      });
      return;
    }

    filterUpdateTimeoutRef.current = window.setTimeout(() => {
      filterUpdateTimeoutRef.current = null;
      postMessage({
        command: 'setFilter',
        value
      });
    }, FILTER_UPDATE_DEBOUNCE_MS);
  }, [postMessage]);

  useEffect(() => () => {
    if (filterUpdateTimeoutRef.current !== null) {
      window.clearTimeout(filterUpdateTimeoutRef.current);
    }
  }, []);

  const handleExpandedItemsChange = useCallback((sectionId: ExplorerTabId, itemIds: string[]) => {
    setExpandedByTab(current => ({
      ...current,
      [sectionId]: itemIds
    }));
  }, []);

  const clearFilter = useCallback(() => {
    handleFilterChange('');
  }, [handleFilterChange]);

  const openSettings = useCallback(() => {
    postMessage({
      command: 'invokeCommand',
      commandId: 'vscode-eda.configureTargets'
    });
  }, [postMessage]);

  const expandAllInSection = useCallback((sectionId: ExplorerTabId, nodes: ExplorerNode[]) => {
    setExpandedByTab(current => ({
      ...current,
      [sectionId]: flattenNodeIds(nodes)
    }));
  }, []);

  const collapseAllInSection = useCallback((sectionId: ExplorerTabId) => {
    setExpandedByTab(current => ({
      ...current,
      [sectionId]: []
    }));
  }, []);

  const toggleSectionCollapsed = useCallback((sectionId: ExplorerTabId) => {
    setCollapsedBySection(current => ({
      ...current,
      [sectionId]: !(current[sectionId] ?? false)
    }));
  }, []);

  const ensureResourcesSectionExpanded = useCallback(() => {
    setCollapsedBySection(current => ({
      ...current,
      resources: false
    }));
  }, []);

  const setSectionRef = useCallback((sectionId: ExplorerTabId, element: HTMLDivElement | null) => {
    sectionRefs.current[sectionId] = element;
  }, []);

  const focusBasketSection = useCallback(() => {
    setCollapsedBySection(current => ({
      ...current,
      basket: false
    }));

    const basketSection = sectionRefs.current.basket;
    if (basketSection) {
      basketSection.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }, []);

  const handleSectionDragStart = useCallback((sectionId: ExplorerTabId) => (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sectionId);
    setDraggingSection(sectionId);
    setDragOverSection(sectionId);
  }, []);

  const handleSectionDragOver = useCallback((sectionId: ExplorerTabId) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (draggingSection && draggingSection !== sectionId) {
      setDragOverSection(sectionId);
    }
  }, [draggingSection]);

  const handleSectionDrop = useCallback((targetId: ExplorerTabId) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sourceValue = event.dataTransfer.getData('text/plain');
    const sourceId = isExplorerTabId(sourceValue) ? sourceValue : draggingSection;

    if (!sourceId || sourceId === targetId) {
      setDraggingSection(null);
      setDragOverSection(null);
      return;
    }

    setSectionOrder(currentOrder => reorderSections(currentOrder, sourceId, targetId));
    setDraggingSection(null);
    setDragOverSection(null);
  }, [draggingSection]);

  const handleSectionDragEnd = useCallback(() => {
    setDraggingSection(null);
    setDragOverSection(null);
  }, []);

  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 0,
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        p: 1.5,
        gap: 1.5
      }}
    >
      {errorMessage && (
        <Alert severity="error" onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      )}

      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          size="small"
          fullWidth
          value={filterText}
          placeholder="Filter"
          onChange={(event) => handleFilterChange(event.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: filterText.length > 0
                ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      aria-label="Clear filter"
                      edge="end"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={clearFilter}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                )
                : undefined
            }
          }}
        />

        <Tooltip title="Open Basket">
          <IconButton
            size="small"
            onClick={focusBasketSection}
            sx={{
              border: '1px solid',
              borderColor: COLOR_DIVIDER,
              color: COLOR_TEXT_PRIMARY,
              '&:hover': {
                borderColor: COLOR_PRIMARY_MAIN,
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14)
              }
            }}
          >
            <Badge
              badgeContent={basketCount}
              color="warning"
              invisible={basketCount <= 0}
            >
              <ShoppingBasketIcon fontSize="small" />
            </Badge>
          </IconButton>
        </Tooltip>

        <Tooltip title="Configure Targets">
          <IconButton
            size="small"
            onClick={openSettings}
            sx={{
              border: '1px solid',
              borderColor: COLOR_DIVIDER,
              color: COLOR_TEXT_PRIMARY,
              '&:hover': {
                borderColor: COLOR_PRIMARY_MAIN,
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.14)
              }
            }}
          >
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack spacing={1} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pr: 0.2 }}>
        {orderedSections.length === 0 && (
          <Paper variant="outlined" sx={{ p: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Loading explorer...
            </Typography>
          </Paper>
        )}

        {orderedSections.map(section => (
          <ExplorerSectionCard
            key={section.id}
            section={section}
            expandedItems={expandedByTab[section.id] ?? []}
            isCollapsed={collapsedBySection[section.id] ?? false}
            isDropTarget={dragOverSection === section.id && draggingSection !== section.id}
            isBeingDragged={draggingSection === section.id}
            onSetSectionRef={setSectionRef}
            onSectionDragStart={handleSectionDragStart}
            onSectionDragOver={handleSectionDragOver}
            onSectionDrop={handleSectionDrop}
            onSectionDragEnd={handleSectionDragEnd}
            onToggleSectionCollapsed={toggleSectionCollapsed}
            onInvokeAction={invokeAction}
            onExpandedItemsChange={handleExpandedItemsChange}
            onEnsureResourcesSectionExpanded={ensureResourcesSectionExpanded}
            onExpandAllInSection={expandAllInSection}
            onCollapseAllInSection={collapseAllInSection}
          />
        ))}
      </Stack>
    </Box>
  );
}

mountWebview(EdaExplorerView);
