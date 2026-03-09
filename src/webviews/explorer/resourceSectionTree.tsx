import {
  MoreVert as MoreVertIcon
} from '@mui/icons-material';
import { Box, IconButton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type UIEvent
} from 'react';

import type { ExplorerAction, ExplorerNode } from '../shared/explorer/types';
import { NokiaExplorerIcon } from './nokiaExplorerIcons';
import type { ExplorerResourceListPayload } from './explorerResourceListTypes';

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
  selectedNamespace: string;
}

interface ResourceSectionRowProps {
  node: ExplorerNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  enableEntryTooltip: boolean;
  onToggleExpandedItem: (itemId: string) => void;
  onSelectNode: (node: ExplorerNode) => void;
  onInvokeAction: (action: ExplorerAction) => void;
  onOpenActionMenu: OpenActionMenu;
  resolveNodePrimaryAction: (node: ExplorerNode) => ExplorerAction | undefined;
  canBuildResourceActions: (node: ExplorerNode) => boolean;
  getNodeActionList: (node: ExplorerNode) => ExplorerAction[];
  resolveNodeCountLabel: (node: ExplorerNode) => string | undefined;
  renderPrimaryLabel: RenderPrimaryLabel;
  colorTextPrimary: string;
  showResourceActionButtons: boolean;
}

interface EdaResourceLookup {
  categoryById: Map<string, ExplorerNode>;
  streamById: Map<string, ExplorerNode>;
  streamToCategoryId: Map<string, string>;
  resourcesByCategoryId: Map<string, ExplorerNode[]>;
  resourcesByStreamId: Map<string, ExplorerNode[]>;
}

interface NodeMenuState {
  hasActions: boolean;
  menuActions: ExplorerAction[];
  showActionButton: boolean;
}

const LARGE_RESOURCE_ROW_THRESHOLD = 350;
const RESOURCE_ROW_HEIGHT_PX = 26;
const RESOURCE_OVERSCAN_ROWS = 12;
const RESOURCE_VIRTUALIZED_MAX_HEIGHT = 'min(64vh, 720px)';
export const ALL_RESOURCE_NAMESPACES_VALUE = '__all_namespaces__';

const OPEN_RESOURCE_LIST_COMMAND = 'vscode-eda.openExplorerResourceList';
const EMPTY_ACTIONS: ExplorerAction[] = [];

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function firstNonEmptyLine(value: string): string {
  const line = value
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(part => part.length > 0);
  return line ?? '';
}

function getResourceNamespace(node: ExplorerNode): string {
  const commandArg = toRecord(node.commandArg);
  const namespace = commandArg?.namespace;
  if (typeof namespace === 'string' && namespace.length > 0) {
    return namespace;
  }

  const slash = node.label.indexOf('/');
  if (slash > 0) {
    return node.label.slice(0, slash);
  }
  return '';
}

function getResourceName(node: ExplorerNode): string {
  const commandArg = toRecord(node.commandArg);
  const name = commandArg?.name;
  if (typeof name === 'string' && name.length > 0) {
    return firstNonEmptyLine(name);
  }

  const label = firstNonEmptyLine(node.label);
  const slash = label.indexOf('/');
  if (slash >= 0 && slash < label.length - 1) {
    return label.slice(slash + 1);
  }
  return label;
}

function getResourceKind(node: ExplorerNode): string {
  const commandArg = toRecord(node.commandArg);
  const kind = commandArg?.kind;
  if (typeof kind === 'string' && kind.length > 0) {
    return kind;
  }
  return '';
}

function getResourceStream(node: ExplorerNode): string {
  const commandArg = toRecord(node.commandArg);
  const stream = commandArg?.resourceType;
  if (typeof stream === 'string' && stream.length > 0) {
    return stream;
  }
  return '';
}

function getResourceApiVersion(node: ExplorerNode): string {
  const commandArg = toRecord(node.commandArg);
  const apiVersion = commandArg?.apiVersion;
  if (typeof apiVersion === 'string' && apiVersion.length > 0) {
    return apiVersion;
  }
  return '';
}

