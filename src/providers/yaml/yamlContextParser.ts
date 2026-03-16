import type * as vscode from 'vscode';

import type { YamlContext } from './types';

/**
 * Parse the YAML context at the given cursor position.
 * Uses indentation-based line scanning (no full YAML AST) to handle
 * incomplete/mid-edit documents naturally.
 */
export function parseYamlContext(
  document: vscode.TextDocument,
  position: vscode.Position
): YamlContext {
  const lineIndex = position.line;
  const lineText = document.lineAt(lineIndex).text;

  // Find the start of the current YAML document (after `---`)
  const docStart = findDocumentStart(document, lineIndex);

  // Extract kind, apiVersion, namespace from root-level fields
  const { kind, apiVersion, namespace } = extractRootFields(document, docStart, lineIndex);

  // Determine indentation of the current line
  const cursorCol = position.character;
  const lineIndent = getIndent(lineText);

  // Parse key:value on current line
  const { currentKey, currentKeyPrefix, currentValue, isKey, isValue } = parseCurrentLine(lineText, cursorCol);

  // Check if we're on an array item line
  const trimmed = lineText.trimStart();
  const isArrayItem = trimmed.startsWith('- ');
  const currentArrayItemValue = parseArrayItemValue(lineText, cursorCol);

  // Build path from root to cursor by scanning backwards
  const path = buildPath(document, lineIndex, lineIndent, docStart, isArrayItem);

  // Collect sibling keys at the same indent level
  const existingSiblingKeys = collectSiblingKeys(document, lineIndex, lineIndent, docStart, isArrayItem);

  return {
    kind,
    apiVersion,
    path,
    isKey,
    isValue,
    isArrayItem,
    existingSiblingKeys,
    currentKey,
    currentKeyPrefix,
    currentValue,
    currentArrayItemValue,
    namespace,
  };
}

/** Find the line index of the start of the current YAML document (after `---`) */
function findDocumentStart(document: vscode.TextDocument, fromLine: number): number {
  for (let i = fromLine; i >= 0; i--) {
    const text = document.lineAt(i).text.trim();
    if (text === '---') {
      return i + 1;
    }
  }
  return 0;
}

/** Extract root-level kind, apiVersion, and metadata.namespace */
function extractRootFields(
  document: vscode.TextDocument,
  docStart: number,
  maxLine: number
): { kind: string | undefined; apiVersion: string | undefined; namespace: string | undefined } {
  let kind: string | undefined;
  let apiVersion: string | undefined;
  let namespace: string | undefined;
  let inMetadata = false;

  const end = Math.min(document.lineCount, maxLine + 200);
  for (let i = docStart; i < end; i++) {
    const text = document.lineAt(i).text;
    const indent = getIndent(text);
    const trimmed = text.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    if (indent === 0) {
      inMetadata = false;
      const result = parseRootLevelField(trimmed);
      if (result) {
        if (result.field === 'kind') kind = result.value;
        else if (result.field === 'apiVersion') apiVersion = result.value;
        else if (result.field === 'metadata') inMetadata = true;
      }
    } else if (inMetadata && indent === 2) {
      const ns = parseNamespaceField(trimmed);
      if (ns) namespace = ns;
    }
  }

  return { kind, apiVersion, namespace };
}

/** Parse a root-level key:value line */
function parseRootLevelField(
  trimmed: string
): { field: 'kind' | 'apiVersion' | 'metadata'; value?: string } | undefined {
  const kvMatch = /^(\w+):\s*(.*)$/.exec(trimmed);
  if (!kvMatch) return undefined;
  const key = kvMatch[1];
  const val = kvMatch[2].trim();
  if (key === 'kind' && val) return { field: 'kind', value: val };
  if (key === 'apiVersion' && val) return { field: 'apiVersion', value: val };
  if (key === 'metadata') return { field: 'metadata' };
  return undefined;
}

/** Parse a namespace field from an indented metadata line */
function parseNamespaceField(trimmed: string): string | undefined {
  const kvMatch = /^(\w+):\s*(.*)$/.exec(trimmed);
  if (kvMatch && kvMatch[1] === 'namespace' && kvMatch[2].trim()) {
    return kvMatch[2].trim();
  }
  return undefined;
}

/** Parse the current line to determine key, value, isKey, isValue */
function parseCurrentLine(
  lineText: string,
  cursorCol: number
): {
  currentKey: string | undefined;
  currentKeyPrefix: string | undefined;
  currentValue: string | undefined;
  isKey: boolean;
  isValue: boolean;
} {
  const trimmed = lineText.trimStart();
  const offset = lineText.length - trimmed.length;

  // Strip array marker for analysis
  const contentAfterMarker = trimmed.startsWith('- ') ? trimmed.slice(2) : trimmed;
  const markerOffset = trimmed.startsWith('- ') ? 2 : 0;
  const contentCursorCol = Math.max(0, cursorCol - offset - markerOffset);
  const contentToCursor = contentAfterMarker.slice(0, contentCursorCol);

  // Find colon position in the content
  const colonIndex = contentAfterMarker.indexOf(':');

  if (colonIndex === -1) {
    const keyPrefix = contentToCursor.trim();
    // No colon - we're typing a key
    return {
      currentKey: undefined,
      currentKeyPrefix: keyPrefix || undefined,
      currentValue: undefined,
      isKey: true,
      isValue: false,
    };
  }

  // There's a colon - determine if cursor is before or after it
  const absoluteColonPos = offset + markerOffset + colonIndex;

  if (cursorCol <= absoluteColonPos) {
    const key = contentAfterMarker.slice(0, colonIndex).trim();
    const keyPrefix = contentAfterMarker.slice(0, Math.min(contentCursorCol, colonIndex)).trim();
    // Cursor is before or at the colon - typing a key
    return {
      currentKey: key || undefined,
      currentKeyPrefix: keyPrefix || undefined,
      currentValue: undefined,
      isKey: true,
      isValue: false,
    };
  }

  // Cursor is after the colon - typing a value
  const valueStart = absoluteColonPos + 1;
  const valueText = lineText.slice(valueStart, cursorCol).trim();
  const key = contentAfterMarker.slice(0, colonIndex).trim();
  return {
    currentKey: key || undefined,
    currentKeyPrefix: undefined,
    currentValue: valueText || undefined,
    isKey: false,
    isValue: true,
  };
}

