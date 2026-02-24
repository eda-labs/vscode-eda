import {
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  MoreVert as MoreVertIcon
} from '@mui/icons-material';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import { memo, useCallback, useMemo, type MouseEvent, type ReactNode } from 'react';

import type { ExplorerAction, ExplorerNode } from '../shared/explorer/types';

interface ResourceVisibleNode { node: ExplorerNode; depth: number; }

type OpenActionMenu = (
  event: MouseEvent<HTMLElement>,
  actions: ExplorerAction[],
  anchorType: 'anchor' | 'position'
) => void;

type RenderPrimaryLabel = (
  node: ExplorerNode,
  hasEntryTooltip: boolean,
  primaryAction: ExplorerAction | undefined
) => ReactNode;

interface ResourceSectionTreeProps {
  nodes: ExplorerNode[];
  expandedItems: string[];
  onExpandedItemsChange: (itemIds: string[]) => void;
  enableEntryTooltip: boolean;
  onInvokeAction: (action: ExplorerAction) => void;
  onOpenActionMenu: OpenActionMenu;
  resolveNodePrimaryAction: (node: ExplorerNode) => ExplorerAction | undefined;
  canBuildResourceActions: (node: ExplorerNode) => boolean;
  getNodeActionList: (node: ExplorerNode) => ExplorerAction[];
  renderPrimaryLabel: RenderPrimaryLabel;
  colorTextPrimary: string;
  showResourceActionButtons: boolean;
}

interface ResourceSectionRowProps {
  node: ExplorerNode;
  depth: number;
  expandedItems: string[];
  expandedSet: ReadonlySet<string>;
  enableEntryTooltip: boolean;
  onExpandedItemsChange: (itemIds: string[]) => void;
  onInvokeAction: (action: ExplorerAction) => void;
  onOpenActionMenu: OpenActionMenu;
  resolveNodePrimaryAction: (node: ExplorerNode) => ExplorerAction | undefined;
  canBuildResourceActions: (node: ExplorerNode) => boolean;
  getNodeActionList: (node: ExplorerNode) => ExplorerAction[];
  renderPrimaryLabel: RenderPrimaryLabel;
  colorTextPrimary: string;
  showResourceActionButtons: boolean;
}

interface NodeMenuState {
  hasActions: boolean;
  menuActions: ExplorerAction[];
  showActionButton: boolean;
}

const EMPTY_ACTIONS: ExplorerAction[] = [];

function flattenVisibleResourceNodes(nodes: ExplorerNode[], expandedSet: ReadonlySet<string>): ResourceVisibleNode[] {
  const visible: ResourceVisibleNode[] = [];
  const stack: Array<{ node: ExplorerNode; depth: number }> = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    stack.push({ node: nodes[index], depth: 0 });
  }
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) {
      continue;
    }
    visible.push({ node: next.node, depth: next.depth });
    if (!expandedSet.has(next.node.id) || next.node.children.length === 0) {
      continue;
    }
    for (let index = next.node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: next.node.children[index], depth: next.depth + 1 });
    }
  }
  return visible;
}

function toggleExpandedItem(expandedItems: string[], itemId: string): string[] {
  const next = new Set(expandedItems);
  if (next.has(itemId)) {
    next.delete(itemId);
  } else {
    next.add(itemId);
  }
  return Array.from(next);
}

function buildNodeMenuState(
  node: ExplorerNode,
  canBuildResourceActions: (node: ExplorerNode) => boolean,
  getNodeActionList: (node: ExplorerNode) => ExplorerAction[],
  showResourceActionButtons: boolean
): NodeMenuState {
  const hasInlineActions = node.actions.length > 0;
  const hasResourceActions = canBuildResourceActions(node);
  const hasActions = hasInlineActions || hasResourceActions;

  return {
    hasActions,
    menuActions: hasActions ? getNodeActionList(node) : EMPTY_ACTIONS,
    showActionButton: hasInlineActions || (hasResourceActions && showResourceActionButtons)
  };
}

