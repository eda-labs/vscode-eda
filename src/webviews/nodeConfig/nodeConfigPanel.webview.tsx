import React, { useState, useCallback, useMemo, useRef } from 'react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Typography
} from '@mui/material';

import { usePostMessage, useMessageListener, useReadySignal } from '../shared/hooks';
import { mountWebview } from '../shared/utils';

type ColorMode = 'full' | 'less' | 'none';

interface LineRange {
  startLine?: number;
  endLine?: number;
}

interface Annotation {
  cr: {
    name: string;
    gvk: {
      group: string;
      version: string;
      kind: string;
    };
  };
  lines: LineRange[];
}

interface AnnotationInfo {
  name: string;
  group: string;
  version: string;
  kind: string;
}

interface NodeConfigMessage {
  command: string;
  config?: string;
  annotations?: Annotation[];
  colorMode?: ColorMode;
}

interface ContextState {
  section: string;
  interface: string;
  subBlock: string;
  level: number;
}

// VSCode CSS color variables
const CSS_COLORS = {
  purple: 'var(--vscode-charts-purple)',
  blue: 'var(--vscode-charts-blue)',
  green: 'var(--vscode-charts-green)',
  yellow: 'var(--vscode-charts-yellow)',
  red: 'var(--vscode-charts-red)',
  orange: 'var(--vscode-charts-orange)',
  foreground: 'var(--vscode-editor-foreground)',
  description: 'var(--vscode-descriptionForeground)',
} as const;

// Syntax highlighting colors mapped to VSCode CSS variables
const COLORS = {
  sectionKeyword: CSS_COLORS.purple,
  interfaceType: CSS_COLORS.purple,
  property: CSS_COLORS.blue,
  interfaceName: CSS_COLORS.green,
  bracket: CSS_COLORS.foreground,
  value: CSS_COLORS.yellow,
  boolean: CSS_COLORS.purple,
  number: CSS_COLORS.red,
  string: CSS_COLORS.yellow,
  ipAddress: CSS_COLORS.orange,
  parameter: CSS_COLORS.blue,
  networkKeyword: CSS_COLORS.purple,
  vlan: CSS_COLORS.purple,
  protocol: CSS_COLORS.green,
  bgp: CSS_COLORS.red,
  route: CSS_COLORS.orange,
  comment: CSS_COLORS.description,
  foreground: CSS_COLORS.foreground,
};

// Colors affected by "less" mode (become foreground)
const LESS_MODE_AFFECTED = new Set([
  'sectionKeyword', 'interfaceType', 'property', 'interfaceName',
  'value', 'string', 'ipAddress', 'parameter', 'networkKeyword',
  'vlan', 'protocol', 'bgp', 'route'
]);

function getColor(colorKey: keyof typeof COLORS, colorMode: ColorMode): string {
  if (colorMode === 'none') return COLORS.foreground;
  if (colorMode === 'less' && LESS_MODE_AFFECTED.has(colorKey)) return COLORS.foreground;
  return COLORS[colorKey];
}

