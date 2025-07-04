export interface ParsedUpdateKey {
  name?: string;
  namespace?: string;
}

/**
 * Parse a stream update key string and extract the final resource name and
 * namespace if present.
 *
 * @param key Update key string from a stream message
 * @returns Object containing optional name and namespace values
 */
export function parseUpdateKey(key: string): ParsedUpdateKey {
  const result: ParsedUpdateKey = {};
  if (!key) {
    return result;
  }

  const nameMatches = String(key).match(/\.name=="([^"]+)"/g);
  if (nameMatches && nameMatches.length > 0) {
    const last = nameMatches[nameMatches.length - 1].match(/\.name=="([^"]+)"/);
    if (last) {
      result.name = last[1];
    }
  }

  const nsMatch = String(key).match(/namespace\{\.name=="([^"]+)"\}/);
  if (nsMatch) {
    result.namespace = nsMatch[1];
  }

  return result;
}