function getResourceLabels(node: ExplorerNode): string {
  const commandArg = toRecord(node.commandArg);
  const labelsText = commandArg?.labelsText;
  if (typeof labelsText === 'string' && labelsText.length > 0) {
    return labelsText;
  }
  return '';
}

function isResourceLeaf(node: ExplorerNode): boolean {
  return node.commandArg !== undefined && node.children.length === 0;
}

function includesNamespace(node: ExplorerNode, selectedNamespace: string): boolean {
  if (selectedNamespace === ALL_RESOURCE_NAMESPACES_VALUE) {
    return true;
  }

  for (const child of node.children) {
    if (isResourceLeaf(child) && getResourceNamespace(child) === selectedNamespace) {
      return true;
    }
  }
  return false;
}

function filterAndStripEdaLeaves(
  node: ExplorerNode,
  selectedNamespace: string,
  underEdaCategory: boolean
): ExplorerNode | undefined {
  if (node.contextValue === 'resource-category') {
    const children = node.children
      .map(child => filterAndStripEdaLeaves(child, selectedNamespace, true))
      .filter((child): child is ExplorerNode => Boolean(child));

    if (children.length === 0) {
      return undefined;
    }

    return {
      ...node,
      children
    };
  }

  if (underEdaCategory && node.contextValue === 'stream') {
    if (!includesNamespace(node, selectedNamespace)) {
      return undefined;
    }

    return {
      ...node,
      children: []
    };
  }

  const children = node.children
    .map(child => filterAndStripEdaLeaves(child, selectedNamespace, underEdaCategory))
    .filter((child): child is ExplorerNode => Boolean(child));

  return {
    ...node,
    children
  };
}

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

function collectNodeIds(nodes: ExplorerNode[]): Set<string> {
  const ids = new Set<string>();
  const stack = [...nodes];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) {
      continue;
    }
    ids.add(next.id);
    for (const child of next.children) {
      stack.push(child);
    }
  }
  return ids;
}

function buildEdaResourceLookup(nodes: ExplorerNode[]): EdaResourceLookup {
  const categoryById = new Map<string, ExplorerNode>();
  const streamById = new Map<string, ExplorerNode>();
  const streamToCategoryId = new Map<string, string>();
  const resourcesByCategoryId = new Map<string, ExplorerNode[]>();
  const resourcesByStreamId = new Map<string, ExplorerNode[]>();

  for (const categoryNode of nodes) {
    if (categoryNode.contextValue !== 'resource-category') {
      continue;
    }

    categoryById.set(categoryNode.id, categoryNode);

    const categoryResources: ExplorerNode[] = [];
    for (const streamNode of categoryNode.children) {
      if (streamNode.contextValue !== 'stream') {
        continue;
      }

      streamById.set(streamNode.id, streamNode);
      streamToCategoryId.set(streamNode.id, categoryNode.id);

      const resources = streamNode.children.filter(isResourceLeaf);
      resourcesByStreamId.set(streamNode.id, resources);
      categoryResources.push(...resources);
    }

    resourcesByCategoryId.set(categoryNode.id, categoryResources);
  }

  return {
    categoryById,
    streamById,
    streamToCategoryId,
    resourcesByCategoryId,
    resourcesByStreamId
  };
}

function isEdaSelectionNode(lookup: EdaResourceLookup, nodeId: string | undefined): boolean {
  if (!nodeId) {
    return false;
  }

  return lookup.categoryById.has(nodeId) || lookup.streamById.has(nodeId);
}

function resolveSelectedResources(
  lookup: EdaResourceLookup,
  selectedNodeId: string,
  selectedNamespace: string
): ExplorerNode[] {
  const all = lookup.resourcesByStreamId.get(selectedNodeId)
    ?? lookup.resourcesByCategoryId.get(selectedNodeId)
    ?? [];

  if (selectedNamespace === ALL_RESOURCE_NAMESPACES_VALUE) {
    return all;
  }

  return all.filter(resource => getResourceNamespace(resource) === selectedNamespace);
}

