import { useState, useCallback, useMemo } from 'react';
import DescriptionIcon from '@mui/icons-material/Description';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { Alert, Box, Chip, FormControl, InputLabel, List, ListItemButton, ListItemText, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { usePostMessage, useMessageListener, useReadySignal } from '../shared/hooks';
import { mountWebview } from '../shared/utils';

const NODE_CONFIG_LABEL = 'Node Config';

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

const COLOR_TEXT_SECONDARY = 'text.secondary' as const;
const COLOR_DIVIDER = 'divider' as const;
const JUSTIFY_BETWEEN = 'space-between' as const;

function computeLCS(arr1: string[], arr2: string[]): string[] {
  const m = arr1.length;
  const n = arr2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array<number>(n + 1).fill(0));

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
  let i = m;
  let j = n;
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

function areArraysEqual(arr1: string[], arr2: string[]): boolean {
  return arr1.length === arr2.length && arr1.every((line, idx) => line === arr2[idx]);
}

function isLcsMatch(line: string, lcs: string[], lcsIdx: number): boolean {
  return lcsIdx < lcs.length && line === lcs[lcsIdx];
}

function isNotLcsMatch(line: string, lcs: string[], lcsIdx: number): boolean {
  return lcsIdx >= lcs.length || line !== lcs[lcsIdx];
}

function createContextLine(line: string, lineNum: number): DiffLine {
  return { line, type: 'context', lineNum: lineNum + 1 };
}

function createRemovedLine(line: string, lineNum: number): DiffLine {
  return { line, type: 'removed', lineNum: lineNum + 1 };
}

function createAddedLine(line: string, lineNum: number): DiffLine {
  return { line, type: 'added', lineNum: lineNum + 1 };
}

function createBlankLine(): DiffLine {
  return { line: '', type: 'blank', lineNum: '' };
}

interface DiffState {
  beforeLines: string[];
  afterLines: string[];
  lcs: string[];
  beforeDiff: DiffLine[];
  afterDiff: DiffLine[];
  beforeIdx: number;
  afterIdx: number;
  lcsIdx: number;
}

function handleContextMatch(state: DiffState): void {
  state.beforeDiff.push(createContextLine(state.beforeLines[state.beforeIdx], state.beforeIdx));
  state.afterDiff.push(createContextLine(state.afterLines[state.afterIdx], state.afterIdx));
  state.beforeIdx++;
  state.afterIdx++;
  state.lcsIdx++;
}

function handleBothModified(state: DiffState): void {
  state.beforeDiff.push(createRemovedLine(state.beforeLines[state.beforeIdx], state.beforeIdx));
  state.afterDiff.push(createAddedLine(state.afterLines[state.afterIdx], state.afterIdx));
  state.beforeIdx++;
  state.afterIdx++;
}

function handleBeforeRemoved(state: DiffState): void {
  state.beforeDiff.push(createRemovedLine(state.beforeLines[state.beforeIdx], state.beforeIdx));
  state.afterDiff.push(createBlankLine());
  state.beforeIdx++;
}

function handleAfterAdded(state: DiffState): void {
  state.beforeDiff.push(createBlankLine());
  state.afterDiff.push(createAddedLine(state.afterLines[state.afterIdx], state.afterIdx));
  state.afterIdx++;
}

function handleFallthrough(state: DiffState): void {
  state.beforeIdx++;
  state.afterIdx++;
  state.lcsIdx++;
}

function processDiffIteration(state: DiffState): void {
  const beforeInBounds = state.beforeIdx < state.beforeLines.length;
  const afterInBounds = state.afterIdx < state.afterLines.length;
  const beforeMatchesLcs = beforeInBounds && isLcsMatch(state.beforeLines[state.beforeIdx], state.lcs, state.lcsIdx);
  const afterMatchesLcs = afterInBounds && isLcsMatch(state.afterLines[state.afterIdx], state.lcs, state.lcsIdx);
  const beforeNotLcs = beforeInBounds && isNotLcsMatch(state.beforeLines[state.beforeIdx], state.lcs, state.lcsIdx);
  const afterNotLcs = afterInBounds && isNotLcsMatch(state.afterLines[state.afterIdx], state.lcs, state.lcsIdx);

  if (beforeMatchesLcs && afterMatchesLcs) {
    handleContextMatch(state);
  } else if (beforeNotLcs && afterNotLcs) {
    handleBothModified(state);
  } else if (beforeNotLcs) {
    handleBeforeRemoved(state);
  } else if (afterNotLcs) {
    handleAfterAdded(state);
  } else {
    handleFallthrough(state);
  }
}

function generateDiff(beforeContent: string, afterContent: string): { beforeDiff: DiffLine[]; afterDiff: DiffLine[] } {
  const beforeLines = beforeContent ? beforeContent.split('\n') : [];
  const afterLines = afterContent ? afterContent.split('\n') : [];

  if (areArraysEqual(beforeLines, afterLines)) {
    return { beforeDiff: [], afterDiff: [] };
  }

  const state: DiffState = {
    beforeLines,
    afterLines,
    lcs: computeLCS(beforeLines, afterLines),
    beforeDiff: [],
    afterDiff: [],
    beforeIdx: 0,
    afterIdx: 0,
    lcsIdx: 0,
  };

  while (state.beforeIdx < beforeLines.length || state.afterIdx < afterLines.length) {
    processDiffIteration(state);
  }

  return { beforeDiff: state.beforeDiff, afterDiff: state.afterDiff };
}

function DiffLineComponent({ item }: Readonly<{ item: DiffLine }>) {
  const theme = useTheme();
  const bgColors = {
    context: 'transparent',
    added: theme.vscode.diff.addedBackground,
    removed: theme.vscode.diff.removedBackground,
    blank: theme.vscode.diff.blankBackground
  };

  return (
    <Box sx={{ display: 'flex', fontFamily: theme.vscode.fonts.editorFamily, fontSize: theme.vscode.fonts.editorSize, bgcolor: bgColors[item.type] }}>
      <Box
        sx={{
          width: 56,
          flexShrink: 0,
          textAlign: 'right',
          pr: 1,
          color: COLOR_TEXT_SECONDARY,
          borderRight: 1,
          borderColor: COLOR_DIVIDER
        }}
      >
        {item.lineNum}
      </Box>
      <Box sx={{ pl: 1, whiteSpace: 'pre', overflowX: 'auto', flex: 1 }}>
        {item.line || ' '}
      </Box>
    </Box>
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
        const kind = r.type === 'node' ? NODE_CONFIG_LABEL : r.kind;
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

  const titleKind = selectedResource?.type === 'node' ? NODE_CONFIG_LABEL : selectedResource?.kind;

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <Paper
        variant="outlined"
        sx={{
          width: 300,
          flexShrink: 0,
          borderRadius: 0,
          borderRight: 1,
          borderColor: COLOR_DIVIDER,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: COLOR_DIVIDER }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>Diffs</Typography>
          <FormControl size="small" fullWidth sx={{ mb: 1 }}>
            <InputLabel id="type-filter-label">Type</InputLabel>
            <Select
              labelId="type-filter-label"
              value={typeFilter}
              label="Type"
              onChange={(e) => setTypeFilter(String(e.target.value))}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="resource">Resource</MenuItem>
              <MenuItem value="node">{NODE_CONFIG_LABEL}</MenuItem>
            </Select>
          </FormControl>
          <TextField
            size="small"
            fullWidth
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
          />
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          <List disablePadding>
            {filteredDiffs.map((resource, idx) => {
              const kind = resource.type === 'node' ? NODE_CONFIG_LABEL : resource.kind;
              return (
                <ListItemButton
                  key={`${resource.type}-${resource.name}-${resource.namespace}-${idx}`}
                  selected={selectedResource === resource}
                  onClick={() => handleSelectResource(resource)}
                  divider
                >
                  <ListItemText
                    primary={<Typography sx={{ fontSize: 14, fontWeight: 600 }}>{resource.name}</Typography>}
                    secondary={<Typography sx={{ fontSize: 12 }}>{kind} - {resource.namespace}</Typography>}
                  />
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      </Paper>

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: COLOR_DIVIDER, display: 'flex', justifyContent: JUSTIFY_BETWEEN, alignItems: 'center' }}>
          <Typography variant="subtitle1">
            {selectedResource ? `${titleKind}/${selectedResource.name}` : 'Select a resource to view diff'}
          </Typography>
          {stats.total > 0 && (
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Chip size="small" color="success" label={`+${stats.added}`} />
              <Chip size="small" color="error" label={`-${stats.removed}`} />
              <Typography variant="caption" color={COLOR_TEXT_SECONDARY}>Total: {stats.total} lines</Typography>
            </Stack>
          )}
        </Box>

        {error && (
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <Alert severity="error" icon={<ErrorOutlineIcon />} sx={{ maxWidth: 500 }}>
              Error loading diff: {error}
            </Alert>
          </Box>
        )}

        {!error && noDiff && (
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', color: COLOR_TEXT_SECONDARY }}>
            <Stack spacing={1} alignItems="center">
              <DescriptionIcon fontSize="large" />
              <Typography>No differences found</Typography>
            </Stack>
          </Box>
        )}

        {!error && !noDiff && !selectedResource && (
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', color: COLOR_TEXT_SECONDARY }}>
            <Stack spacing={1} alignItems="center">
              <DescriptionIcon fontSize="large" />
              <Typography>Select a resource from the list to view its diff</Typography>
            </Stack>
          </Box>
        )}

        {!error && !noDiff && selectedResource && (
          <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <Box sx={{ flex: 1, minWidth: 0, borderRight: 1, borderColor: COLOR_DIVIDER, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: COLOR_DIVIDER, display: 'flex', justifyContent: JUSTIFY_BETWEEN, alignItems: 'center' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Before</Typography>
                <Chip size="small" color="error" variant="outlined" label="Deleted" />
              </Box>
              <Box sx={{ flex: 1, overflow: 'auto' }}>
                {beforeDiff.map((item, idx) => (
                  <DiffLineComponent key={idx} item={item} />
                ))}
              </Box>
            </Box>

            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: COLOR_DIVIDER, display: 'flex', justifyContent: JUSTIFY_BETWEEN, alignItems: 'center' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>After</Typography>
                <Chip size="small" color="success" variant="outlined" label="Added" />
              </Box>
              <Box sx={{ flex: 1, overflow: 'auto' }}>
                {afterDiff.map((item, idx) => (
                  <DiffLineComponent key={idx} item={item} />
                ))}
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

mountWebview(TransactionDiffsPanel);
