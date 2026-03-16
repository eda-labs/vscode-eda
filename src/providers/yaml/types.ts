// Shared types for YAML autocomplete providers

/** Fully-resolved JSON schema (no $ref pointers remain) */
export interface ResolvedJsonSchema {
  type?: string;
  description?: string;
  title?: string;
  default?: unknown;
  enum?: unknown[];
  pattern?: string;
  format?: string;
  required?: string[];
  properties?: Record<string, ResolvedJsonSchema>;
  items?: ResolvedJsonSchema;
  additionalProperties?: boolean | ResolvedJsonSchema;
  allOf?: ResolvedJsonSchema[];
  anyOf?: ResolvedJsonSchema[];
  oneOf?: ResolvedJsonSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  'x-eda-nokia-com'?: EdaNokiaComExtension;
}

export interface EdaNokiaComExtension {
  'ui-order-priority'?: number;
  'ui-column-span'?: number;
  'ui-title'?: string;
  'ui-title-key'?: string;
  'ui-visible-if'?: string;
  'ui-pattern-error'?: string;
  'ui-auto-completes'?: AutoCompleteHint[];
  'ui-category'?: string;
  'ui-single-line-group'?: string;
  'ui-may-reorder'?: boolean;
  'ui-unique-key'?: boolean;
  'ui-internal-feature'?: boolean;
  'ui-presence-toggle'?: boolean;
  immutable?: boolean;
}

export interface AutoCompleteHint {
  condition?: string;
  type: 'gvr' | 'label' | 'labelselector' | string;
  group?: string;
  version?: string;
  resource?: string;
  kind?: string;
}

/** Context parsed from YAML cursor position */
export interface YamlContext {
  /** Resource kind from root-level `kind:` field */
  kind: string | undefined;
  /** API version from root-level `apiVersion:` field */
  apiVersion: string | undefined;
  /** Property path from document root to cursor (e.g. ['spec', 'ethernet', 'mtu']) */
  path: string[];
  /** Whether cursor expects a property key */
  isKey: boolean;
  /** Whether cursor expects a value */
  isValue: boolean;
  /** Whether cursor is inside an array item (after `- `) */
  isArrayItem: boolean;
  /** Keys already defined at the current indentation level */
  existingSiblingKeys: string[];
  /** Key on the current line (if any) */
  currentKey: string | undefined;
  /** Partial value typed so far on the current line */
  currentValue: string | undefined;
  /** The namespace from the document metadata */
  namespace: string | undefined;
}
