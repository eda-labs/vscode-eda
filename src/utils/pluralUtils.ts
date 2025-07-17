const irregularMap: Record<string, string> = {
  chassis: 'chassis',
};

export function kindToPlural(kind: string): string {
  const lower = kind.toLowerCase();
  if (lower in irregularMap) {
    return irregularMap[lower];
  }
  if (/[^aeiou]y$/.test(lower)) {
    return lower.slice(0, -1) + 'ies';
  }
  if (/(s|x|z|ch|sh)$/.test(lower)) {
    return lower + 'es';
  }
  return lower + 's';
}