/** Parse the partially typed scalar value on an array item line (`- value`) */
function parseArrayItemValue(lineText: string, cursorCol: number): string | undefined {
  const trimmed = lineText.trimStart();
  if (!trimmed.startsWith('- ')) {
    return undefined;
  }

  const offset = lineText.length - trimmed.length;
  const valueStart = offset + 2;
  if (cursorCol < valueStart) {
    return '';
  }

  const rawValue = lineText.slice(valueStart, cursorCol);
  if (rawValue.includes(':')) {
    return undefined;
  }

  return rawValue.trim();
}

/** Build the property path from the document root to the cursor */
function buildPath(
  document: vscode.TextDocument,
  lineIndex: number,
  lineIndent: number,
  docStart: number,
  isArrayItem: boolean
): string[] {
  const path: string[] = [];
  let targetIndent = lineIndent;

  // If we're on an array item line, the effective indent is the array marker indent
  if (isArrayItem) {
    const text = document.lineAt(lineIndex).text;
    const trimmed = text.trimStart();
    const markerIndent = text.length - trimmed.length;
    targetIndent = markerIndent;
  }

  // Scan backwards to build path
  let currentIndent = targetIndent;
  for (let i = lineIndex - 1; i >= docStart; i--) {
    const text = document.lineAt(i).text;
    const trimmed = text.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const indent = getIndent(text);

    if (indent < currentIndent) {
      // This line is a parent
      const strippedLine = trimmed.startsWith('- ') ? trimmed.slice(2) : trimmed;
      const colonIdx = strippedLine.indexOf(':');
      if (colonIdx > 0) {
        const key = strippedLine.slice(0, colonIdx).trim();
        const valueAfterColon = strippedLine.slice(colonIdx + 1).trim();
        // Only add to path if this is a parent key (value is empty or block)
        if (valueAfterColon === '' || valueAfterColon === '|' || valueAfterColon === '>') {
          path.unshift(key);
          currentIndent = indent;
        }
      }
    }

    if (currentIndent === 0) {
      break;
    }
  }

  return path;
}

/** Extract a key name from a trimmed YAML line (strips `- ` prefix, finds key before `:`) */
function extractKeyFromLine(trimmed: string): string | undefined {
  const content = trimmed.startsWith('- ') ? trimmed.slice(2) : trimmed;
  const colonIdx = content.indexOf(':');
  return colonIdx > 0 ? content.slice(0, colonIdx).trim() : undefined;
}

/** Check if a line at the given indent is a sibling of the target level */
function isSiblingIndent(indent: number, lineIndent: number, effectiveIndent: number, isArrayItem: boolean): boolean {
  return indent === lineIndent || (isArrayItem && indent === effectiveIndent);
}

/** Scan lines in a direction, collecting sibling keys */
function scanForSiblingKeys(
  document: vscode.TextDocument,
  start: number,
  end: number,
  step: number,
  lineIndent: number,
  effectiveIndent: number,
  isArrayItem: boolean
): string[] {
  const keys: string[] = [];
  for (let i = start; step > 0 ? i < end : i >= end; i += step) {
    const text = document.lineAt(i).text;
    const trimmed = text.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (step > 0 && trimmed === '---') break;
    const indent = getIndent(text);
    if (indent < lineIndent && !trimmed.startsWith('- ')) break;
    if (isSiblingIndent(indent, lineIndent, effectiveIndent, isArrayItem)) {
      const key = extractKeyFromLine(trimmed);
      if (key) keys.push(key);
    }
  }
  return keys;
}

/** Collect keys that already exist at the same indentation level */
function collectSiblingKeys(
  document: vscode.TextDocument,
  lineIndex: number,
  lineIndent: number,
  docStart: number,
  isArrayItem: boolean
): string[] {
  const effectiveIndent = isArrayItem
    ? getIndent(document.lineAt(lineIndex).text) + 2
    : lineIndent;

  const backward = scanForSiblingKeys(document, lineIndex - 1, docStart, -1, lineIndent, effectiveIndent, isArrayItem);
  const forward = scanForSiblingKeys(document, lineIndex + 1, document.lineCount, 1, lineIndent, effectiveIndent, isArrayItem);

  const currentKey = extractKeyFromLine(document.lineAt(lineIndex).text.trim());
  const allKeys = [...backward, ...forward];
  if (currentKey) allKeys.push(currentKey);

  return [...new Set(allKeys)];
}

/** Get the number of leading spaces in a line */
function getIndent(line: string): number {
  const match = /^(\s*)/.exec(line);
  return match ? match[1].length : 0;
}
