/** Minimal interface for tree items with stream group info */
interface TreeItemWithStreamGroup {
  streamGroup?: string;
}

export const k8sEdaGroups = ['core.eda.nokia.com', 'artifacts.eda.nokia.com'];

export function isEdaGroup(apiVersion?: string): boolean {
  if (!apiVersion) return false;
  const group = apiVersion.split('/')[0];
  if (k8sEdaGroups.includes(group)) {
    return false;
  }
  return group.endsWith('.eda.nokia.com');
}

/**
 * Determine if the resource should be treated as EDA based on the originating
 * tree item when available, falling back to apiVersion heuristic.
 */
export function isEdaResource(treeItem: TreeItemWithStreamGroup | undefined, apiVersion?: string): boolean {
  if (treeItem?.streamGroup) {
    return treeItem.streamGroup !== 'kubernetes';
  }
  return isEdaGroup(apiVersion);
}
