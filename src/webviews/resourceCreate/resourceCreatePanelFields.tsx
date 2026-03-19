import { useCallback, useMemo, type ReactNode } from 'react';
import {
  Add as AddIcon,
  DeleteOutline as DeleteOutlineIcon,
  ExpandMore as ExpandMoreIcon,
  InfoOutlined as InfoOutlinedIcon
} from '@mui/icons-material';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import type { JsonSchemaNode } from './types';

export type PathSegment = string | number;

const MAX_RENDER_DEPTH = 7;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneResource(resource: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(resource)) as Record<string, unknown>;
}

function schemaType(schema: JsonSchemaNode | undefined): string {
  if (!schema) {
    return '';
  }
  if (typeof schema.type === 'string') {
    return schema.type;
  }
  if (schema.properties) {
    return 'object';
  }
  if (schema.items) {
    return 'array';
  }
  return '';
}

function isPrimitiveSchemaType(type: string): boolean {
  return type === 'string' || type === 'number' || type === 'integer' || type === 'boolean';
}

function schemaFormat(schema: JsonSchemaNode | undefined): string {
  if (!schema) {
    return '';
  }
  const raw = (schema as Record<string, unknown>).format;
  return typeof raw === 'string' ? raw : '';
}

function hasSchemaComposition(schema: JsonSchemaNode): boolean {
  return Boolean(
    (Array.isArray(schema.oneOf) && schema.oneOf.length > 0)
    || (Array.isArray(schema.anyOf) && schema.anyOf.length > 0)
    || (Array.isArray(schema.allOf) && schema.allOf.length > 0)
  );
}

function isUnsupportedSchema(schema: JsonSchemaNode | undefined): boolean {
  if (!schema) {
    return true;
  }
  if (hasSchemaComposition(schema)) {
    return true;
  }
  if (
    schema.additionalProperties !== undefined
    && schema.additionalProperties !== false
  ) {
    return true;
  }

  const type = schemaType(schema);
  if (type === 'object') {
    return schema.properties === undefined;
  }
  if (type === 'array') {
    return schema.items === undefined;
  }
  return !['string', 'number', 'integer', 'boolean'].includes(type);
}

function unsupportedReason(schema: JsonSchemaNode | undefined): string {
  if (!schema) {
    return 'No schema available for this field.';
  }
  if (hasSchemaComposition(schema)) {
    return 'Schema uses oneOf/anyOf/allOf composition.';
  }
  if (
    schema.additionalProperties !== undefined
    && schema.additionalProperties !== false
  ) {
    return 'Schema uses dynamic object keys (additionalProperties).';
  }
  const type = schemaType(schema);
  if (type === 'object' && !schema.properties) {
    return 'Object field has no explicit properties.';
  }
  if (type === 'array' && !schema.items) {
    return 'Array field has no item schema.';
  }
  return `Unsupported schema type "${type || 'unknown'}".`;
}

function cloneSerializable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function defaultObjectValue(schema: JsonSchemaNode): Record<string, unknown> {
  const required = new Set(schema.required ?? []);
  const value: Record<string, unknown> = {};
  const properties = schema.properties ?? {};
  for (const [key, propSchema] of Object.entries(properties)) {
    if (isUnsupportedSchema(propSchema)) {
      continue;
    }
    if (required.has(key) || Object.prototype.hasOwnProperty.call(propSchema, 'default')) {
      value[key] = defaultFromSchema(propSchema);
    }
  }
  return value;
}

function defaultPrimitiveValue(type: string): unknown {
  if (type === 'array') {
    return [];
  }
  if (type === 'boolean') {
    return false;
  }
  if (type === 'number' || type === 'integer') {
    return 0;
  }
  if (type === 'string') {
    return '';
  }
  return null;
}

export function defaultFromSchema(schema: JsonSchemaNode | undefined): unknown {
  if (!schema) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
    return cloneSerializable(schema.default);
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return cloneSerializable(schema.enum[0]);
  }
  const type = schemaType(schema);
  if (type === 'object') {
    return defaultObjectValue(schema);
  }
  return defaultPrimitiveValue(type);
}

function pathToLabel(path: PathSegment[]): string {
  if (path.length === 0) {
    return '(root)';
  }
  return path
    .map(segment => (typeof segment === 'number' ? `[${segment}]` : segment))
    .join('.');
}

