/**
 * Shallow comparison utility for arrays.
 * More efficient than JSON.stringify for comparing arrays of primitives.
 */
export function shallowArrayEquals<T>(a: T[], b: T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
