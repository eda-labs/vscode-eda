import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import ShoppingBasketIcon from '@mui/icons-material/ShoppingBasket';
import {
  Alert,
  Badge,
  Button,
  Box,
  IconButton,
  InputAdornment,
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
import { useCallback, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';

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

const STATUS_COLOR_MAP: Record<string, string> = {
  green: 'success.main',
  red: 'error.main',
  yellow: 'warning.main',
  blue: 'info.main',
  gray: 'text.disabled'
};
const DEFAULT_STATUS_COLOR = 'text.disabled';
const COLOR_TEXT_PRIMARY = 'text.primary';
const COLOR_PRIMARY_MAIN = 'primary.main';
const COLOR_DIVIDER = 'divider';
const DEFAULT_EXPANDED_SECTIONS = new Set<ExplorerTabId>(['dashboards', 'resources']);

const TOOLBAR_BUTTON_SX = {
  minHeight: 28,
  px: 1.25,
  py: 0.25,
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

function ExplorerNodeLabel({ node, onInvokeAction }: Readonly<ExplorerNodeLabelProps>) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const hasActions = node.actions.length > 0;

  const handleMenuOpen = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  }, []);

  const handleMenuClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handlePrimaryAction = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!node.primaryAction) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onInvokeAction(node.primaryAction);
  }, [node.primaryAction, onInvokeAction]);

  const menuOpen = Boolean(anchorEl);

  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
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
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={menuOpen}
            onClose={handleMenuClose}
            onClick={handleMenuClose}
          >
            {node.actions.map(action => (
              <MenuItem
                key={action.id}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onInvokeAction(action);
                }}
              >
                {action.label}
              </MenuItem>
            ))}
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
        '& .MuiTreeItem-content': { py: 0.3 },
        '& .MuiTreeItem-label': { width: '100%' }
      }}
    >
      {renderTreeNodes(section.nodes, onInvokeAction)}
    </SimpleTreeView>
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

  useReadySignal();

  useMessageListener<ExplorerIncomingMessage>(useCallback((message) => {
    if (message.command === 'snapshot') {
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

  const invokeAction = useCallback((action: ExplorerAction) => {
    postMessage({
      command: 'invokeCommand',
      commandId: action.command,
      args: action.args
    });
  }, [postMessage]);

  const handleFilterChange = useCallback((value: string) => {
    setFilterText(value);
    postMessage({
      command: 'setFilter',
      value
    });
  }, [postMessage]);

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
              )
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

      {filterText.length > 0 && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <Button size="small" onClick={clearFilter} sx={TOOLBAR_BUTTON_SX}>
            Clear Filter
          </Button>
        </Stack>
      )}

      <Stack spacing={1} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pr: 0.2 }}>
        {orderedSections.length === 0 && (
          <Paper variant="outlined" sx={{ p: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Loading explorer...
            </Typography>
          </Paper>
        )}

        {orderedSections.map(section => {
          const isCollapsed = collapsedBySection[section.id] ?? false;
          const isDropTarget = dragOverSection === section.id && draggingSection !== section.id;
          const isBeingDragged = draggingSection === section.id;
          const expandedItems = expandedByTab[section.id] ?? [];
          const hasToolbar = section.toolbarActions.length > 0 || section.id === 'resources';

          return (
            <Paper
              key={section.id}
              variant="outlined"
              ref={(element: HTMLDivElement | null) => {
                sectionRefs.current[section.id] = element;
              }}
              sx={{
                flexShrink: 0,
                overflow: 'hidden',
                borderColor: isDropTarget ? COLOR_PRIMARY_MAIN : COLOR_DIVIDER,
                transition: 'border-color 0.12s ease, box-shadow 0.12s ease',
                boxShadow: isDropTarget
                  ? (theme) => `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.35)}`
                  : 'none'
              }}
            >
              <Box
                draggable
                onDragStart={handleSectionDragStart(section.id)}
                onDragOver={handleSectionDragOver(section.id)}
                onDrop={handleSectionDrop(section.id)}
                onDragEnd={handleSectionDragEnd}
                sx={{
                  px: 1,
                  py: 0.75,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.25,
                  borderBottom: isCollapsed ? 'none' : '1px solid',
                  borderColor: COLOR_DIVIDER,
                  cursor: isBeingDragged ? 'grabbing' : 'grab',
                  userSelect: 'none',
                  bgcolor: (theme) => isBeingDragged
                    ? alpha(theme.palette.primary.main, 0.1)
                    : alpha(theme.palette.background.default, 0.55)
                }}
              >
                <Tooltip title="Drag to reorder section">
                  <Box
                    component="span"
                    sx={{
                      color: 'text.secondary',
                      lineHeight: 1,
                      fontSize: 12,
                      letterSpacing: '-0.5px',
                      px: 0.35
                    }}
                  >
                    ::::
                  </Box>
                </Tooltip>
                <IconButton
                  size="small"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleSectionCollapsed(section.id);
                  }}
                  aria-label={isCollapsed ? `Expand ${section.label}` : `Collapse ${section.label}`}
                  sx={{ color: COLOR_TEXT_PRIMARY }}
                >
                  {isCollapsed ? <ChevronRightIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </IconButton>
                <Box
                  onClick={() => toggleSectionCollapsed(section.id)}
                  sx={{ minWidth: 0, flex: 1, cursor: 'pointer' }}
                >
                  <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700 }}>
                    {formatSectionTitle(section)}
                  </Typography>
                </Box>
              </Box>

              {!isCollapsed && (
                <Box sx={{ p: 1 }}>
                  {hasToolbar && (
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', mb: 1 }}>
                      {section.toolbarActions.map(action => (
                        <Button
                          key={action.id}
                          size="small"
                          sx={TOOLBAR_BUTTON_SX}
                          onClick={() => invokeAction(action)}
                        >
                          {action.label}
                        </Button>
                      ))}

                      {section.id === 'resources' && (
                        <>
                          <Button
                            size="small"
                            onClick={() => expandAllInSection(section.id, section.nodes)}
                            sx={TOOLBAR_BUTTON_SX}
                          >
                            Expand All
                          </Button>
                          <Button
                            size="small"
                            onClick={() => collapseAllInSection(section.id)}
                            sx={TOOLBAR_BUTTON_SX}
                          >
                            Collapse All
                          </Button>
                        </>
                      )}
                    </Stack>
                  )}

                  <SectionTree
                    section={section}
                    expandedItems={expandedItems}
                    onExpandedItemsChange={(itemIds) => handleExpandedItemsChange(section.id, itemIds)}
                    onInvokeAction={invokeAction}
                  />
                </Box>
              )}
            </Paper>
          );
        })}
      </Stack>
    </Box>
  );
}

mountWebview(EdaExplorerView);