function pathToSuggestionKey(path: PathSegment[]): string {
  return path
    .map(segment => (typeof segment === 'number' ? '[]' : segment))
    .join('.');
}

export function formatFieldLabel(raw: string): string {
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatKindTitle(kind: string): string {
  return kind.endsWith('s') ? kind : `${kind}s`;
}

export function hasValueAtPath(root: unknown, path: PathSegment[]): boolean {
  return getValueAtPath(root, path) !== undefined;
}

function isRequiredValueMissing(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

function getValueAtPath(root: unknown, path: PathSegment[]): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(cursor)) {
        return undefined;
      }
      cursor = cursor[segment];
      continue;
    }
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function isMutableContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return isRecord(value) || Array.isArray(value);
}

function ensurePathContainer(cursor: unknown, segment: PathSegment, nextSegment: PathSegment): unknown | undefined {
  if (typeof segment === 'number') {
    if (!Array.isArray(cursor)) {
      return undefined;
    }
    if (!isMutableContainer(cursor[segment])) {
      cursor[segment] = typeof nextSegment === 'number' ? [] : {};
    }
    return cursor[segment];
  }

  if (!isRecord(cursor)) {
    return undefined;
  }

  if (!isMutableContainer(cursor[segment])) {
    cursor[segment] = typeof nextSegment === 'number' ? [] : {};
  }
  return cursor[segment];
}

function applyLeafValue(cursor: unknown, leaf: PathSegment, value: unknown): boolean {
  if (typeof leaf === 'number') {
    if (!Array.isArray(cursor)) {
      return false;
    }
    cursor[leaf] = value;
    return true;
  }

  if (!isRecord(cursor)) {
    return false;
  }

  if (value === undefined) {
    delete cursor[leaf];
  } else {
    cursor[leaf] = value;
  }
  return true;
}

export function setValueAtPath(
  resource: Record<string, unknown>,
  path: PathSegment[],
  value: unknown
): Record<string, unknown> {
  const clone = cloneResource(resource);
  if (path.length === 0) {
    return isRecord(value) ? cloneResource(value) : clone;
  }

  let cursor: unknown = clone;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];
    const nextCursor = ensurePathContainer(cursor, segment, nextSegment);
    if (nextCursor === undefined) {
      return clone;
    }
    cursor = nextCursor;
  }

  const leaf = path[path.length - 1];
  if (!applyLeafValue(cursor, leaf, value)) {
    return clone;
  }
  return clone;
}

function removeArrayItemAtPath(
  resource: Record<string, unknown>,
  path: PathSegment[],
  index: number
): Record<string, unknown> {
  const clone = cloneResource(resource);
  const value = getValueAtPath(clone, path);
  if (!Array.isArray(value)) {
    return clone;
  }
  value.splice(index, 1);
  return clone;
}

function addArrayItemAtPath(
  resource: Record<string, unknown>,
  path: PathSegment[],
  item: unknown
): Record<string, unknown> {
  const clone = cloneResource(resource);
  const value = getValueAtPath(clone, path);
  if (Array.isArray(value)) {
    value.push(item);
    return clone;
  }
  return setValueAtPath(clone, path, [item]);
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  const output: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue === 'string') {
      output[key] = entryValue;
    } else if (entryValue !== undefined && entryValue !== null) {
      output[key] = String(entryValue);
    }
  }
  return output;
}

interface UnsupportedFieldNoticeProps {
  path: PathSegment[];
  schema: JsonSchemaNode | undefined;
}

function UnsupportedFieldNotice({ path, schema }: Readonly<UnsupportedFieldNoticeProps>) {
  return (
    <Alert severity="info" icon={<InfoOutlinedIcon fontSize="inherit" />} sx={{ mt: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {pathToLabel(path)} is YAML-only.
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {unsupportedReason(schema)}
      </Typography>
    </Alert>
  );
}

interface FieldTitleProps {
  label: string;
  description?: string;
  required?: boolean;
  requiredMissing?: boolean;
}

export function FieldTitle({ label, description, required, requiredMissing }: Readonly<FieldTitleProps>) {
  const missing = Boolean(required && requiredMissing);
  return (
    <Stack spacing={0.25} sx={{ mb: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, letterSpacing: 0.15 }}>
        {label}
        {' '}
        <Typography
          component="span"
          variant="caption"
          color={missing ? 'error.main' : 'text.secondary'}
          sx={{ fontWeight: missing ? 700 : 500 }}
        >
          {required ? '(Required)' : '(Optional)'}
        </Typography>
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
          {description}
        </Typography>
      )}
    </Stack>
  );
}

