import type { ResolvedJsonSchema, AutoCompleteHint } from './types';

/** Result of walking the schema to a path */
export interface SchemaAtPath {
  schema: ResolvedJsonSchema;
  /** Whether the final segment of the path resolved successfully */
  resolved: boolean;
}

export interface KeyCompletion {
  key: string;
  schema: ResolvedJsonSchema;
  required: boolean;
  orderPriority: number;
}

export interface ValueCompletion {
  value: string;
  description?: string;
  isDefault?: boolean;
}

/**
 * Walk a resolved schema along a property path.
 * Handles properties, items (arrays), and merges allOf/anyOf/oneOf.
 */
export function walkSchemaToPath(
  schema: ResolvedJsonSchema,
  path: string[]
): SchemaAtPath {
  let current = mergeSchemaCompositions(schema);

  for (const segment of path) {
    const props = current.properties;
    if (props && segment in props) {
      current = mergeSchemaCompositions(props[segment]);
      continue;
    }

    // Try items for array types
    if (current.items) {
      const itemSchema = mergeSchemaCompositions(current.items);
      if (itemSchema.properties && segment in itemSchema.properties) {
        current = mergeSchemaCompositions(itemSchema.properties[segment]);
        continue;
      }
    }

    // Try additionalProperties
    if (current.additionalProperties && typeof current.additionalProperties === 'object') {
      current = mergeSchemaCompositions(current.additionalProperties);
      continue;
    }

    return { schema: current, resolved: false };
  }

  return { schema: current, resolved: true };
}

/**
 * Get property key completions from a schema node.
 * Excludes already-present siblings. Sorts required first, then by ui-order-priority.
 */
export function getKeyCompletions(
  schema: ResolvedJsonSchema,
  existingSiblings: string[]
): KeyCompletion[] {
  const merged = mergeSchemaCompositions(schema);

  // If it's an array, offer completions for the item schema
  const target = (merged.type === 'array' && merged.items)
    ? mergeSchemaCompositions(merged.items)
    : merged;

  const props = target.properties;
  if (!props) {
    return [];
  }

  const requiredSet = new Set(target.required ?? []);
  const siblingSet = new Set(existingSiblings);

  const completions: KeyCompletion[] = [];

  for (const [key, propSchema] of Object.entries(props) as Array<[string, ResolvedJsonSchema]>) {
    if (siblingSet.has(key)) {
      continue;
    }

    const ext = propSchema['x-eda-nokia-com'];
    const orderPriority = ext?.['ui-order-priority'] ?? 9999;

    completions.push({
      key,
      schema: propSchema,
      required: requiredSet.has(key),
      orderPriority,
    });
  }

  // Sort: required first, then by order priority (lower = higher priority), then alphabetical
  completions.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (a.orderPriority !== b.orderPriority) return a.orderPriority - b.orderPriority;
    return a.key.localeCompare(b.key);
  });

  return completions;
}

/**
 * Get value completions from a schema node.
 * Returns enum values, defaults, boolean options, and type hints.
 */
export function getValueCompletions(schema: ResolvedJsonSchema): ValueCompletion[] {
  const merged = mergeSchemaCompositions(schema);
  const completions: ValueCompletion[] = [];
  const seen = new Set<string>();

  collectEnumValues(merged, completions, seen);
  collectBooleanValues(merged, completions);
  collectDefaultValue(merged, completions, seen);
  collectCompositionValues(merged, completions, seen);

  return completions;
}

/** Collect enum values into completions */
function collectEnumValues(
  schema: ResolvedJsonSchema,
  completions: ValueCompletion[],
  seen: Set<string>
): void {
  if (!schema.enum) return;
  for (const val of schema.enum) {
    const str = val === null ? 'null' : String(val);
    if (seen.has(str)) continue;
    seen.add(str);
    completions.push({
      value: str,
      description: schema.description,
      isDefault: schema.default !== undefined && String(schema.default) === str,
    });
  }
}

