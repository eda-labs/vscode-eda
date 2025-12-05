/**
 * Utilities for handling stream message field access with case-insensitive fallbacks.
 * The EDA API is inconsistent with field name casing (e.g., 'updates' vs 'Updates').
 */

/**
 * Get array field from stream message with case-insensitive fallback.
 * Checks lowercase first, then capitalized version.
 */
export function getUpdates(msg: any): any[] {
  if (Array.isArray(msg?.updates)) return msg.updates;
  if (Array.isArray(msg?.Updates)) return msg.Updates;
  return [];
}

/**
 * Get operations array from stream message with case-insensitive fallback.
 */
export function getOps(msg: any): any[] {
  if (Array.isArray(msg?.op)) return msg.op;
  if (Array.isArray(msg?.Op)) return msg.Op;
  return [];
}

/**
 * Get insert_or_modify from operation with case-insensitive fallback.
 */
export function getInsertOrModify(op: any): any | undefined {
  return op?.insert_or_modify ?? op?.Insert_or_modify ?? op?.insertOrModify ?? op?.InsertOrModify;
}

/**
 * Get delete from operation with case-insensitive fallback.
 */
export function getDelete(op: any): any | undefined {
  return op?.delete ?? op?.Delete;
}

/**
 * Get rows from insert_or_modify with case-insensitive fallback.
 */
export function getRows(insertOrModify: any): any[] {
  if (Array.isArray(insertOrModify?.rows)) return insertOrModify.rows;
  if (Array.isArray(insertOrModify?.Rows)) return insertOrModify.Rows;
  return [];
}

/**
 * Get ids from delete operation with case-insensitive fallback.
 */
export function getDeleteIds(deleteOp: any): any[] {
  if (Array.isArray(deleteOp?.ids)) return deleteOp.ids;
  if (Array.isArray(deleteOp?.Ids)) return deleteOp.Ids;
  return [];
}

/**
 * Get results array from stream message with case-insensitive fallback.
 */
export function getResults(msg: any): any[] {
  if (Array.isArray(msg?.results)) return msg.results;
  if (Array.isArray(msg?.Results)) return msg.Results;
  return [];
}
