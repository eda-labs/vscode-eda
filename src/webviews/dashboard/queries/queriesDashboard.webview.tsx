import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SearchIcon from '@mui/icons-material/Search';
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import type { GridColDef, GridSortModel } from '@mui/x-data-grid';

import { usePostMessage, useMessageListener, useReadySignal, useCopyToClipboard } from '../../shared/hooks';
import { shallowArrayEquals, mountWebview } from '../../shared/utils';
import { VsCodeDataGrid } from '../../shared/components';

import type { CopyFormat } from './queryFormatters';
import { formatValue, pruneEmptyColumns, formatForClipboard } from './queryFormatters';

interface Alternative {
  query: string;
  description?: string;
  score: number;
}

interface QueriesMessage {
  command: string;
  namespaces?: string[];
  selected?: string;
  columns?: string[];
  rows?: unknown[][];
  status?: string;
  error?: string;
  list?: string[];
  eqlQuery?: string;
  queryType?: string;
  description?: string;
  alternatives?: Alternative[];
}

type QueryType = 'eql' | 'nql' | 'emb';

// Grouped state for conversion display
interface ConversionState {
  show: boolean;
  eql: string;
  label: string;
  description: string;
  alternatives: Alternative[];
  showAlternatives: boolean;
}

const initialConversionState: ConversionState = {
  show: false,
  eql: '',
  label: 'Query converted to EQL:',
  description: '',
  alternatives: [],
  showAlternatives: false
};

// Message handler helpers
function handleInitMessage(
  msg: QueriesMessage,
  setNamespaces: React.Dispatch<React.SetStateAction<string[]>>,
  setSelectedNamespace: React.Dispatch<React.SetStateAction<string>>
): void {
  setNamespaces(msg.namespaces || []);
  setSelectedNamespace(msg.selected || (msg.namespaces?.[0] || ''));
}

function handleClearMessage(
  setColumns: React.Dispatch<React.SetStateAction<string[]>>,
  setAllRows: React.Dispatch<React.SetStateAction<unknown[][]>>,
  setSortModel: React.Dispatch<React.SetStateAction<GridSortModel>>,
  setStatus: React.Dispatch<React.SetStateAction<string>>
): void {
  setColumns([]);
  setAllRows([]);
  setSortModel([]);
  setStatus('Running...');
}

function handleResultsMessage(
  msg: QueriesMessage,
  setColumns: React.Dispatch<React.SetStateAction<string[]>>,
  setAllRows: React.Dispatch<React.SetStateAction<unknown[][]>>,
  setSortModel: React.Dispatch<React.SetStateAction<GridSortModel>>,
  setStatus: React.Dispatch<React.SetStateAction<string>>
): void {
  const filtered = pruneEmptyColumns(msg.columns || [], msg.rows || []);
  setColumns(prev => {
    const colsChanged = !shallowArrayEquals(prev, filtered.cols);
    if (colsChanged) {
      setSortModel([]);
    }
    return filtered.cols;
  });
  setAllRows(filtered.rows);
  if (msg.status) {
    setStatus(msg.status);
  }
}

function handleErrorMessage(
  msg: QueriesMessage,
  setStatus: React.Dispatch<React.SetStateAction<string>>,
  setColumns: React.Dispatch<React.SetStateAction<string[]>>,
  setAllRows: React.Dispatch<React.SetStateAction<unknown[][]>>
): void {
  setStatus(msg.error || 'Error');
  setColumns([]);
  setAllRows([]);
}

function handleConvertedQueryMessage(
  msg: QueriesMessage,
  setConversion: React.Dispatch<React.SetStateAction<ConversionState>>
): void {
  setConversion({
    show: true,
    eql: msg.eqlQuery || '',
    label: msg.queryType === 'nql' ? 'NQL converted to EQL:' : 'Natural language converted to EQL:',
    description: msg.description || '',
    alternatives: msg.alternatives || [],
    showAlternatives: false
  });
}