const ResourceSectionRow = memo(function ResourceSectionRow({
  node,
  depth,
  expandedItems,
  expandedSet,
  enableEntryTooltip,
  onExpandedItemsChange,
  onInvokeAction,
  onOpenActionMenu,
  resolveNodePrimaryAction,
  canBuildResourceActions,
  getNodeActionList,
  renderPrimaryLabel,
  colorTextPrimary,
  showResourceActionButtons
}: Readonly<ResourceSectionRowProps>) {
  const hasChildren = node.children.length > 0;
  const isExpanded = hasChildren && expandedSet.has(node.id);
  const primaryAction = resolveNodePrimaryAction(node);
  const hasEntryTooltip = enableEntryTooltip && Boolean(node.tooltip) && !hasChildren;
  const indentation = depth * 1.6;
  const menuState = buildNodeMenuState(
    node,
    canBuildResourceActions,
    getNodeActionList,
    showResourceActionButtons
  );

  const handleToggleExpanded = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onExpandedItemsChange(toggleExpandedItem(expandedItems, node.id));
  }, [expandedItems, node.id, onExpandedItemsChange]);

  const handleInvokePrimaryAction = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!primaryAction) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onInvokeAction(primaryAction);
  }, [onInvokeAction, primaryAction]);

  const handleOpenContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!menuState.hasActions) {
      return;
    }
    onOpenActionMenu(event, menuState.menuActions, 'position');
  }, [menuState.hasActions, menuState.menuActions, onOpenActionMenu]);

  return (
    <Box
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        minHeight: 24,
        py: 0.2,
        pl: 0.4 + indentation,
        pr: 0.4,
        contentVisibility: 'auto',
        containIntrinsicSize: '24px'
      }}
    >
      {hasChildren
        ? (
          <IconButton
            size="small"
            onClick={handleToggleExpanded}
            sx={{ p: 0.2, mr: 0.2 }}
            aria-label={isExpanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
          >
            {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        )
        : <Box sx={{ width: 22, height: 22, mr: 0.2 }} />}

      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        onContextMenu={handleOpenContextMenu}
        sx={{ width: '100%' }}
      >
        <Box
          onClick={handleInvokePrimaryAction}
          sx={{
            minWidth: 0,
            flex: 1,
            cursor: primaryAction ? 'pointer' : 'default'
          }}
        >
          {renderPrimaryLabel(node, hasEntryTooltip, primaryAction)}
          {(node.description || node.statusDescription) && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {node.description || node.statusDescription}
            </Typography>
          )}
        </Box>

        {menuState.showActionButton && (
          <IconButton
            size="small"
            onClick={(event) => onOpenActionMenu(event, menuState.menuActions, 'anchor')}
            aria-label={`Actions for ${node.label}`}
            sx={{ width: 22, height: 22, p: 0.25, color: colorTextPrimary }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>
    </Box>
  );
});

export const ResourceSectionTree = memo(function ResourceSectionTree({
  nodes,
  expandedItems,
  onExpandedItemsChange,
  enableEntryTooltip,
  onInvokeAction,
  onOpenActionMenu,
  resolveNodePrimaryAction,
  canBuildResourceActions,
  getNodeActionList,
  renderPrimaryLabel,
  colorTextPrimary,
  showResourceActionButtons
}: Readonly<ResourceSectionTreeProps>) {
  const expandedSet = useMemo(() => new Set(expandedItems), [expandedItems]);
  const visibleRows = useMemo(() => flattenVisibleResourceNodes(nodes, expandedSet), [nodes, expandedSet]);

  return (
    <Box role="tree" sx={{ minHeight: 0 }}>
      {visibleRows.map(({ node, depth }) => (
        <ResourceSectionRow
          key={node.id}
          node={node}
          depth={depth}
          expandedItems={expandedItems}
          expandedSet={expandedSet}
          enableEntryTooltip={enableEntryTooltip}
          onExpandedItemsChange={onExpandedItemsChange}
          onInvokeAction={onInvokeAction}
          onOpenActionMenu={onOpenActionMenu}
          resolveNodePrimaryAction={resolveNodePrimaryAction}
          canBuildResourceActions={canBuildResourceActions}
          getNodeActionList={getNodeActionList}
          renderPrimaryLabel={renderPrimaryLabel}
          colorTextPrimary={colorTextPrimary}
          showResourceActionButtons={showResourceActionButtons}
        />
      ))}
    </Box>
  );
});