function makeSpan(text: string, colorKey: keyof typeof COLORS, colorMode: ColorMode, bold = false): string {
  const color = getColor(colorKey, colorMode);
  const fontWeight = bold ? '; font-weight: bold' : '';
  const fontStyle = colorKey === 'comment' ? '; font-style: italic' : '';
  return `<span style="color: ${color}${fontWeight}${fontStyle}">${text}</span>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateContext(line: string, context: ContextState): void {
  const trimmedLine = line.trim();
  const indentLevel = line.search(/\S|$/);
  context.level = Math.floor(indentLevel / 4);

  if (context.level === 0 && /^\w/.test(trimmedLine) && trimmedLine.endsWith('{')) {
    context.section = trimmedLine.split(' ')[0];
    context.interface = '';
    context.subBlock = '';
  } else if (context.level === 0 && trimmedLine.startsWith('interface ')) {
    context.section = 'interface';
    context.interface = trimmedLine.split(' ')[1];
    context.subBlock = '';
  } else if (context.level === 1 && trimmedLine.endsWith('{')) {
    context.subBlock = trimmedLine.split(' ')[0];
  } else if (trimmedLine === '}') {
    if (context.level === 0) {
      context.section = '';
      context.interface = '';
      context.subBlock = '';
    } else if (context.level === 1) {
      context.subBlock = '';
    }
  }
}

// Helper to determine the color key for a block keyword based on section
function getBlockKeywordColor(section: string): keyof typeof COLORS {
  return section === 'network-instance' ? 'networkKeyword' : 'property';
}

// Helper to determine the value color for keyword-value block patterns
function getKeywordValueColor(keyword: string): keyof typeof COLORS {
  return keyword === 'address' ? 'ipAddress' : 'value';
}

// Helper to determine property color based on context and property name
function getPropertyColor(
  property: string,
  context: ContextState
): keyof typeof COLORS {
  if (context.section === 'bfd' || property === 'admin-state') return 'parameter';
  if (property.includes('vlan')) return 'vlan';
  if (context.section === 'network-instance' && context.subBlock === 'protocols') return 'protocol';
  if (property.includes('bgp')) return 'bgp';
  if (property.includes('route')) return 'route';
  return 'property';
}

// Helper to determine value color based on value content and property
function getValueColor(
  value: string,
  property: string,
  context: ContextState
): { colorKey: keyof typeof COLORS; bold: boolean } {
  const BOOLEAN_VALUES = new Set(['true', 'false', 'enable', 'disable', 'up', 'down']);

  if (BOOLEAN_VALUES.has(value)) {
    return { colorKey: 'boolean', bold: true };
  }
  if (/^\d+$/.test(value)) {
    return { colorKey: 'number', bold: false };
  }
  if (/^"[^"]*"$/.test(value)) {
    return { colorKey: 'string', bold: false };
  }
  if (/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(value)) {
    return { colorKey: 'ipAddress', bold: false };
  }
  if (property === 'description') {
    return { colorKey: 'string', bold: false };
  }
  // Check if property has special coloring (bfd, vlan, protocol, bgp, route)
  const propColor = getPropertyColor(property, context);
  if (propColor !== 'property') {
    return { colorKey: 'value', bold: false };
  }
  return { colorKey: 'value', bold: false };
}

// Helper to highlight standalone values (in arrays or simple lines)
function highlightStandaloneValue(trimmed: string): keyof typeof COLORS {
  const BOOLEAN_VALUES = new Set(['enable', 'disable', 'up', 'down']);

  if (/^\d+$/.test(trimmed)) return 'number';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) return 'ipAddress';
  if (BOOLEAN_VALUES.has(trimmed)) return 'boolean';
  return 'value';
}

// Regex patterns used for syntax highlighting
const PATTERNS = {
  // Level 0 patterns
  sectionWithName: /^(\s*)(\w+)\s+([\w/-]+)\s*\{/,
  sectionWithNameReplace: /^(\s*)(\w+)\s+([\w./-]+)\s*\{/,
  sectionOnly: /^(\s*)(\w+)\s*\{/,
  // Level > 0 patterns
  blockKeyword: /^(\s*)(\w[\w-]+)\s*\{/,
  keywordValueBlock: /^(\s*)(\w[\w./-]+)\s+(\S[^\s]*(?:\s+[^\s{]+)*)\s*\{$/,
  propertyValue: /^(\s*)(\w[\w-]+)\s+(\S.*)$/,
  openBracket: /^(\s*)\[$/,
  closeBracket: /^(\s*)\]$/,
  standaloneValue: /^(\s*)(\w.*)$/,
  closeBrace: /^(\s*)\}$/,
} as const;

function highlightTopLevel(processedLine: string, colorMode: ColorMode): string {
  if (PATTERNS.sectionWithName.test(processedLine)) {
    return processedLine.replace(
      PATTERNS.sectionWithNameReplace,
      (_m, space, keyword, name) => (
        space +
        makeSpan(keyword, 'sectionKeyword', colorMode, true) + ' ' +
        makeSpan(name, 'interfaceName', colorMode, true) + ' ' +
        makeSpan('{', 'bracket', colorMode)
      )
    );
  }
  if (PATTERNS.sectionOnly.test(processedLine)) {
    return processedLine.replace(
      PATTERNS.sectionOnly,
      (_m, space, keyword) => space + makeSpan(keyword, 'sectionKeyword', colorMode, true) + ' ' + makeSpan('{', 'bracket', colorMode)
    );
  }
  return processedLine;
}

function highlightNestedBlock(processedLine: string, context: ContextState, colorMode: ColorMode): string {
  // Block keyword only: "ethernet {"
  if (PATTERNS.blockKeyword.test(processedLine)) {
    const colorKey = getBlockKeywordColor(context.section);
    return processedLine.replace(
      PATTERNS.blockKeyword,
      (_m, space, kw) => space + makeSpan(kw, colorKey, colorMode) + ' ' + makeSpan('{', 'bracket', colorMode)
    );
  }

  // Keyword with value and block: "subinterface 0 {" or "address 192.168.1.1/24 {"
  if (PATTERNS.keywordValueBlock.test(processedLine)) {
    return processedLine.replace(
      PATTERNS.keywordValueBlock,
      (_m: string, space: string, keyword: string, rest: string) => {
        const valueColorKey = getKeywordValueColor(keyword);
        return (
          space +
          makeSpan(keyword, 'property', colorMode) + ' ' +
          makeSpan(rest.replace(/\{$/, ''), valueColorKey, colorMode) + ' ' +
          makeSpan('{', 'bracket', colorMode)
        );
      }
    );
  }

  // Property-value pair: "admin-state enable"
  if (PATTERNS.propertyValue.test(processedLine)) {
    return processedLine.replace(
      PATTERNS.propertyValue,
      (_m, space, property, value) => {
        const propColorKey = getPropertyColor(property, context);
        const { colorKey: valColorKey, bold } = getValueColor(value, property, context);
        return space + makeSpan(property, propColorKey, colorMode) + ' ' + makeSpan(value, valColorKey, colorMode, bold);
      }
    );
  }

  // Brackets
  if (PATTERNS.openBracket.test(processedLine)) {
    return processedLine.replace(PATTERNS.openBracket, (_m, space) => space + makeSpan('[', 'bracket', colorMode));
  }
  if (PATTERNS.closeBracket.test(processedLine)) {
    return processedLine.replace(PATTERNS.closeBracket, (_m, space) => space + makeSpan(']', 'bracket', colorMode));
  }

  // Standalone value (in arrays)
  if (PATTERNS.standaloneValue.test(processedLine)) {
    const trimmed = processedLine.trim();
    const colorKey = highlightStandaloneValue(trimmed);
    const bold = colorKey === 'boolean';
    return processedLine.replace(PATTERNS.standaloneValue, (_m, space, val) => space + makeSpan(val, colorKey, colorMode, bold));
  }

  return processedLine;
}

function applySyntaxHighlighting(line: string, context: ContextState, colorMode: ColorMode): string {
  if (line.trim() === '') return '';

  let processedLine = escapeHtml(line);

  // Comments
  if (processedLine.trim().startsWith('#')) {
    return makeSpan(processedLine, 'comment', colorMode);
  }

  // Apply highlighting based on indentation level
  if (context.level === 0) {
    processedLine = highlightTopLevel(processedLine, colorMode);
  } else {
    processedLine = highlightNestedBlock(processedLine, context, colorMode);
  }

  // Handle closing brace
  if (processedLine.trim() === '}') {
    processedLine = processedLine.replace(PATTERNS.closeBrace, (_m, space) => space + makeSpan('}', 'bracket', colorMode));
  }

  return processedLine;
}

// Extract annotation info from an annotation object
function extractAnnotationInfo(ann: Annotation): { label: string; info: AnnotationInfo } {
  const label = ann.cr?.name || 'unknown';
  return {
    label,
    info: {
      name: label,
      group: ann.cr?.gvk?.group || '',
      version: ann.cr?.gvk?.version || '',
      kind: ann.cr?.gvk?.kind || ''
    }
  };
}

// Normalize a line range, handling undefined values and swapping if needed
function normalizeLineRange(range: LineRange): { start: number; end: number } | null {
  let start = range.startLine;
  let end = range.endLine;

  if (start === undefined && end !== undefined) {
    start = 0;
  }
  if (end === undefined && start !== undefined) {
    end = start;
  }
  if (start === undefined || end === undefined) {
    return null;
  }
  if (start > end) {
    [start, end] = [end, start];
  }
  return { start, end };
}

// Apply a line range to the annotation maps
function applyLineRange(
  range: { start: number; end: number },
  numLines: number,
  label: string,
  annMap: Set<string>[],
  annotationLineMap: Map<string, Set<number>>
): void {
  const { start, end } = range;
  const clampedStart = Math.max(0, start);
  const clampedEnd = Math.min(numLines - 1, end);

  for (let i = clampedStart; i <= clampedEnd; i++) {
    annMap[i].add(label);
    annotationLineMap.get(label)?.add(i + 1);
  }
}

function buildAnnotationMap(
  numLines: number,
  annotations: Annotation[],
  annotationLineMap: Map<string, Set<number>>,
  annotationInfoMap: Map<string, AnnotationInfo>
): string[][] {
  const annMap = Array.from({ length: numLines }, () => new Set<string>());
  annotationLineMap.clear();
  annotationInfoMap.clear();

  for (const ann of annotations) {
    const { label, info } = extractAnnotationInfo(ann);

    if (!annotationLineMap.has(label)) {
      annotationLineMap.set(label, new Set<number>());
      annotationInfoMap.set(label, info);
    }

    for (const range of ann.lines) {
      const normalized = normalizeLineRange(range);
      if (normalized) {
        applyLineRange(normalized, numLines, label, annMap, annotationLineMap);
      }
    }
  }

  return annMap.map(set => Array.from(set));
}

interface LineData {
  lineNum: number;
  content: string;
  annotationKey: string;
  annotationNames: string[];
  showDivider: boolean;
  annotationLabel?: string;
  annotationInfo?: AnnotationInfo;
}

function NodeConfigPanel() {
  const postMessage = usePostMessage();
  const [configText, setConfigText] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [colorMode, setColorMode] = useState<'full' | 'less' | 'none'>('full');
  const [isAnnotationsVisible, setIsAnnotationsVisible] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [highlightedAnnotation, setHighlightedAnnotation] = useState<string | null>(null);

  const annotationLineMapRef = useRef<Map<string, Set<number>>>(new Map());
  const annotationInfoMapRef = useRef<Map<string, AnnotationInfo>>(new Map());

  useReadySignal();

  useMessageListener<NodeConfigMessage>(useCallback((msg) => {
    if (msg.command === 'loadData') {
      setConfigText(msg.config || '');
      setAnnotations(msg.annotations || []);
      if (msg.colorMode) {
        setColorMode(msg.colorMode);
      }
    }
  }, []));

  const lineData = useMemo(() => {
    if (!configText) return [];

    const lines = configText.split('\n');
    const annotationMap = buildAnnotationMap(
      lines.length,
      annotations,
      annotationLineMapRef.current,
      annotationInfoMapRef.current
    );

    const result: LineData[] = [];
    const context: ContextState = { section: '', interface: '', subBlock: '', level: 0 };
    let previousAnnotation = '';
    let lastAnnotation = '';

    for (let index = 0; index < lines.length; index++) {
      const annotationNames = annotationMap[index] || [];
      const annotationKey = annotationNames.join('|');
      const showDivider = annotationKey !== '' && annotationKey !== previousAnnotation && lastAnnotation !== '';

      updateContext(lines[index], context);
      const highlightedContent = applySyntaxHighlighting(lines[index], context, colorMode);

      const firstAnnotation = annotationNames.length > 0 && annotationKey !== previousAnnotation ? annotationNames[0] : undefined;
      const annotationInfo = firstAnnotation ? annotationInfoMapRef.current.get(firstAnnotation) : undefined;

      result.push({
        lineNum: index + 1,
        content: highlightedContent,
        annotationKey,
        annotationNames,
        showDivider,
        annotationLabel: firstAnnotation,
        annotationInfo
      });

      previousAnnotation = annotationKey;
      if (annotationKey) {
        lastAnnotation = annotationKey;
      }
    }

    return result;
  }, [configText, annotations, colorMode]);

  const handleToggleAnnotations = useCallback(() => {
    setIsAnnotationsVisible(prev => !prev);
    setHighlightedAnnotation(null);
  }, []);

  const handleCopyConfig = useCallback(() => {
    navigator.clipboard.writeText(configText).then(() => {
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    }).catch(() => {});
  }, [configText]);

  const handleColorModeChange = useCallback((mode: ColorMode) => {
    setColorMode(mode);
    postMessage({ command: 'saveColorMode', colorMode: mode });
  }, [postMessage]);

  const handleLineHover = useCallback((annotationKey: string | null) => {
    if (!isAnnotationsVisible) return;
    setHighlightedAnnotation(annotationKey);
  }, [isAnnotationsVisible]);

  const isHighlighted = useCallback((annotationKey: string): boolean => {
    return highlightedAnnotation !== null && annotationKey === highlightedAnnotation;
  }, [highlightedAnnotation]);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        height: '100vh',
        overflow: 'hidden',
        fontFamily: 'var(--vscode-editor-font-family, monospace)',
        fontSize: 'var(--vscode-editor-font-size)'
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          p: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper'
        }}
      >
        <Button
          variant="contained"
          size="small"
          startIcon={isAnnotationsVisible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
          onClick={handleToggleAnnotations}
        >
          {isAnnotationsVisible ? 'Hide Annotations' : 'Show Annotations'}
        </Button>
        <Button
          variant="contained"
          size="small"
          startIcon={<ContentCopyIcon fontSize="small" />}
          onClick={handleCopyConfig}
        >
          Copy Config
        </Button>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="color-mode-label">Color Mode</InputLabel>
          <Select
            labelId="color-mode-label"
            value={colorMode}
            label="Color Mode"
            onChange={(event) => handleColorModeChange(event.target.value as ColorMode)}
          >
            <MenuItem value="full">Full Color</MenuItem>
            <MenuItem value="less">Less Color</MenuItem>
            <MenuItem value="none">No Color</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <Box
        sx={{
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: isAnnotationsVisible ? 'max-content auto 1fr' : 'auto 1fr'
        }}
      >
        {lineData.map((line, idx) => (
          <React.Fragment key={idx}>
            {line.showDivider && isAnnotationsVisible && (
              <Box sx={{ gridColumn: '1 / -1', borderBottom: 1, borderColor: 'divider', my: 1.5 }} />
            )}

            {isAnnotationsVisible && (
              <Box
                data-annotation={line.annotationKey}
                onMouseEnter={() => handleLineHover(line.annotationKey || null)}
                onMouseLeave={() => handleLineHover(null)}
                sx={{
                  py: 0.25,
                  px: 1.25,
                  whiteSpace: 'pre',
                  textAlign: 'right',
                  userSelect: 'none',
                  borderRight: 1,
                  borderColor: 'divider',
                  color: isHighlighted(line.annotationKey) ? 'text.primary' : 'text.secondary',
                  bgcolor: isHighlighted(line.annotationKey) ? 'action.selected' : 'action.hover',
                  fontWeight: isHighlighted(line.annotationKey) ? 700 : 400
                }}
              >
                {line.annotationLabel && (
                  <>
                    {line.annotationLabel}
                    {line.annotationInfo && line.annotationInfo.group && line.annotationInfo.version && line.annotationInfo.kind && (
                      <>
                        <br />
                        <Typography component="span" sx={{ fontSize: '0.8em' }}>
                          {line.annotationInfo.group}/{line.annotationInfo.version} {line.annotationInfo.kind}
                        </Typography>
                      </>
                    )}
                  </>
                )}
              </Box>
            )}

            <Box
              onMouseEnter={() => handleLineHover(line.annotationKey || null)}
              onMouseLeave={() => handleLineHover(null)}
              sx={{
                py: 0.25,
                px: 1.25,
                whiteSpace: 'pre',
                textAlign: 'right',
                color: 'text.secondary',
                userSelect: 'none',
                bgcolor: 'background.default'
              }}
            >
              {line.lineNum}
            </Box>

            <Box
              onMouseEnter={() => handleLineHover(line.annotationKey || null)}
              onMouseLeave={() => handleLineHover(null)}
              sx={{
                py: 0.25,
                px: 1.25,
                whiteSpace: 'pre',
                bgcolor: isHighlighted(line.annotationKey) ? 'action.selected' : 'background.default'
              }}
              dangerouslySetInnerHTML={{ __html: line.content || ' ' }}
            />
          </React.Fragment>
        ))}
      </Box>

      <Snackbar
        open={showToast}
        autoHideDuration={3000}
        onClose={() => setShowToast(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity="success" variant="filled">
          Config copied to clipboard
        </Alert>
      </Snackbar>
    </Box>
  );
}

mountWebview(NodeConfigPanel);
