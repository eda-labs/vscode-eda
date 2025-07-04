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
