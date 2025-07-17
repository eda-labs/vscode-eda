import * as yaml from 'js-yaml';

/**
 * Recursively remove all properties named 'managedFields'.
 */
function removeManagedFields(obj: any): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach(item => removeManagedFields(item));
    return;
  }

  for (const key of Object.keys(obj)) {
    if (key === 'managedFields') {
      delete obj[key];
      continue;
    }
    removeManagedFields(obj[key]);
  }
}

/**
 * Create a deep clone of the given object and remove any 'managedFields'.
 */
export function sanitizeResource<T>(resource: T): T {
  const clone: any = JSON.parse(JSON.stringify(resource));
  removeManagedFields(clone);
  return clone as T;
}

/**
 * Recursively remove common metadata fields that should not be edited
 */
function removeEditMetadata(obj: any): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach(item => removeEditMetadata(item));
    return;
  }

  if (obj.metadata && typeof obj.metadata === 'object') {
    delete obj.metadata.annotations;
    delete obj.metadata.creationTimestamp;
    // resourceVersion is required for updates, so keep it
    delete obj.metadata.generation;
    delete obj.metadata.uid;
  }

  for (const key of Object.keys(obj)) {
    removeEditMetadata(obj[key]);
  }
}

/**
 * Clone the object and remove managedFields as well as edit-only metadata
 */
export function sanitizeResourceForEdit<T>(resource: T): T {
  const clone: any = JSON.parse(JSON.stringify(resource));
  removeManagedFields(clone);
  removeEditMetadata(clone);
  return clone as T;
}

/**
 * Remove 'managedFields' from YAML string(s).
 */
export function stripManagedFieldsFromYaml(yamlText: string): string {
  const docs: any[] = [];
  yaml.loadAll(yamlText, doc => {
    if (doc !== undefined) {
      const sanitized = sanitizeResource(doc);
      docs.push(sanitized);
    }
  });
  return docs.map(d => yaml.dump(d, { indent: 2 })).join('---\n');
}
