export type LabelSeparator = '=' | ':';

export interface ParsedLabel {
  key: string;
  value: string;
  separator: LabelSeparator;
}

const DEFAULT_LABEL_KEY = 'label';
const DEFAULT_LABEL_SEPARATOR: LabelSeparator = '=';

function resolveSeparator(line: string): { index: number; separator: LabelSeparator } | undefined {
  const equalsIndex = line.indexOf('=');
  const colonIndex = line.indexOf(':');
  if (equalsIndex < 0 && colonIndex < 0) {
    return undefined;
  }
  if (equalsIndex < 0) {
    return { index: colonIndex, separator: ':' };
  }
  if (colonIndex < 0) {
    return { index: equalsIndex, separator: '=' };
  }
  return equalsIndex < colonIndex
    ? { index: equalsIndex, separator: '=' }
    : { index: colonIndex, separator: ':' };
}

export function parseLabelLine(line: string): ParsedLabel {
  const resolved = resolveSeparator(line);
  if (!resolved) {
    return {
      key: DEFAULT_LABEL_KEY,
      value: line.trim(),
      separator: DEFAULT_LABEL_SEPARATOR
    };
  }
  return {
    key: line.slice(0, resolved.index).trim() || DEFAULT_LABEL_KEY,
    value: line.slice(resolved.index + 1).trim(),
    separator: resolved.separator
  };
}

export function parseLabelsText(value: string): ParsedLabel[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.map((line) => parseLabelLine(line));
}

export function toLabelText(label: Readonly<ParsedLabel>): string {
  return `${label.key}${label.separator}${label.value}`;
}