/** Collect boolean true/false values */
function collectBooleanValues(
  schema: ResolvedJsonSchema,
  completions: ValueCompletion[]
): void {
  if (schema.type !== 'boolean' || schema.enum) return;
  const defaultStr = schema.default !== undefined ? String(schema.default) : undefined;
  completions.push(
    { value: 'true', isDefault: defaultStr === 'true' },
    { value: 'false', isDefault: defaultStr === 'false' }
  );
}

/** Collect default value if not already covered */
function collectDefaultValue(
  schema: ResolvedJsonSchema,
  completions: ValueCompletion[],
  seen: Set<string>
): void {
  if (schema.default === undefined || completions.length > 0) return;
  const str = String(schema.default);
  if (seen.has(str)) return;
  completions.push({ value: str, isDefault: true, description: 'Default value' });
}

/** Collect values from oneOf/anyOf compositions */
function collectCompositionValues(
  schema: ResolvedJsonSchema,
  completions: ValueCompletion[],
  seen: Set<string>
): void {
  for (const composition of [schema.oneOf, schema.anyOf]) {
    if (!composition) continue;
    for (const option of composition) {
      if (!option.enum) continue;
      for (const val of option.enum) {
        const str = val === null ? 'null' : String(val);
        if (seen.has(str)) continue;
        seen.add(str);
        completions.push({ value: str, description: option.description });
      }
    }
  }
}

/**
 * Extract auto-complete hints from the schema's x-eda-nokia-com extension.
 */
export function getAutoCompleteHints(schema: ResolvedJsonSchema): AutoCompleteHint[] {
  const merged = mergeSchemaCompositions(schema);
  return merged['x-eda-nokia-com']?.['ui-auto-completes'] ?? [];
}

/**
 * Check if a field has labelselector format.
 */
export function isLabelSelector(schema: ResolvedJsonSchema): boolean {
  const merged = mergeSchemaCompositions(schema);
  return merged.format === 'labelselector';
}

/**
 * Merge allOf/anyOf/oneOf into a single flattened schema for completion purposes.
 */
export function mergeSchemaCompositions(schema: ResolvedJsonSchema): ResolvedJsonSchema {
  if (!schema.allOf && !schema.anyOf && !schema.oneOf) {
    return schema;
  }

  const merged: ResolvedJsonSchema = { ...schema };
  delete merged.allOf;
  delete merged.anyOf;
  delete merged.oneOf;

  const compositions = [
    ...(schema.allOf ?? []),
    ...(schema.anyOf ?? []),
    ...(schema.oneOf ?? []),
  ];

  for (const sub of compositions) {
    const resolved = mergeSchemaCompositions(sub);
    mergeStructuralFields(merged, resolved);
    mergeScalarFields(merged, resolved);
  }

  return merged;
}

/** Merge properties and required arrays from a resolved sub-schema into the target */
function mergeStructuralFields(target: ResolvedJsonSchema, source: ResolvedJsonSchema): void {
  if (source.properties) {
    target.properties = { ...target.properties, ...source.properties };
  }
  if (source.required) {
    target.required = [...(target.required ?? []), ...source.required];
  }
}

/** Merge scalar/first-wins fields from a resolved sub-schema into the target */
function mergeScalarFields(target: ResolvedJsonSchema, source: ResolvedJsonSchema): void {
  if (!target.type && source.type) target.type = source.type;
  if (!target.description && source.description) target.description = source.description;
  if (!target.title && source.title) target.title = source.title;
  if (target.enum === undefined && source.enum) target.enum = source.enum;
  if (target.default === undefined && source.default !== undefined) target.default = source.default;
  if (!target.items && source.items) target.items = source.items;
  if (!target['x-eda-nokia-com'] && source['x-eda-nokia-com']) {
    target['x-eda-nokia-com'] = source['x-eda-nokia-com'];
  }
}
