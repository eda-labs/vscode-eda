import React from 'react';
import { createRoot } from 'react-dom/client';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { usePostMessage, useMessageListener } from '../shared/hooks';
import { VSCodeProvider } from '../shared/context';

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

// Syntax highlighting colors mapped to VSCode CSS variables
const COLORS = {
  sectionKeyword: 'var(--vscode-charts-purple)',
  interfaceType: 'var(--vscode-charts-purple)',
  property: 'var(--vscode-charts-blue)',
  interfaceName: 'var(--vscode-charts-green)',
  bracket: 'var(--vscode-editor-foreground)',
  value: 'var(--vscode-charts-yellow)',
  boolean: 'var(--vscode-charts-purple)',
  number: 'var(--vscode-charts-red)',
  string: 'var(--vscode-charts-yellow)',
  ipAddress: 'var(--vscode-charts-orange)',
  parameter: 'var(--vscode-charts-blue)',
  networkKeyword: 'var(--vscode-charts-purple)',
  vlan: 'var(--vscode-charts-purple)',
  protocol: 'var(--vscode-charts-green)',
  bgp: 'var(--vscode-charts-red)',
  route: 'var(--vscode-charts-orange)',
  comment: 'var(--vscode-descriptionForeground)',
  foreground: 'var(--vscode-editor-foreground)',
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

  if (context.level === 0 && trimmedLine.match(/^\w+.*\{$/)) {
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

function applySyntaxHighlighting(line: string, context: ContextState, colorMode: ColorMode): string {
  if (line.trim() === '') return '';

  let processedLine = escapeHtml(line);

  if (processedLine.trim().startsWith('#')) {
    return makeSpan(processedLine, 'comment', colorMode);
  }

  if (context.level === 0) {
    if (processedLine.match(/^(\s*)(\w+)\s+([\w/-]+)\s*\{/)) {
      processedLine = processedLine.replace(
        /^(\s*)(\w+)\s+([\w./-]+)\s*\{/,
        (_m, space, keyword, name) => {
          return (
            space +
            makeSpan(keyword, 'sectionKeyword', colorMode, true) + ' ' +
            makeSpan(name, 'interfaceName', colorMode, true) + ' ' +
            makeSpan('{', 'bracket', colorMode)
          );
        }
      );
    } else if (processedLine.match(/^(\s*)(\w+)\s*\{/)) {
      processedLine = processedLine.replace(
        /^(\s*)(\w+)\s*\{/,
        (_m, space, keyword) => {
          return space + makeSpan(keyword, 'sectionKeyword', colorMode, true) + ' ' + makeSpan('{', 'bracket', colorMode);
        }
      );
    }
  } else {
    if (processedLine.match(/^(\s*)(\w[\w-]+)\s*\{/)) {
      if (context.section === 'interface' || context.section === 'bfd') {
        processedLine = processedLine.replace(
          /^(\s*)(\w[\w-]+)\s*\{/,
          (_m, space, prop) => space + makeSpan(prop, 'property', colorMode) + ' ' + makeSpan('{', 'bracket', colorMode)
        );
      } else if (context.section === 'network-instance') {
        processedLine = processedLine.replace(
          /^(\s*)(\w[\w-]+)\s*\{/,
          (_m, space, kw) => space + makeSpan(kw, 'networkKeyword', colorMode) + ' ' + makeSpan('{', 'bracket', colorMode)
        );
      } else {
        processedLine = processedLine.replace(
          /^(\s*)(\w[\w-]+)\s*\{/,
          (_m, space, prop) => space + makeSpan(prop, 'property', colorMode) + ' ' + makeSpan('{', 'bracket', colorMode)
        );
      }
    } else if (processedLine.match(/^(\s*)(\w[\w./-]+)\s+(.+)\s*\{/)) {
      processedLine = processedLine.replace(
        /^(\s*)(\w[\w./-]+)\s+(.+)\s*\{/,
        (_m, space, keyword, rest) => {
          if (keyword === 'subinterface') {
            return (
              space +
              makeSpan(keyword, 'property', colorMode) + ' ' +
              makeSpan(rest.replace(/\{$/, ''), 'value', colorMode) + ' ' +
              makeSpan('{', 'bracket', colorMode)
            );
          } else if (keyword === 'address') {
            return (
              space +
              makeSpan(keyword, 'property', colorMode) + ' ' +
              makeSpan(rest.replace(/\{$/, ''), 'ipAddress', colorMode) + ' ' +
              makeSpan('{', 'bracket', colorMode)
            );
          } else {
            return (
              space +
              makeSpan(keyword, 'property', colorMode) + ' ' +
              makeSpan(rest.replace(/\{$/, ''), 'value', colorMode) + ' ' +
              makeSpan('{', 'bracket', colorMode)
            );
          }
        }
      );
    } else if (processedLine.match(/^(\s*)(\w[\w-]+)\s+(.+)$/)) {
      processedLine = processedLine.replace(
        /^(\s*)(\w[\w-]+)\s+(.+)$/,
        (_m, space, property, value) => {
          if (value === 'true' || value === 'false') {
            return space + makeSpan(property, 'property', colorMode) + ' ' + makeSpan(value, 'boolean', colorMode, true);
          } else if (value === 'enable' || value === 'disable' || value === 'up' || value === 'down') {
            return space + makeSpan(property, 'property', colorMode) + ' ' + makeSpan(value, 'boolean', colorMode, true);
          } else if (value.match(/^\d+$/)) {
            return space + makeSpan(property, 'property', colorMode) + ' ' + makeSpan(value, 'number', colorMode);
          } else if (value.match(/^".*"$/)) {
            return space + makeSpan(property, 'property', colorMode) + ' ' + makeSpan(value, 'string', colorMode);
          } else if (value.match(/^\d+\.\d+\.\d+\.\d+\/\d+$/)) {
            return space + makeSpan(property, 'property', colorMode) + ' ' + makeSpan(value, 'ipAddress', colorMode);
          } else if (context.section === 'bfd' || property === 'admin-state') {
            return space + makeSpan(property, 'parameter', colorMode) + ' ' + makeSpan(value, 'value', colorMode);
          } else if (property === 'description') {
            return space + makeSpan(property, 'property', colorMode) + ' ' + makeSpan(value, 'string', colorMode);
          } else if (property.includes('vlan')) {
            return space + makeSpan(property, 'vlan', colorMode) + ' ' + makeSpan(value, 'value', colorMode);
          } else if (context.section === 'network-instance' && context.subBlock === 'protocols') {
            return space + makeSpan(property, 'protocol', colorMode) + ' ' + makeSpan(value, 'value', colorMode);
          } else if (property.includes('bgp')) {
            return space + makeSpan(property, 'bgp', colorMode) + ' ' + makeSpan(value, 'value', colorMode);
          } else if (property.includes('route')) {
            return space + makeSpan(property, 'route', colorMode) + ' ' + makeSpan(value, 'value', colorMode);
          } else {
            return space + makeSpan(property, 'property', colorMode) + ' ' + makeSpan(value, 'value', colorMode);
          }
        }
      );
    } else if (processedLine.match(/^(\s*)\[$/)) {
      processedLine = processedLine.replace(/^(\s*)\[$/, (_m, space) => space + makeSpan('[', 'bracket', colorMode));
    } else if (processedLine.match(/^(\s*)\]$/)) {
      processedLine = processedLine.replace(/^(\s*)\]$/, (_m, space) => space + makeSpan(']', 'bracket', colorMode));
    } else if (processedLine.match(/^(\s*)(\w.*)$/)) {
      const trimmed = processedLine.trim();
      if (trimmed.match(/^\d+$/)) {
        processedLine = processedLine.replace(/^(\s*)(\w.*)$/, (_m, space, val) => space + makeSpan(val, 'number', colorMode));
      } else if (trimmed.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        processedLine = processedLine.replace(/^(\s*)(\w.*)$/, (_m, space, val) => space + makeSpan(val, 'ipAddress', colorMode));
      } else if (trimmed === 'enable' || trimmed === 'disable' || trimmed === 'up' || trimmed === 'down') {
        processedLine = processedLine.replace(/^(\s*)(\w.*)$/, (_m, space, val) => space + makeSpan(val, 'boolean', colorMode, true));
      } else {
        processedLine = processedLine.replace(/^(\s*)(\w.*)$/, (_m, space, val) => space + makeSpan(val, 'value', colorMode));
      }
    }
  }

  if (processedLine.trim() === '}') {
    processedLine = processedLine.replace(/^(\s*)\}$/, (_m, space) => space + makeSpan('}', 'bracket', colorMode));
  }

  return processedLine;
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
    const label = ann.cr?.name || 'unknown';
    const info: AnnotationInfo = {
      name: ann.cr?.name || 'unknown',
      group: ann.cr?.gvk?.group || '',
      version: ann.cr?.gvk?.version || '',
      kind: ann.cr?.gvk?.kind || ''
    };

    if (!annotationLineMap.has(label)) {
      annotationLineMap.set(label, new Set<number>());
      annotationInfoMap.set(label, info);
    }

    for (const range of ann.lines) {
      let start = range.startLine;
      let end = range.endLine;

      if (start === undefined && end !== undefined) {
        start = 0;
      }
      if (end === undefined && start !== undefined) {
        end = start;
      }
      if (start === undefined || end === undefined) {
        continue;
      }
      if (start > end) {
        const tmp = start;
        start = end;
        end = tmp;
      }

      for (let i = Math.max(0, start); i <= Math.min(numLines - 1, end); i++) {
        annMap[i].add(label);
        annotationLineMap.get(label)?.add(i + 1);
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

  useMessageListener<NodeConfigMessage>(useCallback((msg) => {
    if (msg.command === 'loadData') {
      setConfigText(msg.config || '');
      setAnnotations(msg.annotations || []);
      if (msg.colorMode) {
        setColorMode(msg.colorMode);
      }
    }
  }, []));

  useEffect(() => {
    postMessage({ command: 'ready' });
  }, [postMessage]);

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
    });
  }, [configText]);

  const handleColorModeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const mode = e.target.value as 'full' | 'less' | 'none';
    setColorMode(mode);
    postMessage({ command: 'saveColorMode', colorMode: mode });
  }, [postMessage]);

  const handleLineHover = useCallback((annotationKey: string | null) => {
    if (!isAnnotationsVisible) return;
    setHighlightedAnnotation(annotationKey);
  }, [isAnnotationsVisible]);

  const isHighlighted = useCallback((annotationKey: string) => {
    return highlightedAnnotation && annotationKey === highlightedAnnotation;
  }, [highlightedAnnotation]);

  return (
    <div className="grid grid-rows-[auto_1fr] h-screen overflow-hidden font-mono text-[length:var(--vscode-editor-font-size)]">
      {/* Toolbar */}
      <div className="p-3 bg-[var(--vscode-sideBar-background)] border-b border-[var(--vscode-sideBar-border)] flex items-center gap-2.5">
        <button
          className="bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] border border-[var(--vscode-button-border,transparent)] rounded px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-sm transition-all hover:bg-[var(--vscode-button-hoverBackground)] hover:-translate-y-px cursor-pointer"
          onClick={handleToggleAnnotations}
        >
          <span className="text-sm leading-none">{'\u229E'}</span>
          <span>{isAnnotationsVisible ? 'Hide Annotations' : 'Show Annotations'}</span>
        </button>
        <button
          className="bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] border border-[var(--vscode-button-border,transparent)] rounded px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-sm transition-all hover:bg-[var(--vscode-button-hoverBackground)] hover:-translate-y-px cursor-pointer"
          onClick={handleCopyConfig}
        >
          <span className="text-sm leading-none">{'\u29C9'}</span>
          <span>Copy Config</span>
        </button>
        <select
          className="bg-[var(--vscode-dropdown-background)] text-[var(--vscode-dropdown-foreground)] border border-[var(--vscode-dropdown-border)] rounded px-2 py-1.5 text-xs cursor-pointer"
          value={colorMode}
          onChange={handleColorModeChange}
        >
          <option value="full">Full Color</option>
          <option value="less">Less Color</option>
          <option value="none">No Color</option>
        </select>
      </div>

      {/* Config View */}
      <div className={`grid overflow-y-auto font-mono transition-[grid-template-columns] duration-300 ${
        isAnnotationsVisible
          ? '[grid-template-columns:max-content_auto_1fr]'
          : '[grid-template-columns:auto_1fr]'
      }`}>
        {lineData.map((line, idx) => (
          <div key={idx} className="contents">
            {line.showDivider && isAnnotationsVisible && (
              <div className="col-span-full border-b border-[var(--vscode-textSeparator-foreground)] my-2.5" />
            )}
            <div
              className="contents"
              data-line={line.lineNum}
              data-annotation={line.annotationKey}
              onMouseEnter={() => handleLineHover(line.annotationKey || null)}
              onMouseLeave={() => handleLineHover(null)}
            >
              {/* Annotation column */}
              {isAnnotationsVisible && (
                <div
                  className={`py-0.5 px-2.5 whitespace-pre text-right cursor-default select-none border-r border-[var(--vscode-sideBar-border)] transition-colors duration-200 ${
                    isHighlighted(line.annotationKey)
                      ? 'text-[var(--vscode-list-activeSelectionForeground)] bg-[var(--vscode-list-activeSelectionBackground)] font-bold'
                      : 'text-[var(--vscode-descriptionForeground)] bg-[var(--vscode-editorWidget-background)] hover:text-[var(--vscode-list-hoverForeground)] hover:bg-[var(--vscode-list-hoverBackground)]'
                  }`}
                  data-annotation={line.annotationKey}
                >
                  {line.annotationLabel && (
                    <>
                      {line.annotationLabel}
                      {line.annotationInfo && line.annotationInfo.group && line.annotationInfo.version && line.annotationInfo.kind && (
                        <>
                          <br />
                          <span className="text-[0.8em] text-[var(--vscode-editor-foreground)]">
                            {line.annotationInfo.group}/{line.annotationInfo.version} {line.annotationInfo.kind}
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
              {/* Line number column */}
              <div className="py-0.5 px-2.5 whitespace-pre text-right text-[var(--vscode-editorLineNumber-foreground)] bg-[var(--vscode-editor-background)] select-none">
                {line.lineNum}
              </div>
              {/* Code column */}
              <div
                className={`py-0.5 px-2.5 whitespace-pre transition-colors duration-200 relative z-[1] ${
                  isHighlighted(line.annotationKey)
                    ? 'bg-[var(--vscode-editor-selectionBackground)]'
                    : 'bg-[var(--vscode-editor-background)]'
                }`}
                dangerouslySetInnerHTML={{ __html: line.content || ' ' }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Toast notification */}
      <div className={`fixed bottom-5 right-5 bg-[var(--vscode-notificationToast-background)] text-[var(--vscode-notificationToast-foreground)] py-2.5 px-4 rounded shadow-lg z-[9999] flex items-center gap-2 transition-all duration-300 ${
        showToast
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-5 pointer-events-none'
      }`}>
        <span className="text-sm leading-none">{'\u2713'}</span>
        <span>Config copied to clipboard</span>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <VSCodeProvider>
      <NodeConfigPanel />
    </VSCodeProvider>
  );
}