function resolveSelectedNodeTitle(lookup: EdaResourceLookup, selectedNodeId: string): string {
  if (lookup.streamById.has(selectedNodeId)) {
    const streamNode = lookup.streamById.get(selectedNodeId);
    const categoryId = lookup.streamToCategoryId.get(selectedNodeId);
    const categoryNode = categoryId ? lookup.categoryById.get(categoryId) : undefined;
    if (streamNode && categoryNode) {
      return `${categoryNode.label} / ${streamNode.label}`;
    }
    return streamNode?.label ?? 'Resources';
  }

  return lookup.categoryById.get(selectedNodeId)?.label ?? 'Resources';
}

function sortResources(resources: ExplorerNode[]): ExplorerNode[] {
  return resources
    .slice()
    .sort((a, b) => {
      const namespaceCompare = getResourceNamespace(a).localeCompare(getResourceNamespace(b));
      if (namespaceCompare !== 0) {
        return namespaceCompare;
      }
      return getResourceName(a).localeCompare(getResourceName(b));
    });
}

function countResourcesForNamespace(resources: ExplorerNode[], selectedNamespace: string): number {
  if (selectedNamespace === ALL_RESOURCE_NAMESPACES_VALUE) {
    return resources.length;
  }
  let count = 0;
  for (const resource of resources) {
    if (getResourceNamespace(resource) === selectedNamespace) {
      count += 1;
    }
  }
  return count;
}

function formatResourceCountLabel(selectedCount: number, totalCount: number): string | undefined {
  if (totalCount <= 0) {
    return undefined;
  }
  return `(${selectedCount}/${totalCount})`;
}

function buildEdaNodeCountLabelById(
  lookup: EdaResourceLookup,
  selectedNamespace: string
): Map<string, string> {
  const labels = new Map<string, string>();

  for (const [categoryId, resources] of lookup.resourcesByCategoryId.entries()) {
    const selectedCount = countResourcesForNamespace(resources, selectedNamespace);
    const label = formatResourceCountLabel(selectedCount, resources.length);
    if (label) {
      labels.set(categoryId, label);
    }
  }

  for (const [streamId, resources] of lookup.resourcesByStreamId.entries()) {
    const selectedCount = countResourcesForNamespace(resources, selectedNamespace);
    const label = formatResourceCountLabel(selectedCount, resources.length);
    if (label) {
      labels.set(streamId, label);
    }
  }

  return labels;
}

function findFirstEdaSelectionNodeId(nodes: ExplorerNode[]): string | undefined {
  for (const node of nodes) {
    if (node.contextValue !== 'resource-category') {
      continue;
    }

    const firstStream = node.children.find(child => child.contextValue === 'stream');
    if (firstStream) {
      return firstStream.id;
    }

    return node.id;
  }

  return undefined;
}

