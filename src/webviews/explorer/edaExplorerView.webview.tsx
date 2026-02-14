import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import ShoppingBasketIcon from '@mui/icons-material/ShoppingBasket';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
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
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';

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

function flattenNodeIds(nodes: ExplorerNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    ids.push(...flattenNodeIds(node.children));
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
        minHeight: 240,
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

function EdaExplorerView() {
  const postMessage = usePostMessage();
  const [sections, setSections] = useState<ExplorerSectionSnapshot[]>([]);
  const [activeTab, setActiveTab] = useState<ExplorerTabId>('resources');
  const [filterText, setFilterText] = useState('');
  const [expandedByTab, setExpandedByTab] = useState<Partial<Record<ExplorerTabId, string[]>>>({
    resources: []
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useReadySignal();

  useMessageListener<ExplorerIncomingMessage>(useCallback((message) => {
    if (message.command === 'snapshot') {
      setSections(message.sections);
      setFilterText(message.filterText);
      setActiveTab(current => {
        const stillVisible = message.sections.some(section => section.id === current);
        if (stillVisible) {
          return current;
        }
        return message.sections[0]?.id ?? 'resources';
      });
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

  const activeSection = useMemo(() => getSectionById(sections, activeTab), [activeTab, sections]);
  const basketCount = useMemo(() => getSectionById(sections, 'basket')?.count ?? 0, [sections]);
  const expandedItems = expandedByTab[activeTab] ?? [];
  const allNodeIds = useMemo(() => flattenNodeIds(activeSection?.nodes ?? []), [activeSection]);

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

  const handleExpandedItemsChange = useCallback((itemIds: string[]) => {
    setExpandedByTab(current => ({
      ...current,
      [activeTab]: itemIds
    }));
  }, [activeTab]);

  const clearFilter = useCallback(() => {
    handleFilterChange('');
  }, [handleFilterChange]);

  const openSettings = useCallback(() => {
    postMessage({
      command: 'invokeCommand',
      commandId: 'vscode-eda.configureTargets'
    });
  }, [postMessage]);

  const expandAll = useCallback(() => {
    setExpandedByTab(current => ({
      ...current,
      [activeTab]: allNodeIds
    }));
  }, [activeTab, allNodeIds]);

  const collapseAll = useCallback(() => {
    setExpandedByTab(current => ({
      ...current,
      [activeTab]: []
    }));
  }, [activeTab]);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', p: 1.5, gap: 1.5 }}>
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
          placeholder="Filter (supports regex)"
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
            onClick={() => setActiveTab('basket')}
            sx={{
              border: '1px solid',
              borderColor: activeTab === 'basket' ? COLOR_PRIMARY_MAIN : COLOR_DIVIDER,
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

      <Box sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
        <Tabs
          value={activeTab}
          onChange={(_event, nextTab: ExplorerTabId) => setActiveTab(nextTab)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          aria-label="EDA explorer sections"
          sx={{
            minHeight: 36,
            borderBottom: '1px solid',
            borderColor: COLOR_DIVIDER,
            '& .MuiTab-root': {
              minHeight: 36,
              minWidth: 'fit-content',
              textTransform: 'none',
              color: 'text.secondary'
            },
            '& .MuiTab-root.Mui-selected': {
              color: COLOR_TEXT_PRIMARY,
              fontWeight: 700
            },
            '& .MuiTabs-scrollButtons': {
              color: COLOR_TEXT_PRIMARY,
              opacity: 0.9
            },
            '& .MuiTabs-scrollButtons.Mui-disabled': {
              display: 'none'
            }
          }}
        >
          {EXPLORER_TAB_ORDER.map(tabId => {
            const section = getSectionById(sections, tabId);
            const count = section?.count ?? 0;
            const label = section?.label ?? tabId;
            return <Tab key={tabId} value={tabId} label={`${label} (${count})`} />;
          })}
        </Tabs>
      </Box>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        {filterText.length > 0 && (
          <Button size="small" onClick={clearFilter} sx={TOOLBAR_BUTTON_SX}>
            Clear Filter
          </Button>
        )}

        {activeSection?.toolbarActions.map(action => (
          <Button
            key={action.id}
            size="small"
            sx={TOOLBAR_BUTTON_SX}
            onClick={() => invokeAction(action)}
          >
            {action.label}
          </Button>
        ))}

        {activeTab === 'resources' && (
          <>
            <Button size="small" onClick={expandAll} sx={TOOLBAR_BUTTON_SX}>
              <UnfoldMoreIcon fontSize="small" sx={{ mr: 0.5 }} /> Expand All
            </Button>
            <Button size="small" onClick={collapseAll} sx={TOOLBAR_BUTTON_SX}>
              <UnfoldLessIcon fontSize="small" sx={{ mr: 0.5 }} /> Collapse All
            </Button>
          </>
        )}
      </Stack>

      <Paper variant="outlined" sx={{ flex: 1, overflow: 'auto', p: 1 }}>
        {activeSection ? (
          <SectionTree
            section={activeSection}
            expandedItems={expandedItems}
            onExpandedItemsChange={handleExpandedItemsChange}
            onInvokeAction={invokeAction}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            Loading explorer...
          </Typography>
        )}
      </Paper>
    </Box>
  );
}

mountWebview(EdaExplorerView);
