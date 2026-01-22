/**
 * Utilities for handling stream message field access with case-insensitive fallbacks.
 * The EDA API is inconsistent with field name casing (e.g., 'updates' vs 'Updates').
 */

/** Stream message that may contain updates with case-insensitive field names */
export interface StreamMessageWithUpdates {
  updates?: unknown[];
  Updates?: unknown[];
}

/** Stream message that may contain operations with case-insensitive field names */
export interface StreamMessageWithOps {
  op?: unknown[];
  Op?: unknown[];
}

/** Operation that may contain insert_or_modify with various casing conventions */
export interface OperationWithInsertOrModify {
  insert_or_modify?: unknown;
  Insert_or_modify?: unknown;
  insertOrModify?: unknown;
  InsertOrModify?: unknown;
}

/** Operation that may contain delete with case-insensitive field names */
export interface OperationWithDelete {
  delete?: unknown;
  Delete?: unknown;
}

/** Insert or modify operation that may contain rows with case-insensitive field names */
export interface InsertOrModifyWithRows {
  rows?: unknown[];
  Rows?: unknown[];
}

/** Delete operation that may contain ids with case-insensitive field names */
export interface DeleteOperationWithIds {
  ids?: unknown[];
  Ids?: unknown[];
}

/** Stream message that may contain results with case-insensitive field names */
export interface StreamMessageWithResults {
  results?: unknown[];
  Results?: unknown[];
}

/**
 * Get array field from stream message with case-insensitive fallback.
 * Checks lowercase first, then capitalized version.
 */
export function getUpdates(msg: StreamMessageWithUpdates | null | undefined): unknown[] {
  if (Array.isArray(msg?.updates)) return msg.updates;
  if (Array.isArray(msg?.Updates)) return msg.Updates;
  return [];
}

/**
 * Get operations array from stream message with case-insensitive fallback.
 */
export function getOps(msg: StreamMessageWithOps | null | undefined): unknown[] {
  if (Array.isArray(msg?.op)) return msg.op;
  if (Array.isArray(msg?.Op)) return msg.Op;
  return [];
}

/**
 * Get insert_or_modify from operation with case-insensitive fallback.
 */
export function getInsertOrModify(op: OperationWithInsertOrModify | null | undefined): unknown {
  return op?.insert_or_modify ?? op?.Insert_or_modify ?? op?.insertOrModify ?? op?.InsertOrModify;
}

/**
 * Get delete from operation with case-insensitive fallback.
 */
export function getDelete(op: OperationWithDelete | null | undefined): unknown {
  return op?.delete ?? op?.Delete;
}

/**
 * Get rows from insert_or_modify with case-insensitive fallback.
 */
export function getRows(insertOrModify: InsertOrModifyWithRows | null | undefined): unknown[] {
  if (Array.isArray(insertOrModify?.rows)) return insertOrModify.rows;
  if (Array.isArray(insertOrModify?.Rows)) return insertOrModify.Rows;
  return [];
}

/**
 * Get ids from delete operation with case-insensitive fallback.
 */
export function getDeleteIds(deleteOp: DeleteOperationWithIds | null | undefined): unknown[] {
  if (Array.isArray(deleteOp?.ids)) return deleteOp.ids;
  if (Array.isArray(deleteOp?.Ids)) return deleteOp.Ids;
  return [];
}

/**
 * Get results array from stream message with case-insensitive fallback.
 */
export function getResults(msg: StreamMessageWithResults | null | undefined): unknown[] {
  if (Array.isArray(msg?.results)) return msg.results;
  if (Array.isArray(msg?.Results)) return msg.Results;
  return [];
}