const ResourceSectionRow = memo(function ResourceSectionRow({
  node,
  depth,
  hasChildren,
  isExpanded,
  isSelected,
  enableEntryTooltip,
  onToggleExpandedItem,
  onSelectNode,
  onInvokeAction,
  onOpenActionMenu,
  resolveNodePrimaryAction,
  canBuildResourceActions,
  getNodeActionList,
  resolveNodeCountLabel,
  renderPrimaryLabel,
  colorTextPrimary,
  showResourceActionButtons
}: Readonly<ResourceSectionRowProps>) {
  const primaryAction = resolveNodePrimaryAction(node);
  const hasEntryTooltip = enableEntryTooltip && Boolean(node.tooltip) && !hasChildren;
  const indentation = depth * 1.6;
  const nodeCountLabel = resolveNodeCountLabel(node);
  const menuState = buildNodeMenuState(
    node,
    canBuildResourceActions,
    getNodeActionList,
    showResourceActionButtons
  );

  const handleToggleExpanded = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onToggleExpandedItem(node.id);
  }, [node.id, onToggleExpandedItem]);

  const handleRowClick = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSelectNode(node);

    if (hasChildren) {
      onToggleExpandedItem(node.id);
      return;
    }

    if (primaryAction) {
      onInvokeAction(primaryAction);
    }
  }, [hasChildren, node, onInvokeAction, onSelectNode, onToggleExpandedItem, primaryAction]);

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
        borderRadius: 0.75,
        bgcolor: isSelected ? (theme) => alpha(theme.palette.primary.main, 0.14) : undefined,
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
            {isExpanded ? (
              <NokiaExplorerIcon name="chevrondown" fontSize="small" />
            ) : (
              <NokiaExplorerIcon name="chevronright" fontSize="small" />
            )}
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
          onClick={handleRowClick}
          sx={{
            minWidth: 0,
            flex: 1,
            cursor: hasChildren || primaryAction ? 'pointer' : 'default'
          }}
        >
          <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              {renderPrimaryLabel(node, hasEntryTooltip, primaryAction)}
            </Box>
            {nodeCountLabel && (
              <Typography variant="caption" color="text.secondary" sx={{ flex: '0 0 auto' }}>
                {nodeCountLabel}
              </Typography>
            )}
          </Stack>
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
  showResourceActionButtons,
  selectedNamespace
}: Readonly<ResourceSectionTreeProps>) {
  const treeNodes = useMemo(
    () => nodes
      .map(node => filterAndStripEdaLeaves(node, selectedNamespace, false))
      .filter((node): node is ExplorerNode => Boolean(node)),
    [nodes, selectedNamespace]
  );
  const treeNodeIds = useMemo(() => collectNodeIds(treeNodes), [treeNodes]);
  const edaLookup = useMemo(() => buildEdaResourceLookup(nodes), [nodes]);
  const edaNodeCountLabelById = useMemo(
    () => buildEdaNodeCountLabelById(edaLookup, selectedNamespace),
    [edaLookup, selectedNamespace]
  );
  const resolveNodeCountLabel = useCallback((node: ExplorerNode): string | undefined => {
    if (node.contextValue === 'resource-category' || edaLookup.streamById.has(node.id)) {
      return edaNodeCountLabelById.get(node.id);
    }
    return undefined;
  }, [edaLookup, edaNodeCountLabelById]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (selectedNodeId && treeNodeIds.has(selectedNodeId)) {
      return;
    }
    setSelectedNodeId(findFirstEdaSelectionNodeId(treeNodes));
  }, [selectedNodeId, treeNodeIds, treeNodes]);

  const expandedSet = useMemo(() => new Set(expandedItems), [expandedItems]);
  const visibleRows = useMemo(() => flattenVisibleResourceNodes(treeNodes, expandedSet), [treeNodes, expandedSet]);
  const shouldVirtualize = visibleRows.length >= LARGE_RESOURCE_ROW_THRESHOLD;

  const expandedItemsRef = useRef(expandedItems);
  const selectedNamespaceRef = useRef(selectedNamespace);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    expandedItemsRef.current = expandedItems;
  }, [expandedItems]);

  const handleToggleExpandedItem = useCallback((itemId: string) => {
    const next = toggleExpandedItem(expandedItemsRef.current, itemId);
    expandedItemsRef.current = next;
    onExpandedItemsChange(next);
  }, [onExpandedItemsChange]);

  const handleOpenResourceList = useCallback((nodeId: string) => {
    if (!isEdaSelectionNode(edaLookup, nodeId)) {
      return;
    }

    const resources = sortResources(resolveSelectedResources(edaLookup, nodeId, selectedNamespace));
    const title = resolveSelectedNodeTitle(edaLookup, nodeId);

    const payload: ExplorerResourceListPayload = {
      title,
      namespace: selectedNamespace,
      resources: resources.map((resource) => ({
        id: resource.id,
        label: resource.label,
        name: getResourceName(resource),
        namespace: getResourceNamespace(resource),
        kind: getResourceKind(resource),
        stream: getResourceStream(resource),
        labels: getResourceLabels(resource),
        apiVersion: getResourceApiVersion(resource),
        state: resource.statusDescription,
        description: resource.description,
        statusDescription: resource.statusDescription,
        statusIndicator: resource.statusIndicator,
        primaryAction: resolveNodePrimaryAction(resource),
        actions: getNodeActionList(resource)
      }))
    };

    onInvokeAction({
      id: `${OPEN_RESOURCE_LIST_COMMAND}:${nodeId}:${selectedNamespace}`,
      label: 'Open Resource List',
      command: OPEN_RESOURCE_LIST_COMMAND,
      args: [payload]
    });
  }, [edaLookup, getNodeActionList, onInvokeAction, resolveNodePrimaryAction, selectedNamespace]);

  const handleSelectNode = useCallback((node: ExplorerNode) => {
    setSelectedNodeId(node.id);
    handleOpenResourceList(node.id);
  }, [handleOpenResourceList]);

  const handleVirtualizedScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  useEffect(() => {
    if (selectedNamespaceRef.current === selectedNamespace) {
      return;
    }
    selectedNamespaceRef.current = selectedNamespace;

    const nodeIdToOpen = selectedNodeId && treeNodeIds.has(selectedNodeId)
      ? selectedNodeId
      : findFirstEdaSelectionNodeId(treeNodes);
    if (!nodeIdToOpen) {
      return;
    }

    handleOpenResourceList(nodeIdToOpen);
  }, [handleOpenResourceList, selectedNamespace, selectedNodeId, treeNodeIds, treeNodes]);

  useEffect(() => {
    if (!shouldVirtualize) {
      setScrollTop(0);
    }
  }, [shouldVirtualize]);

  useEffect(() => {
    if (!shouldVirtualize) {
      return;
    }

    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const measure = () => {
      setViewportHeight(element.clientHeight);
    };
    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldVirtualize]);

  const windowedRows = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        rows: visibleRows,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0
      };
    }

    const effectiveViewportHeight = viewportHeight > 0 ? viewportHeight : 480;
    const startIndex = Math.max(0, Math.floor(scrollTop / RESOURCE_ROW_HEIGHT_PX) - RESOURCE_OVERSCAN_ROWS);
    const endIndex = Math.min(
      visibleRows.length,
      Math.ceil((scrollTop + effectiveViewportHeight) / RESOURCE_ROW_HEIGHT_PX) + RESOURCE_OVERSCAN_ROWS
    );

    return {
      rows: visibleRows.slice(startIndex, endIndex),
      topSpacerHeight: startIndex * RESOURCE_ROW_HEIGHT_PX,
      bottomSpacerHeight: Math.max(0, (visibleRows.length - endIndex) * RESOURCE_ROW_HEIGHT_PX)
    };
  }, [scrollTop, shouldVirtualize, viewportHeight, visibleRows]);

  return (
    <Box
      ref={viewportRef}
      role="tree"
      onScroll={shouldVirtualize ? handleVirtualizedScroll : undefined}
      sx={{
        minHeight: 0,
        maxHeight: shouldVirtualize ? RESOURCE_VIRTUALIZED_MAX_HEIGHT : undefined,
        overflowY: shouldVirtualize ? 'auto' : 'visible',
        overflowX: 'hidden'
      }}
    >
      {windowedRows.topSpacerHeight > 0 && (
        <Box sx={{ height: `${windowedRows.topSpacerHeight}px` }} />
      )}
      {windowedRows.rows.map(({ node, depth }) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = hasChildren && expandedSet.has(node.id);
        return (
          <ResourceSectionRow
            key={node.id}
            node={node}
            depth={depth}
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            isSelected={selectedNodeId === node.id}
            enableEntryTooltip={enableEntryTooltip}
            onToggleExpandedItem={handleToggleExpandedItem}
            onSelectNode={handleSelectNode}
            onInvokeAction={onInvokeAction}
            onOpenActionMenu={onOpenActionMenu}
            resolveNodePrimaryAction={resolveNodePrimaryAction}
            canBuildResourceActions={canBuildResourceActions}
            getNodeActionList={getNodeActionList}
            resolveNodeCountLabel={resolveNodeCountLabel}
            renderPrimaryLabel={renderPrimaryLabel}
            colorTextPrimary={colorTextPrimary}
            showResourceActionButtons={showResourceActionButtons}
          />
        );
      })}
      {windowedRows.bottomSpacerHeight > 0 && (
        <Box sx={{ height: `${windowedRows.bottomSpacerHeight}px` }} />
      )}
    </Box>
  );
});
