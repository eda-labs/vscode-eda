import { useState, useCallback, useMemo } from 'react';
import { usePostMessage, useMessageListener, useReadySignal } from '../shared/hooks';
import { mountWebview } from '../shared/utils';

interface ResourceRef {
  group?: string;
  version?: string;
  kind?: string;
  name: string;
  namespace: string;
  type: 'resource' | 'node';
}

interface DiffData {
  before?: { data?: string };
  after?: { data?: string };
}

interface DiffLine {
  line: string;
  type: 'context' | 'added' | 'removed' | 'blank';
  lineNum: number | string;
}

interface TransactionDiffsMessage {
  command: string;
  diffs?: ResourceRef[];
  nodes?: ResourceRef[];
  diff?: DiffData;
  resource?: ResourceRef;
  message?: string;
}

function computeLCS(arr1: string[], arr2: string[]): string[] {
  const m = arr1.length;
  const n = arr2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcs: string[] = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (arr1[i - 1] === arr2[j - 1]) {
      lcs.unshift(arr1[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

function generateDiff(beforeContent: string, afterContent: string): { beforeDiff: DiffLine[]; afterDiff: DiffLine[] } {
  const beforeLines = beforeContent ? beforeContent.split('\n') : [];
  const afterLines = afterContent ? afterContent.split('\n') : [];

  if (beforeLines.length === afterLines.length && beforeLines.every((line, idx) => line === afterLines[idx])) {
    return { beforeDiff: [], afterDiff: [] };
  }

  const lcs = computeLCS(beforeLines, afterLines);
  const beforeDiff: DiffLine[] = [];
  const afterDiff: DiffLine[] = [];

  let beforeIdx = 0;
  let afterIdx = 0;
  let lcsIdx = 0;

  while (beforeIdx < beforeLines.length || afterIdx < afterLines.length) {
    if (
      lcsIdx < lcs.length &&
      beforeIdx < beforeLines.length &&
      afterIdx < afterLines.length &&
      beforeLines[beforeIdx] === lcs[lcsIdx] &&
      afterLines[afterIdx] === lcs[lcsIdx]
    ) {
      beforeDiff.push({ line: beforeLines[beforeIdx], type: 'context', lineNum: beforeIdx + 1 });
      afterDiff.push({ line: afterLines[afterIdx], type: 'context', lineNum: afterIdx + 1 });
      beforeIdx++;
      afterIdx++;
      lcsIdx++;
    } else if (
      beforeIdx < beforeLines.length &&
      afterIdx < afterLines.length &&
      (lcsIdx >= lcs.length || beforeLines[beforeIdx] !== lcs[lcsIdx]) &&
      (lcsIdx >= lcs.length || afterLines[afterIdx] !== lcs[lcsIdx])
    ) {
      beforeDiff.push({ line: beforeLines[beforeIdx], type: 'removed', lineNum: beforeIdx + 1 });
      afterDiff.push({ line: afterLines[afterIdx], type: 'added', lineNum: afterIdx + 1 });
      beforeIdx++;
      afterIdx++;
    } else if (beforeIdx < beforeLines.length && (lcsIdx >= lcs.length || beforeLines[beforeIdx] !== lcs[lcsIdx])) {
      beforeDiff.push({ line: beforeLines[beforeIdx], type: 'removed', lineNum: beforeIdx + 1 });
      afterDiff.push({ line: '', type: 'blank', lineNum: '' });
      beforeIdx++;
    } else if (afterIdx < afterLines.length && (lcsIdx >= lcs.length || afterLines[afterIdx] !== lcs[lcsIdx])) {
      beforeDiff.push({ line: '', type: 'blank', lineNum: '' });
      afterDiff.push({ line: afterLines[afterIdx], type: 'added', lineNum: afterIdx + 1 });
      afterIdx++;
    } else {
      beforeIdx++;
      afterIdx++;
      lcsIdx++;
    }
  }

  return { beforeDiff, afterDiff };
}

function DiffLineComponent({ item }: { item: DiffLine }) {
  const bgColors = {
    context: '',
    added: 'bg-green-500/20',
    removed: 'bg-red-500/20',
    blank: 'bg-gray-500/10'
  };

  return (
    <div className={`flex font-mono text-xs ${bgColors[item.type]}`}>
      <span className="w-12 flex-shrink-0 text-right pr-2 text-(--vscode-descriptionForeground) border-r border-(--vscode-panel-border)">
        {item.lineNum}
      </span>
      <span className="pl-2 whitespace-pre overflow-x-auto">{item.line || ' '}</span>
    </div>
  );
}

function ResourceItem({ resource, isSelected, onClick }: { resource: ResourceRef; isSelected: boolean; onClick: () => void }) {
  const kind = resource.type === 'node' ? 'Node Config' : resource.kind;

  return (
    <button
      className={`w-full text-left px-3 py-2 border-b border-(--vscode-panel-border) hover:bg-(--vscode-list-hoverBackground) ${isSelected ? 'bg-(--vscode-list-activeSelectionBackground) text-(--vscode-list-activeSelectionForeground)' : ''}`}
      onClick={onClick}
    >
      <div className="font-medium">{resource.name}</div>
      <div className="text-xs text-(--vscode-descriptionForeground)">{kind} - {resource.namespace}</div>
    </button>
  );
}

function TransactionDiffsPanel() {
  const postMessage = usePostMessage();
  const [allDiffs, setAllDiffs] = useState<ResourceRef[]>([]);
  const [selectedResource, setSelectedResource] = useState<ResourceRef | null>(null);
  const [beforeDiff, setBeforeDiff] = useState<DiffLine[]>([]);
  const [afterDiff, setAfterDiff] = useState<DiffLine[]>([]);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('node');
  const [searchQuery, setSearchQuery] = useState('');
  const [noDiff, setNoDiff] = useState(false);

  useReadySignal();

  useMessageListener<TransactionDiffsMessage>(useCallback((msg) => {
    if (msg.command === 'diffs') {
      const diffs: ResourceRef[] = [];
      (msg.diffs ?? []).forEach(r => diffs.push({ ...r, type: 'resource' }));
      (msg.nodes ?? []).forEach(n => diffs.push({ ...n, type: 'node' }));
      setAllDiffs(diffs);
      if (diffs.length > 0) {
        setSelectedResource(diffs[0]);
        postMessage({ command: 'loadDiff', resource: diffs[0] });
      }
    } else if (msg.command === 'diff' && msg.diff) {
      const beforeContent = msg.diff.before?.data || '';
      const afterContent = msg.diff.after?.data || '';
      const { beforeDiff, afterDiff } = generateDiff(beforeContent, afterContent);
      setBeforeDiff(beforeDiff);
      setAfterDiff(afterDiff);
      setError('');
      setNoDiff(beforeDiff.length === 0 && afterDiff.length === 0);
    } else if (msg.command === 'error') {
      setError(msg.message ?? 'Unknown error');
    }
  }, [postMessage]));

  const filteredDiffs = useMemo(() => {
    let filtered = [...allDiffs];
    if (typeFilter !== 'all') {
      filtered = filtered.filter(r => r.type === typeFilter);
    }
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      filtered = filtered.filter(r => {
        const kind = r.type === 'node' ? 'Node Config' : r.kind;
        return r.name.toLowerCase().includes(lower) || (kind || '').toLowerCase().includes(lower);
      });
    }
    return filtered;
  }, [allDiffs, typeFilter, searchQuery]);

  const handleSelectResource = useCallback((resource: ResourceRef) => {
    setSelectedResource(resource);
    setError('');
    setNoDiff(false);
    postMessage({ command: 'loadDiff', resource });
  }, [postMessage]);

  const stats = useMemo(() => {
    const added = afterDiff.filter(item => item.type === 'added').length;
    const removed = beforeDiff.filter(item => item.type === 'removed').length;
    const total = Math.max(beforeDiff.length, afterDiff.length);
    return { added, removed, total };
  }, [beforeDiff, afterDiff]);

  const titleKind = selectedResource?.type === 'node' ? 'Node Config' : selectedResource?.kind;

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-72 flex-shrink-0 border-r border-(--vscode-panel-border) flex flex-col bg-(--vscode-sideBar-background)">
        <div className="p-3 border-b border-(--vscode-panel-border)">
          <h3 className="font-semibold mb-2">Diffs</h3>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full px-2 py-1 mb-2 bg-(--vscode-input-background) text-(--vscode-input-foreground) border border-(--vscode-input-border) rounded text-sm"
          >
            <option value="all">All</option>
            <option value="resource">Resource</option>
            <option value="node">Node Config</option>
          </select>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full px-2 py-1 bg-(--vscode-input-background) text-(--vscode-input-foreground) border border-(--vscode-input-border) rounded text-sm"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredDiffs.map((resource, idx) => (
            <ResourceItem
              key={`${resource.type}-${resource.name}-${resource.namespace}-${idx}`}
              resource={resource}
              isSelected={selectedResource === resource}
              onClick={() => handleSelectResource(resource)}
            />
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="p-3 border-b border-(--vscode-panel-border) flex items-center justify-between">
          <h2 className="font-semibold">
            {selectedResource ? `${titleKind}/${selectedResource.name}` : 'Select a resource to view diff'}
          </h2>
          {stats.total > 0 && (
            <div className="flex gap-3 text-sm">
              <span className="text-green-500">+{stats.added}</span>
              <span className="text-red-500">-{stats.removed}</span>
              <span className="text-(--vscode-descriptionForeground)">Total: {stats.total} lines</span>
            </div>
          )}
        </div>

        {error ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <span className="text-4xl mb-2 block">❌</span>
              <p>Error loading diff:</p>
              <p className="text-red-500 text-sm mt-2">{error}</p>
            </div>
          </div>
        ) : noDiff ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-(--vscode-descriptionForeground)">
              <span className="text-4xl mb-2 block">📄</span>
              <p>No differences found</p>
            </div>
          </div>
        ) : !selectedResource ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-(--vscode-descriptionForeground)">
              <span className="text-4xl mb-2 block">📄</span>
              <p>Select a resource from the list to view its diff</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
            {/* Before pane */}
            <div className="flex-1 flex flex-col min-w-0 border-r border-(--vscode-panel-border)">
              <div className="px-3 py-2 border-b border-(--vscode-panel-border) flex items-center justify-between bg-(--vscode-editorGroupHeader-tabsBackground)">
                <span className="font-medium">Before</span>
                <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded">Deleted</span>
              </div>
              <div className="flex-1 overflow-auto">
                {beforeDiff.map((item, idx) => (
                  <DiffLineComponent key={idx} item={item} />
                ))}
              </div>
            </div>

            {/* After pane */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-3 py-2 border-b border-(--vscode-panel-border) flex items-center justify-between bg-(--vscode-editorGroupHeader-tabsBackground)">
                <span className="font-medium">After</span>
                <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">Added</span>
              </div>
              <div className="flex-1 overflow-auto">
                {afterDiff.map((item, idx) => (
                  <DiffLineComponent key={idx} item={item} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

mountWebview(TransactionDiffsPanel);