interface OptionalFieldToggleProps {
  label: string;
  description?: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: ReactNode;
}

export function OptionalFieldToggle({
  label,
  description,
  enabled,
  onToggle,
  children
}: Readonly<OptionalFieldToggleProps>) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1 }}>
        <Stack spacing={0.25}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, letterSpacing: 0.15 }}>
            {label}
            {' '}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
              (Optional)
            </Typography>
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.35 }}>
              {description}
            </Typography>
          )}
        </Stack>
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Switch size="small" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
          <ExpandMoreIcon
            fontSize="small"
            color="action"
            sx={{ transform: enabled ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 160ms ease' }}
          />
        </Stack>
      </Stack>
      <Collapse in={enabled}>
        <Box sx={{ borderTop: 1, borderColor: 'divider', px: 1.5, py: 1.25 }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}

interface KeyValueEditorProps {
  label: string;
  description?: string;
  resource: Record<string, unknown>;
  path: PathSegment[];
  onResourceChange: (next: Record<string, unknown>) => void;
}

export function KeyValueEditor({
  label,
  description,
  resource,
  path,
  onResourceChange
}: Readonly<KeyValueEditorProps>) {
  const map = normalizeStringMap(getValueAtPath(resource, path));
  const entries = Object.entries(map) as Array<[string, string]>;

  const setEntries = useCallback((nextEntries: Array<[string, string]>) => {
    const nextMap: Record<string, string> = {};
    for (const [key, value] of nextEntries) {
      const trimmedKey = key.trim();
      if (trimmedKey.length > 0) {
        nextMap[trimmedKey] = value;
      }
    }
    const nextResource = setValueAtPath(
      resource,
      path,
      Object.keys(nextMap).length > 0 ? nextMap : undefined
    );
    onResourceChange(nextResource);
  }, [onResourceChange, path, resource]);

  const updateEntry = useCallback((index: number, key: string, value: string) => {
    const mutable: Array<[string, string]> = [...entries];
    if (index < 0 || index >= mutable.length) {
      return;
    }
    mutable[index] = [key, value];
    setEntries(mutable);
  }, [entries, setEntries]);

  const addEntry = useCallback(() => {
    const mutable: Array<[string, string]> = [...entries, [`key-${entries.length + 1}`, '']];
    setEntries(mutable);
  }, [entries, setEntries]);

  const removeEntry = useCallback((index: number) => {
    const mutable: Array<[string, string]> = [...entries];
    if (index < 0 || index >= mutable.length) {
      return;
    }
    mutable.splice(index, 1);
    setEntries(mutable);
  }, [entries, setEntries]);

  return (
    <Stack spacing={1}>
      <FieldTitle label={label} description={description} />
      <Stack spacing={1}>
        {entries.map(([key, value], index) => (
          <Stack key={`${key}-${index}`} direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              placeholder="Key"
              value={key}
              onChange={(event) => updateEntry(index, event.target.value, value)}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              placeholder="Value"
              value={value}
              onChange={(event) => updateEntry(index, key, event.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              aria-label={`Delete ${label} entry`}
              size="small"
              color="error"
              onClick={() => removeEntry(index)}
            >
              <DeleteOutlineIcon fontSize="small" />
            </Button>
          </Stack>
        ))}
        <Box>
          <Button
            variant="text"
            size="small"
            startIcon={<AddIcon fontSize="small" />}
            onClick={addEntry}
          >
            Add Entry
          </Button>
        </Box>
      </Stack>
    </Stack>
  );
}

interface SuggestiveTextFieldProps {
  value: string;
  onChange: (nextValue: string) => void;
  options?: string[];
  placeholder?: string;
  error?: boolean;
  helperText?: ReactNode;
}

export function SuggestiveTextField({
  value,
  onChange,
  options,
  placeholder,
  error,
  helperText
}: Readonly<SuggestiveTextFieldProps>) {
  const normalizedOptions = useMemo(() => {
    const bucket = new Set<string>();
    for (const candidate of options ?? []) {
      const normalized = String(candidate ?? '').trim();
      if (normalized.length > 0) {
        bucket.add(normalized);
      }
    }
    const current = value.trim();
    if (current.length > 0) {
      bucket.add(current);
    }
    return Array.from(bucket).sort((left, right) => left.localeCompare(right));
  }, [options, value]);

  return (
    <Autocomplete
      freeSolo
      openOnFocus
      autoHighlight
      options={normalizedOptions}
      value={value}
      inputValue={value}
      onChange={(_event, nextValue) => {
        const nextString = typeof nextValue === 'string'
          ? nextValue
          : String(nextValue ?? '');
        onChange(nextString);
      }}
      onInputChange={(_event, nextInputValue, reason) => {
        if (reason === 'input' || reason === 'clear') {
          onChange(nextInputValue);
        }
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          fullWidth
          placeholder={placeholder}
          error={error}
          helperText={helperText}
        />
      )}
    />
  );
}

interface PrimitiveFieldProps {
  label: string;
  path: PathSegment[];
  schema: JsonSchemaNode;
  required: boolean;
  value: unknown;
  suggestions?: string[];
  compact?: boolean;
  onChange: (next: unknown) => void;
}

function mergeTextOptions(suggestions: string[] | undefined, enumValues: unknown[]): string[] {
  const bucket = new Set<string>();
  for (const option of suggestions ?? []) {
    const normalized = String(option ?? '').trim();
    if (normalized.length > 0) {
      bucket.add(normalized);
    }
  }
  for (const option of enumValues) {
    const normalized = String(option).trim();
    if (normalized.length > 0) {
      bucket.add(normalized);
    }
  }
  return Array.from(bucket).sort((left, right) => left.localeCompare(right));
}

function parseNumberFieldValue(raw: string, type: 'number' | 'integer'): number | undefined {
  if (raw.trim().length === 0) {
    return undefined;
  }
  const parsed = type === 'integer'
    ? Number.parseInt(raw, 10)
    : Number.parseFloat(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

interface PrimitiveNumberInputProps {
  type: 'number' | 'integer';
  value: unknown;
  onChange: (next: unknown) => void;
}

function PrimitiveNumberInput({ type, value, onChange }: Readonly<PrimitiveNumberInputProps>) {
  const numericValue = typeof value === 'number' ? String(value) : '';
  return (
    <TextField
      size="small"
      fullWidth
      type="number"
      value={numericValue}
      onChange={(event) => {
        const parsed = parseNumberFieldValue(event.target.value, type);
        onChange(parsed);
      }}
      inputProps={type === 'integer' ? { step: 1 } : { step: 'any' }}
    />
  );
}

interface PrimitiveBooleanFieldProps {
  compact?: boolean;
  label: string;
  schemaDescription?: string;
  required: boolean;
  requiredMissing: boolean;
  value: unknown;
  onChange: (next: unknown) => void;
}

function PrimitiveBooleanField({
  compact,
  label,
  schemaDescription,
  required,
  requiredMissing,
  value,
  onChange
}: Readonly<PrimitiveBooleanFieldProps>) {
  const enabled = Boolean(value);
  if (compact) {
    return <Switch size="small" checked={enabled} onChange={(event) => onChange(event.target.checked)} />;
  }
  return (
    <Stack spacing={0.75}>
      <FieldTitle
        label={label}
        description={schemaDescription}
        required={required}
        requiredMissing={requiredMissing}
      />
      <FormControlLabel
        control={<Switch checked={enabled} onChange={(event) => onChange(event.target.checked)} />}
        label={enabled ? 'Enabled' : 'Disabled'}
      />
    </Stack>
  );
}

interface PrimitiveNumberFieldProps {
  compact?: boolean;
  label: string;
  schemaDescription?: string;
  required: boolean;
  requiredMissing: boolean;
  type: 'number' | 'integer';
  value: unknown;
  onChange: (next: unknown) => void;
}

function PrimitiveNumberField({
  compact,
  label,
  schemaDescription,
  required,
  requiredMissing,
  type,
  value,
  onChange
}: Readonly<PrimitiveNumberFieldProps>) {
  if (compact) {
    return <PrimitiveNumberInput type={type} value={value} onChange={onChange} />;
  }
  return (
    <Stack spacing={0.75}>
      <FieldTitle
        label={label}
        description={schemaDescription}
        required={required}
        requiredMissing={requiredMissing}
      />
      <PrimitiveNumberInput type={type} value={value} onChange={onChange} />
    </Stack>
  );
}

interface PrimitiveStringFieldProps {
  compact?: boolean;
  label: string;
  schemaDescription?: string;
  required: boolean;
  requiredMissing: boolean;
  path: PathSegment[];
  value: unknown;
  options: string[];
  onChange: (next: unknown) => void;
}

function PrimitiveStringField({
  compact,
  label,
  schemaDescription,
  required,
  requiredMissing,
  path,
  value,
  options,
  onChange
}: Readonly<PrimitiveStringFieldProps>) {
  const stringValue = value === undefined || value === null ? '' : String(value);
  const missing = required && stringValue.trim().length === 0;
  if (compact) {
    return (
      <SuggestiveTextField
        value={stringValue}
        onChange={(nextValue) => onChange(nextValue)}
        options={options}
      />
    );
  }
  return (
    <Stack spacing={0.75}>
      <FieldTitle
        label={label}
        description={schemaDescription}
        required={required}
        requiredMissing={requiredMissing}
      />
      <SuggestiveTextField
        value={stringValue}
        onChange={(nextValue) => onChange(nextValue)}
        options={options}
        helperText={missing ? `${pathToLabel(path)} is required` : undefined}
        error={missing}
      />
    </Stack>
  );
}

function PrimitiveField({
  label,
  path,
  schema,
  required,
  value,
  suggestions,
  compact,
  onChange
}: Readonly<PrimitiveFieldProps>) {
  const type = schemaType(schema);
  const requiredMissing = required && isRequiredValueMissing(value);
  const enumValues = Array.isArray(schema.enum) ? schema.enum : [];

  if (type === 'boolean') {
    return (
      <PrimitiveBooleanField
        compact={compact}
        label={label}
        schemaDescription={schema.description}
        required={required}
        requiredMissing={requiredMissing}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (type === 'number' || type === 'integer') {
    return (
      <PrimitiveNumberField
        compact={compact}
        label={label}
        schemaDescription={schema.description}
        required={required}
        requiredMissing={requiredMissing}
        type={type}
        value={value}
        onChange={onChange}
      />
    );
  }

  const textOptions = mergeTextOptions(suggestions, enumValues);
  return (
    <PrimitiveStringField
      compact={compact}
      label={label}
      schemaDescription={schema.description}
      required={required}
      requiredMissing={requiredMissing}
      path={path}
      value={value}
      options={textOptions}
      onChange={onChange}
    />
  );
}

interface SchemaFieldRendererProps {
  resource: Record<string, unknown>;
  schema: JsonSchemaNode | undefined;
  path: PathSegment[];
  label: string;
  required: boolean;
  depth: number;
  suggestions?: Record<string, string[]>;
  onResourceChange: (next: Record<string, unknown>) => void;
}

function sortSchemaPropertyKeys(
  properties: Record<string, JsonSchemaNode | undefined>,
  requiredSet: Set<string>
): string[] {
  return Object.keys(properties).sort((left, right) => {
    const leftPriority = requiredSet.has(left) ? 0 : 1;
    const rightPriority = requiredSet.has(right) ? 0 : 1;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.localeCompare(right);
  });
}

interface ObjectSchemaFieldRendererProps extends SchemaFieldRendererProps {
  schema: JsonSchemaNode;
  currentValue: unknown;
}

function ObjectSchemaFieldRenderer({
  resource,
  schema,
  path,
  label,
  required,
  depth,
  suggestions,
  onResourceChange,
  currentValue
}: Readonly<ObjectSchemaFieldRendererProps>) {
  const properties = schema.properties ?? {};
  const requiredSet = new Set(schema.required ?? []);
  const keys = sortSchemaPropertyKeys(properties, requiredSet);
  const requiredKeys = keys.filter(key => requiredSet.has(key));
  const optionalKeys = keys.filter(key => !requiredSet.has(key));

  const objectValue = isRecord(currentValue) ? currentValue : {};
  const nextResource = objectValue === currentValue
    ? resource
    : setValueAtPath(resource, path, objectValue);

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <FieldTitle label={label} description={schema.description} required={required} />
      <Stack spacing={1.25}>
        {requiredKeys.map(key => (
          <SchemaFieldRenderer
            key={`${pathToLabel(path)}.${key}`}
            resource={nextResource}
            schema={properties[key]}
            path={[...path, key]}
            label={key}
            required
            depth={depth + 1}
            suggestions={suggestions}
            onResourceChange={onResourceChange}
          />
        ))}
        {optionalKeys.map(key => {
          const fieldPath = [...path, key];
          const enabled = hasValueAtPath(nextResource, fieldPath);
          const propertySchema = properties[key];
          return (
            <OptionalFieldToggle
              key={`${pathToLabel(path)}.${key}.optional`}
              label={key}
              description={propertySchema?.description}
              enabled={enabled}
              onToggle={(nextEnabled) => {
                const nextValue = nextEnabled ? defaultFromSchema(propertySchema) : undefined;
                onResourceChange(setValueAtPath(nextResource, fieldPath, nextValue));
              }}
            >
              <SchemaFieldRenderer
                resource={nextResource}
                schema={propertySchema}
                path={fieldPath}
                label={key}
                required={false}
                depth={depth + 1}
                suggestions={suggestions}
                onResourceChange={onResourceChange}
              />
            </OptionalFieldToggle>
          );
        })}
        {keys.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No form fields are available for this object.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

interface PrimitiveArrayFieldRendererProps extends SchemaFieldRendererProps {
  schema: JsonSchemaNode;
  itemsSchema: JsonSchemaNode;
  path: PathSegment[];
  label: string;
  required: boolean;
  arrayValue: unknown[];
  workingResource: Record<string, unknown>;
}

function PrimitiveArrayFieldRenderer({
  schema,
  itemsSchema,
  path,
  label,
  required,
  suggestions,
  onResourceChange,
  arrayValue,
  workingResource
}: Readonly<PrimitiveArrayFieldRendererProps>) {
  const addLabel = schemaFormat(schema) === 'labelselector' ? 'Add a Label Selector' : 'Add Item';
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <FieldTitle label={label} description={schema.description} required={required} />
      <Stack spacing={0.75}>
        {arrayValue.map((_entry, index) => (
          <Stack key={`${pathToLabel(path)}[${index}]`} direction="row" spacing={0.75} alignItems="center">
            <IconButton
              size="small"
              color="error"
              aria-label={`Remove ${label} item ${index + 1}`}
              onClick={() => onResourceChange(removeArrayItemAtPath(workingResource, path, index))}
              sx={{ p: 0.25 }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <PrimitiveField
                label={`${label}[${index}]`}
                path={[...path, index]}
                schema={itemsSchema}
                required={false}
                value={arrayValue[index]}
                suggestions={suggestions?.[pathToSuggestionKey([...path, index])]}
                compact
                onChange={(nextValue) => onResourceChange(
                  setValueAtPath(workingResource, [...path, index], nextValue)
                )}
              />
            </Box>
          </Stack>
        ))}
        <Box>
          <Button
            variant="text"
            size="small"
            startIcon={<AddIcon fontSize="small" />}
            onClick={() => onResourceChange(
              addArrayItemAtPath(
                workingResource,
                path,
                defaultFromSchema(itemsSchema)
              )
            )}
          >
            {addLabel}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}

interface ComplexArrayFieldRendererProps extends SchemaFieldRendererProps {
  schema: JsonSchemaNode;
  itemsSchema: JsonSchemaNode;
  path: PathSegment[];
  label: string;
  required: boolean;
  depth: number;
  arrayValue: unknown[];
  workingResource: Record<string, unknown>;
}

function ComplexArrayFieldRenderer({
  schema,
  itemsSchema,
  path,
  label,
  required,
  depth,
  suggestions,
  onResourceChange,
  arrayValue,
  workingResource
}: Readonly<ComplexArrayFieldRendererProps>) {
  const addLabel = schemaFormat(schema) === 'labelselector' ? 'Add a Label Selector' : 'Add Item';
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <FieldTitle label={label} description={schema.description} required={required} />
      <Stack spacing={1.25}>
        {arrayValue.map((entry, index) => (
          <Card key={`${pathToLabel(path)}[${index}]`} variant="outlined" sx={{ borderStyle: 'dashed' }}>
            <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Item {index + 1}
                </Typography>
                <Button
                  color="error"
                  size="small"
                  startIcon={<DeleteOutlineIcon fontSize="small" />}
                  onClick={() => onResourceChange(removeArrayItemAtPath(workingResource, path, index))}
                >
                  Remove
                </Button>
              </Stack>
              <SchemaFieldRenderer
                resource={workingResource}
                schema={itemsSchema}
                path={[...path, index]}
                label={`${label}[${index}]`}
                required={false}
                depth={depth + 1}
                suggestions={suggestions}
                onResourceChange={onResourceChange}
              />
              {entry === undefined && (
                <Typography variant="caption" color="text.secondary">
                  Empty item
                </Typography>
              )}
            </CardContent>
          </Card>
        ))}
        <Box>
          <Button
            variant="text"
            size="small"
            startIcon={<AddIcon fontSize="small" />}
            onClick={() => onResourceChange(
              addArrayItemAtPath(
                workingResource,
                path,
                defaultFromSchema(itemsSchema)
              )
            )}
          >
            {addLabel}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}

interface ArraySchemaFieldRendererProps extends SchemaFieldRendererProps {
  schema: JsonSchemaNode;
  currentValue: unknown;
}

function ArraySchemaFieldRenderer({
  resource,
  schema,
  path,
  label,
  required,
  depth,
  suggestions,
  onResourceChange,
  currentValue
}: Readonly<ArraySchemaFieldRendererProps>) {
  const itemsSchema = schema.items;
  if (!itemsSchema) {
    return <UnsupportedFieldNotice path={path} schema={schema} />;
  }

  const arrayValue = Array.isArray(currentValue) ? currentValue : [];
  const workingResource = Array.isArray(currentValue)
    ? resource
    : setValueAtPath(resource, path, arrayValue);

  if (isPrimitiveSchemaType(schemaType(itemsSchema))) {
    return (
      <PrimitiveArrayFieldRenderer
        resource={resource}
        schema={schema}
        itemsSchema={itemsSchema}
        path={path}
        label={label}
        required={required}
        depth={depth}
        suggestions={suggestions}
        onResourceChange={onResourceChange}
        arrayValue={arrayValue}
        workingResource={workingResource}
      />
    );
  }

  return (
    <ComplexArrayFieldRenderer
      resource={resource}
      schema={schema}
      itemsSchema={itemsSchema}
      path={path}
      label={label}
      required={required}
      depth={depth}
      suggestions={suggestions}
      onResourceChange={onResourceChange}
      arrayValue={arrayValue}
      workingResource={workingResource}
    />
  );
}

export function SchemaFieldRenderer({
  resource,
  schema,
  path,
  label,
  required,
  depth,
  suggestions,
  onResourceChange
}: Readonly<SchemaFieldRendererProps>) {
  if (depth > MAX_RENDER_DEPTH) {
    return <UnsupportedFieldNotice path={path} schema={schema} />;
  }
  if (isUnsupportedSchema(schema)) {
    return <UnsupportedFieldNotice path={path} schema={schema} />;
  }
  if (!schema) {
    return null;
  }

  const type = schemaType(schema);
  const currentValue = getValueAtPath(resource, path);

  if (type === 'object') {
    return (
      <ObjectSchemaFieldRenderer
        resource={resource}
        schema={schema}
        path={path}
        label={label}
        required={required}
        depth={depth}
        suggestions={suggestions}
        onResourceChange={onResourceChange}
        currentValue={currentValue}
      />
    );
  }

  if (type === 'array') {
    return (
      <ArraySchemaFieldRenderer
        resource={resource}
        schema={schema}
        path={path}
        label={label}
        required={required}
        depth={depth}
        suggestions={suggestions}
        onResourceChange={onResourceChange}
        currentValue={currentValue}
      />
    );
  }

  return (
    <PrimitiveField
      label={label}
      path={path}
      schema={schema}
      required={required}
      value={currentValue}
      suggestions={suggestions?.[pathToSuggestionKey(path)]}
      onChange={(nextValue) => onResourceChange(setValueAtPath(resource, path, nextValue))}
    />
  );
}
