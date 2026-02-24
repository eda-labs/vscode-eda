import { ChevronRight as ChevronRightIcon, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { Box, Typography } from '@mui/material';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';
import { useMemo, type ReactNode } from 'react';

import type { ExplorerNode, ExplorerSectionSnapshot } from '../shared/explorer/types';

function flattenNodeIds(nodes: ExplorerNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    ids.push(...flattenNodeIds(node.children));
  }
  return ids;
}

function renderNodes(nodes: ExplorerNode[], expandedItemIds: ReadonlySet<string>): ReactNode[] {
  return nodes.map((node) => {
    const shouldRenderChildren = node.children.length > 0 && expandedItemIds.has(node.id);
    return (
      <TreeItem
        key={node.id}
        itemId={node.id}
        label={(
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>{node.label}</Typography>
            {node.description && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {node.description}
              </Typography>
            )}
          </Box>
        )}
      >
        {shouldRenderChildren ? renderNodes(node.children, expandedItemIds) : null}
      </TreeItem>
    );
  });
}

export interface ExplorerRenderBenchmarkProps {
  sections: ExplorerSectionSnapshot[];
  expandAll?: boolean;
}

export function ExplorerRenderBenchmarkView({
  sections,
  expandAll = true
}: Readonly<ExplorerRenderBenchmarkProps>) {
  const expandedBySection = useMemo(() => {
    const entries = sections.map((section) => {
      const ids = expandAll ? flattenNodeIds(section.nodes) : [];
      return [section.id, { ids, idSet: new Set(ids) }] as const;
    });
    return new Map(entries);
  }, [sections, expandAll]);

  return (
    <Box sx={{ p: 1 }}>
      {sections.map(section => (
        <Box key={section.id} sx={{ mb: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {section.label}
          </Typography>
          {section.nodes.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              No items found.
            </Typography>
          ) : (
            <SimpleTreeView
              expandedItems={expandedBySection.get(section.id)?.ids || []}
              slots={{
                expandIcon: ChevronRightIcon,
                collapseIcon: ExpandMoreIcon
              }}
            >
              {renderNodes(section.nodes, expandedBySection.get(section.id)?.idSet || new Set<string>())}
            </SimpleTreeView>
          )}
        </Box>
      ))}
    </Box>
  );
}
