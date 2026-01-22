import * as yaml from 'js-yaml';

/** Generic record type for objects that can be recursively traversed */
type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
interface JsonObject { [key: string]: JsonValue }
type JsonArray = JsonValue[];

/** Kubernetes metadata structure */
interface K8sMetadata {
  name?: string;
  namespace?: string;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
  generation?: number;
  uid?: string;
  resourceVersion?: string;
  [key: string]: unknown;
}

/** Kubernetes resource with metadata */
interface K8sResourceLike {
  metadata?: K8sMetadata;
  [key: string]: unknown;
}

/**
 * Recursively remove all properties named 'managedFields'.
 */
function removeManagedFields(obj: JsonValue): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach(item => removeManagedFields(item));
    return;
  }

  const record = obj as JsonObject;
  for (const key of Object.keys(record)) {
    if (key === 'managedFields') {
      delete record[key];
      continue;
    }
    removeManagedFields(record[key]);
  }
}

/**
 * Create a deep clone of the given object and remove any 'managedFields'.
 */
export function sanitizeResource<T>(resource: T): T {
  const clone = JSON.parse(JSON.stringify(resource)) as JsonValue;
  removeManagedFields(clone);
  return clone as T;
}

/**
 * Recursively remove common metadata fields that should not be edited
 */
function removeEditMetadata(obj: JsonValue): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach(item => removeEditMetadata(item));
    return;
  }

  const record = obj as K8sResourceLike;
  if (record.metadata && typeof record.metadata === 'object') {
    delete record.metadata.annotations;
    delete record.metadata.creationTimestamp;
    // resourceVersion is required for updates, so keep it
    delete record.metadata.generation;
    delete record.metadata.uid;
  }

  const jsonRecord = obj as JsonObject;
  for (const key of Object.keys(jsonRecord)) {
    removeEditMetadata(jsonRecord[key]);
  }
}

/**
 * Clone the object and remove managedFields as well as edit-only metadata
 */
export function sanitizeResourceForEdit<T>(resource: T): T {
  const clone = JSON.parse(JSON.stringify(resource)) as JsonValue;
  removeManagedFields(clone);
  removeEditMetadata(clone);
  return clone as T;
}

/**
 * Remove 'managedFields' from YAML string(s).
 */
export function stripManagedFieldsFromYaml(yamlText: string): string {
  const docs: unknown[] = [];
  yaml.loadAll(yamlText, (doc: unknown) => {
    if (doc !== undefined) {
      const sanitized = sanitizeResource(doc);
      docs.push(sanitized);
    }
  });
  return docs.map(d => yaml.dump(d, { indent: 2 })).join('---\n');
}