// Keyboard handler helpers
function computeNextAutocompleteIndex(index: number, listLength: number, isDown: boolean): number {
  if (isDown) {
    if (index < listLength - 1) return index + 1;
    if (index === -1) return 0;
    return index;
  }
  if (index === -1) return listLength - 1;
  if (index > 0) return index - 1;
  return index;
}

function handleArrowNavigation(
  key: string,
  setAutocomplete: React.Dispatch<React.SetStateAction<AutocompleteState>>
): void {
  const isDown = key === 'ArrowDown';
  setAutocomplete(prev => {
    const newIndex = computeNextAutocompleteIndex(prev.index, prev.list.length, isDown);
    return { ...prev, index: newIndex };
  });
}

function handleTabKey(
  autocomplete: AutocompleteState,
  insertAutocomplete: (text: string) => void
): void {
  const target = autocomplete.index >= 0 ? autocomplete.list[autocomplete.index] : autocomplete.list[0];
  if (target) {
    insertAutocomplete(target);
  }
}

function handleEnterKey(
  e: React.KeyboardEvent<HTMLInputElement>,
  autocomplete: AutocompleteState,
  queryType: QueryType,
  insertAutocomplete: (text: string) => void,
  handleRunQuery: () => void
): void {
  const shouldInsertAutocomplete = autocomplete.index >= 0 && !e.metaKey && !e.ctrlKey && queryType === 'eql';
  if (shouldInsertAutocomplete) {
    const item = autocomplete.list[autocomplete.index];
    if (item) {
      insertAutocomplete(item);
    }
  } else {
    handleRunQuery();
  }
}

// Grouped state for autocomplete
interface AutocompleteState {
  list: string[];
  index: number;
}

interface QueryGridRow {
  id: string;
  raw: unknown[];
  [key: string]: unknown;
}

function getSortIndex(sortModel: GridSortModel): { index: number; ascending: boolean } | null {
  const firstSort = sortModel[0];
  if (!firstSort?.field.startsWith('col_')) {
    return null;
  }

  const index = Number.parseInt(firstSort.field.replace('col_', ''), 10);
  if (Number.isNaN(index)) {
    return null;
  }

  return {
    index,
    ascending: firstSort.sort !== 'desc'
  };
}

