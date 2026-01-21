import React from 'react';
import { createRoot } from 'react-dom/client';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { usePostMessage, useMessageListener } from '../shared/hooks';
import { VSCodeProvider } from '../shared/context';

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
  colorMode?: 'full' | 'less' | 'none';
}

interface ContextState {
  section: string;
  interface: string;
  subBlock: string;
  level: number;
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

function applySyntaxHighlighting(line: string, context: ContextState): string {
  if (line.trim() === '') return '';

  let processedLine = escapeHtml(line);

  if (processedLine.trim().startsWith('#')) {
    return '<span class="comment">' + processedLine + '</span>';
  }

  if (context.level === 0) {
    if (processedLine.match(/^(\s*)(\w+)\s+([\w/-]+)\s*\{/)) {
      processedLine = processedLine.replace(
        /^(\s*)(\w+)\s+([\w./-]+)\s*\{/,
        (_m, space, keyword, name) => {
          return (
            space +
            '<span class="section-keyword">' + keyword + '</span> ' +
            '<span class="interface-name">' + name + '</span> ' +
            '<span class="bracket">{</span>'
          );
        }
      );
    } else if (processedLine.match(/^(\s*)(\w+)\s*\{/)) {
      processedLine = processedLine.replace(
        /^(\s*)(\w+)\s*\{/,
        '$1<span class="section-keyword">$2</span> <span class="bracket">{</span>'
      );
    }
  } else {
    if (processedLine.match(/^(\s*)(\w[\w-]+)\s*\{/)) {
      if (context.section === 'interface' || context.section === 'bfd') {
        processedLine = processedLine.replace(
          /^(\s*)(\w[\w-]+)\s*\{/,
          '$1<span class="property">$2</span> <span class="bracket">{</span>'
        );
      } else if (context.section === 'network-instance') {
        processedLine = processedLine.replace(
          /^(\s*)(\w[\w-]+)\s*\{/,
          '$1<span class="network-keyword">$2</span> <span class="bracket">{</span>'
        );
      } else {
        processedLine = processedLine.replace(
          /^(\s*)(\w[\w-]+)\s*\{/,
          '$1<span class="property">$2</span> <span class="bracket">{</span>'
        );
      }
    } else if (processedLine.match(/^(\s*)(\w[\w./-]+)\s+(.+)\s*\{/)) {
      processedLine = processedLine.replace(
        /^(\s*)(\w[\w./-]+)\s+(.+)\s*\{/,
        (_m, space, keyword, rest) => {
          if (keyword === 'subinterface') {
            return (
              space +
              '<span class="property">' + keyword + '</span> ' +
              '<span class="value">' + rest.replace(/\{$/, '') + '</span> ' +
              '<span class="bracket">{</span>'
            );
          } else if (keyword === 'address') {
            return (
              space +
              '<span class="property">' + keyword + '</span> ' +
              '<span class="ip-address">' + rest.replace(/\{$/, '') + '</span> ' +
              '<span class="bracket">{</span>'
            );
          } else {
            return (
              space +
              '<span class="property">' + keyword + '</span> ' +
              '<span class="value">' + rest.replace(/\{$/, '') + '</span> ' +
              '<span class="bracket">{</span>'
            );
          }
        }
      );
    } else if (processedLine.match(/^(\s*)(\w[\w-]+)\s+(.+)$/)) {
      processedLine = processedLine.replace(
        /^(\s*)(\w[\w-]+)\s+(.+)$/,
        (_m, space, property, value) => {
          if (value === 'true' || value === 'false') {
            return space + '<span class="property">' + property + '</span> <span class="boolean">' + value + '</span>';
          } else if (value === 'enable' || value === 'disable' || value === 'up' || value === 'down') {
            return space + '<span class="property">' + property + '</span> <span class="boolean">' + value + '</span>';
          } else if (value.match(/^\d+$/)) {
            return space + '<span class="property">' + property + '</span> <span class="number">' + value + '</span>';
          } else if (value.match(/^".*"$/)) {
            return space + '<span class="property">' + property + '</span> <span class="string">' + value + '</span>';
          } else if (value.match(/^\d+\.\d+\.\d+\.\d+\/\d+$/)) {
            return space + '<span class="property">' + property + '</span> <span class="ip-address">' + value + '</span>';
          } else if (context.section === 'bfd' || property === 'admin-state') {
            return space + '<span class="parameter">' + property + '</span> <span class="value">' + value + '</span>';
          } else if (property === 'description') {
            return space + '<span class="property">' + property + '</span> <span class="string">' + value + '</span>';
          } else if (property.includes('vlan')) {
            return space + '<span class="vlan">' + property + '</span> <span class="value">' + value + '</span>';
          } else if (context.section === 'network-instance' && context.subBlock === 'protocols') {
            return space + '<span class="protocol">' + property + '</span> <span class="value">' + value + '</span>';
          } else if (property.includes('bgp')) {
            return space + '<span class="bgp">' + property + '</span> <span class="value">' + value + '</span>';
          } else if (property.includes('route')) {
            return space + '<span class="route">' + property + '</span> <span class="value">' + value + '</span>';
          } else {
            return space + '<span class="property">' + property + '</span> <span class="value">' + value + '</span>';
          }
        }
      );
    } else if (processedLine.match(/^(\s*)\[$/)) {
      processedLine = processedLine.replace(/^(\s*)\[$/, '$1<span class="bracket">[</span>');
    } else if (processedLine.match(/^(\s*)\]$/)) {
      processedLine = processedLine.replace(/^(\s*)\]$/, '$1<span class="bracket">]</span>');
    } else if (processedLine.match(/^(\s*)(\w.*)$/)) {
      const trimmed = processedLine.trim();
      if (trimmed.match(/^\d+$/)) {
        processedLine = processedLine.replace(/^(\s*)(\w.*)$/, '$1<span class="number">$2</span>');
      } else if (trimmed.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        processedLine = processedLine.replace(/^(\s*)(\w.*)$/, '$1<span class="ip-address">$2</span>');
      } else if (trimmed === 'enable' || trimmed === 'disable' || trimmed === 'up' || trimmed === 'down') {
        processedLine = processedLine.replace(/^(\s*)(\w.*)$/, '$1<span class="boolean">$2</span>');
      } else {
        processedLine = processedLine.replace(/^(\s*)(\w.*)$/, '$1<span class="value">$2</span>');
      }
    }
  }

  if (processedLine.trim() === '}') {
    processedLine = processedLine.replace(/^(\s*)\}$/, '$1<span class="bracket">}</span>');
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
      const highlightedContent = applySyntaxHighlighting(lines[index], context);

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
  }, [configText, annotations]);

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

  return (
    <div className={`container color-mode-${colorMode}`}>
      <div className="toolbar">
        <button className="button" onClick={handleToggleAnnotations}>
          <span className="button-icon">{'\u229E'}</span>
          <span>{isAnnotationsVisible ? 'Hide Annotations' : 'Show Annotations'}</span>
        </button>
        <button className="button" onClick={handleCopyConfig}>
          <span className="button-icon">{'\u29C9'}</span>
          <span>Copy Config</span>
        </button>
        <select className="select" value={colorMode} onChange={handleColorModeChange}>
          <option value="full">Full Color</option>
          <option value="less">Less Color</option>
          <option value="none">No Color</option>
        </select>
      </div>

      <div className={`config-view ${isAnnotationsVisible ? 'annotations-visible' : 'annotations-hidden'}`}>
        {lineData.map((line, idx) => (
          <div key={idx}>
            {line.showDivider && <div className="divider" style={{ gridColumn: '1 / -1' }} />}
            <div
              className={`line ${highlightedAnnotation && line.annotationKey === highlightedAnnotation ? 'line-highlight' : ''}`}
              data-line={line.lineNum}
              data-annotation={line.annotationKey}
              onMouseEnter={() => handleLineHover(line.annotationKey || null)}
              onMouseLeave={() => handleLineHover(null)}
            >
              <div className="line-annotation" data-annotation={line.annotationKey}>
                {line.annotationLabel && (
                  <>
                    {line.annotationLabel}
                    {line.annotationInfo && line.annotationInfo.group && line.annotationInfo.version && line.annotationInfo.kind && (
                      <>
                        <br />
                        <span className="annotation-info">
                          {line.annotationInfo.group}/{line.annotationInfo.version} {line.annotationInfo.kind}
                        </span>
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="line-num">{line.lineNum}</div>
              <div className="line-code" dangerouslySetInnerHTML={{ __html: line.content || ' ' }} />
            </div>
          </div>
        ))}
      </div>

      <div className={`toast ${showToast ? 'show' : ''}`}>
        <span className="button-icon">{'\u2713'}</span>
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
