/**
 * Format a value for display in the queries dashboard.
 * Handles arrays, objects, and primitives.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    const formatted = value.map(v => formatValue(v));
    const isPrimitive = value.every(
      v => v === null || v === undefined || typeof v !== 'object'
    );
    return formatted.join(isPrimitive ? ', ' : '\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '';
    return entries
      .map(([k, v]) => `${k}: ${formatValue(v)}`)
      .join(', ');
  }
  return String(value);
}

/**
 * Remove columns that are empty across all rows.
 */
export function pruneEmptyColumns(cols: string[], rows: unknown[][]): { cols: string[]; rows: unknown[][] } {
  if (!rows.length) {
    return { cols, rows };
  }
  const keep: number[] = [];
  cols.forEach((_, idx) => {
    const hasValue = rows.some(r => formatValue(r[idx]) !== '');
    if (hasValue) keep.push(idx);
  });
  return {
    cols: keep.map(i => cols[i]),
    rows: rows.map(r => keep.map(i => r[i]))
  };
}

/**
 * Convert results to ASCII table format.
 */
export function toAsciiTable(cols: string[], rows: unknown[][]): string {
  if (!cols.length) return '';
  const widths = cols.map((c, i) =>
    Math.max(c.length, ...rows.map(r => formatValue(r[i]).length))
  );
  const hr = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const header = '|' + cols.map((c, i) => ' ' + c.padEnd(widths[i]) + ' ').join('|') + '|';
  const lines = rows.map(row =>
    '|' + cols.map((_, i) => ' ' + formatValue(row[i]).padEnd(widths[i]) + ' ').join('|') + '|'
  );
  return [hr, header, hr, ...lines, hr].join('\n');
}

/**
 * Convert results to Markdown table format.
 */
export function toMarkdownTable(cols: string[], rows: unknown[][]): string {
  if (!cols.length) return '';
  const header = '| ' + cols.join(' | ') + ' |';
  const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
  const lines = rows.map(r =>
    '| ' +
    cols.map((_, i) =>
      formatValue(r[i]).replace(/[|]/g, '\\|').replace(/\n/g, '<br/>')
    ).join(' | ') +
    ' |'
  );
  return [header, sep, ...lines].join('\n');
}

/**
 * Convert results to JSON format.
 */
export function toJson(cols: string[], rows: unknown[][]): string {
  const objs = rows.map(r => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      obj[c] = r[i];
    });
    return obj;
  });
  return JSON.stringify(objs, null, 2);
}

/**
 * Convert results to YAML format.
 */
export function toYaml(cols: string[], rows: unknown[][]): string {
  const objs = rows.map(r => {
    const obj: Record<string, string> = {};
    cols.forEach((c, i) => {
      obj[c] = formatValue(r[i]);
    });
    return obj;
  });
  return objs
    .map(o =>
      Object.entries(o)
        .map(([k, v]) => k + ': ' + v)
        .join('\n')
    )
    .join('\n---\n');
}

export type CopyFormat = 'ascii' | 'markdown' | 'json' | 'yaml';

/**
 * Format results for clipboard based on selected format.
 */
export function formatForClipboard(format: CopyFormat, cols: string[], rows: unknown[][]): string {
  switch (format) {
    case 'ascii':
      return toAsciiTable(cols, rows);
    case 'markdown':
      return toMarkdownTable(cols, rows);
    case 'json':
      return toJson(cols, rows);
    case 'yaml':
      return toYaml(cols, rows);
  }
}