function QueriesDashboard() {
  const postMessage = usePostMessage();
  useReadySignal();
  const { copied, copyToClipboard } = useCopyToClipboard({ successDuration: 1000 });
  const controlHeight = 32;

  // Namespace state
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');

  // Query state
  const [queryInput, setQueryInput] = useState('');
  const [queryType, setQueryType] = useState<QueryType>('eql');

  // Results state
  const [columns, setColumns] = useState<string[]>([]);
  const [allRows, setAllRows] = useState<unknown[][]>([]);
  const [sortModel, setSortModel] = useState<GridSortModel>([]);
  const [status, setStatus] = useState('Ready');

  // UI state
  const [autocomplete, setAutocomplete] = useState<AutocompleteState>({ list: [], index: -1 });
  const [copyFormat, setCopyFormat] = useState<CopyFormat>('ascii');
  const [conversion, setConversion] = useState<ConversionState>(initialConversionState);

  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<HTMLDivElement | null>(null);
  const [copyMenuAnchor, setCopyMenuAnchor] = useState<HTMLElement | null>(null);

  useMessageListener<QueriesMessage>(useCallback((msg) => {
    switch (msg.command) {
      case 'init':
        handleInitMessage(msg, setNamespaces, setSelectedNamespace);
        break;
      case 'clear':
        handleClearMessage(setColumns, setAllRows, setSortModel, setStatus);
        break;
      case 'results':
        handleResultsMessage(msg, setColumns, setAllRows, setSortModel, setStatus);
        break;
      case 'error':
        handleErrorMessage(msg, setStatus, setColumns, setAllRows);
        break;
      case 'autocomplete':
        setAutocomplete({ list: msg.list || [], index: -1 });
        break;
      case 'convertedQuery':
        handleConvertedQueryMessage(msg, setConversion);
        break;
    }
  }, []));

  const queryTypeNote = useMemo(() => {
    switch (queryType) {
      case 'nql':
        return 'Natural Query Language (NQL) converts your natural language questions into EQL queries using an LLM.';
      case 'emb':
        return 'Embeddings-based natural language support is an experimental way to use natural language with EQL without having to use an LLM.';
      default:
        return null;
    }
  }, [queryType]);

  const queryPlaceholder = useMemo(() => {
    switch (queryType) {
      case 'eql':
        return 'Enter EQL expression (e.g., .namespace.node.name)';
      case 'nql':
        return 'Enter natural language query (e.g., Which ports are down?)';
      case 'emb':
        return 'Enter natural language query for embedding search';
    }
  }, [queryType]);

  const sortedRows = useMemo(() => {
    const activeSort = getSortIndex(sortModel);
    if (!activeSort) return allRows;

    const { index, ascending } = activeSort;

    return [...allRows].sort((a, b) => {
      const av = formatValue(a[index]);
      const bv = formatValue(b[index]);
      if (av < bv) return ascending ? -1 : 1;
      if (av > bv) return ascending ? 1 : -1;
      return 0;
    });
  }, [allRows, sortModel]);

  useEffect(() => {
    setStatus(`Count: ${sortedRows.length}`);
  }, [sortedRows.length]);

  const handleRunQuery = useCallback(() => {
    setStatus('Running...');
    postMessage({
      command: 'runQuery',
      query: queryInput,
      queryType,
      namespace: selectedNamespace
    });
    setAutocomplete({ list: [], index: -1 });
  }, [postMessage, queryInput, queryType, selectedNamespace]);

  const handleQueryInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQueryInput(value);
    if (queryType === 'eql') {
      postMessage({ command: 'autocomplete', query: value });
    } else {
      setAutocomplete({ list: [], index: -1 });
    }
  }, [postMessage, queryType]);

  const insertAutocomplete = useCallback((text: string) => {
    const input = inputRef.current;
    if (!input) return;

    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const isWord = /^[a-zA-Z0-9._()-]+$/.test(text);
    let tokenStart = start;
    if (isWord) {
      // Find the last token boundary (word characters, dots, parens, hyphens)
      let matchLen = 0;
      for (let i = before.length - 1; i >= 0; i--) {
        const c = before[i];
        if (/[\w.()-]/.test(c)) {
          matchLen++;
        } else {
          break;
        }
      }
      if (matchLen > 0) tokenStart = start - matchLen;
    }
    const newValue = before.slice(0, tokenStart) + text + after;
    const newPos = tokenStart + text.length;
    setQueryInput(newValue);
    setTimeout(() => {
      input.setSelectionRange(newPos, newPos);
      postMessage({ command: 'autocomplete', query: newValue });
    }, 0);
  }, [postMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const { key } = e;
    const hasAutocomplete = autocomplete.list.length > 0;

    if (key === 'Escape') {
      setAutocomplete({ list: [], index: -1 });
      setCopyMenuAnchor(null);
      return;
    }

    if (key === 'Tab' && hasAutocomplete && queryType === 'eql') {
      e.preventDefault();
      handleTabKey(autocomplete, insertAutocomplete);
      return;
    }

    if ((key === 'ArrowDown' || key === 'ArrowUp') && hasAutocomplete) {
      e.preventDefault();
      handleArrowNavigation(key, setAutocomplete);
      return;
    }

    if (key === 'Enter') {
      e.preventDefault();
      handleEnterKey(e, autocomplete, queryType, insertAutocomplete, handleRunQuery);
    }
  }, [autocomplete, queryType, insertAutocomplete, handleRunQuery]);

  const handleCopy = useCallback((format?: CopyFormat) => {
    const text = formatForClipboard(format ?? copyFormat, columns, sortedRows);
    copyToClipboard(text).then((success) => {
      if (success) {
        setStatus('Copied to clipboard');
        setTimeout(() => setStatus(`Count: ${sortedRows.length}`), 1000);
      }
    }).catch(() => {});
  }, [copyFormat, columns, sortedRows, copyToClipboard]);

  const handleAlternativeClick = useCallback((alt: Alternative) => {
    setQueryInput(alt.query);
    setConversion(prev => ({ ...prev, eql: alt.query, showAlternatives: false }));
    setTimeout(() => handleRunQuery(), 0);
  }, [handleRunQuery]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (autocompleteRef.current && !autocompleteRef.current.contains(target)) {
        setAutocomplete(prev => ({ ...prev, list: [] }));
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const gridRows = useMemo<QueryGridRow[]>(() => {
    return sortedRows.map((row, rowIndex) => {
      const gridRow: QueryGridRow = {
        id: String(rowIndex),
        raw: row
      };
      columns.forEach((_, colIndex) => {
        gridRow[`col_${colIndex}`] = formatValue(row[colIndex]);
      });
      return gridRow;
    });
  }, [sortedRows, columns]);

  const gridColumns = useMemo<GridColDef<QueryGridRow>[]>(() => {
    return columns.map((column, index) => ({
      field: `col_${index}`,
      headerName: column,
      minWidth: 180,
      width: 220,
      renderCell: (params) => (
        <Box sx={{ py: 0.25, whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 140 }}>
          {String(params.row[`col_${index}`] ?? '')}
        </Box>
      )
    }));
  }, [columns]);

  return (
    <Box sx={{ p: 3, maxWidth: 1600, mx: 'auto' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }} alignItems={{ md: 'center' }}>
        <Stack direction="row" spacing={1} sx={{ flex: 1 }} alignItems="center">
          <Typography variant="body2" sx={{ minWidth: 48 }}>Query</Typography>
          <FormControl size="small" sx={{ minWidth: 100 }}>
            <InputLabel id="query-type-label">Type</InputLabel>
            <Select
              labelId="query-type-label"
              size="small"
              sx={{ height: controlHeight, '& .MuiSelect-select': { height: controlHeight, display: 'flex', alignItems: 'center' } }}
              value={queryType}
              label="Type"
              onChange={(e) => setQueryType(e.target.value as QueryType)}
            >
              <MenuItem value="eql">EQL</MenuItem>
              <MenuItem value="nql">NQL</MenuItem>
              <MenuItem value="emb">EMB</MenuItem>
            </Select>
          </FormControl>

          <Box sx={{ flex: 1, position: 'relative' }} ref={autocompleteRef}>
            <TextField
              inputRef={inputRef}
              fullWidth
              size="small"
              sx={{ '& .MuiOutlinedInput-root': { minHeight: controlHeight, height: controlHeight } }}
              placeholder={queryPlaceholder}
              value={queryInput}
              onChange={handleQueryInputChange}
              onKeyDown={handleKeyDown}
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
            {autocomplete.list.length > 0 && (
              <Paper
                variant="outlined"
                sx={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: '100%',
                  zIndex: 10,
                  maxHeight: 280,
                  overflowY: 'auto'
                }}
              >
                <List dense disablePadding>
                  {autocomplete.list.map((item, idx) => (
                    <ListItemButton
                      key={idx}
                      selected={idx === autocomplete.index}
                      onMouseOver={() => setAutocomplete(prev => ({ ...prev, index: idx }))}
                      onClick={() => insertAutocomplete(item)}
                    >
                      <ListItemText primary={<Typography sx={{ fontSize: 13 }}>{item}</Typography>} />
                    </ListItemButton>
                  ))}
                </List>
              </Paper>
            )}
          </Box>

          <Button
            variant="contained"
            size="small"
            sx={{ minHeight: controlHeight, height: controlHeight }}
            startIcon={<PlayArrowIcon />}
            onClick={handleRunQuery}
          >
            Run
          </Button>

          <ButtonGroup
            variant="contained"
            color={copied ? 'success' : 'primary'}
            size="small"
            sx={{
              '& .MuiButton-root': {
                minHeight: controlHeight,
                height: controlHeight
              }
            }}
          >
            <Button
              startIcon={<ContentCopyIcon />}
              onClick={() => handleCopy()}
            >
              Copy
            </Button>
            <Tooltip title="Choose copy format">
              <Button
                size="small"
                onClick={(event) => setCopyMenuAnchor(event.currentTarget)}
                aria-haspopup="menu"
                aria-label="Choose copy format"
              >
                <ArrowDropDownIcon />
              </Button>
            </Tooltip>
          </ButtonGroup>
          <Menu
            anchorEl={copyMenuAnchor}
            open={Boolean(copyMenuAnchor)}
            onClose={() => setCopyMenuAnchor(null)}
          >
            {(['ascii', 'markdown', 'json', 'yaml'] as CopyFormat[]).map(fmt => (
              <MenuItem
                key={fmt}
                selected={copyFormat === fmt}
                onClick={() => {
                  setCopyFormat(fmt);
                  setCopyMenuAnchor(null);
                  handleCopy(fmt);
                }}
              >
                {fmt.toUpperCase()}
              </MenuItem>
            ))}
          </Menu>
        </Stack>

        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="query-namespace-label">Namespace</InputLabel>
          <Select
            labelId="query-namespace-label"
            size="small"
            sx={{ height: controlHeight, '& .MuiSelect-select': { height: controlHeight, display: 'flex', alignItems: 'center' } }}
            value={selectedNamespace}
            label="Namespace"
            onChange={(e) => setSelectedNamespace(String(e.target.value))}
          >
            {namespaces.map(ns => (
              <MenuItem key={ns} value={ns}>{ns}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {queryTypeNote && (
        <Alert severity="info" icon={<InfoOutlinedIcon />} sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontStyle: 'italic' }}>{queryTypeNote}</Typography>
        </Alert>
      )}

      {conversion.show && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Stack direction="row" spacing={0.5}>
              {conversion.alternatives.length > 0 && (
                <IconButton
                  size="small"
                  onClick={() => setConversion(prev => ({ ...prev, showAlternatives: !prev.showAlternatives }))}
                  sx={{ transform: conversion.showAlternatives ? 'rotate(180deg)' : 'none' }}
                >
                  <ExpandMoreIcon fontSize="small" />
                </IconButton>
              )}
              <IconButton size="small" onClick={() => setConversion(initialConversionState)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          }
        >
          <Typography variant="body2">
            {conversion.label} <code>{conversion.eql}</code>
          </Typography>
          {conversion.description && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontStyle: 'italic' }}>
              {conversion.description}
            </Typography>
          )}
          {conversion.showAlternatives && conversion.alternatives.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Alternative queries</Typography>
              <List dense sx={{ maxHeight: 220, overflowY: 'auto' }}>
                {conversion.alternatives.map((alt, idx) => (
                  <ListItemButton key={idx} onClick={() => handleAlternativeClick(alt)}>
                    <ListItemText
                      primary={<code>{alt.query}</code>}
                      secondary={
                        <>
                          {alt.description ? `${alt.description} ` : ''}
                          Score: {alt.score.toFixed(1)}
                        </>
                      }
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          )}
        </Alert>
      )}

      <VsCodeDataGrid<QueryGridRow>
        rows={gridRows}
        columns={gridColumns}
        noRowsMessage="No rows"
        footer={(
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {status}
          </Typography>
        )}
        dataGridProps={{
          sortModel,
          onSortModelChange: setSortModel,
          getRowHeight: () => 40
        }}
      />
    </Box>
  );
}

mountWebview(QueriesDashboard);
