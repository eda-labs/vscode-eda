import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import AddIcon from '@mui/icons-material/Add';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ShoppingBasketOutlinedIcon from '@mui/icons-material/ShoppingBasketOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';

import type { EdaCrd } from '../../types';
import { useMessageListener, usePostMessage, useReadySignal } from '../shared/hooks';
import { mountWebview } from '../shared/utils';

import type {
  JsonSchemaNode,
  ResourceCreatePanelToWebviewMessage,
  ResourceCreateWebviewMessage
} from './types';

type PathSegment = string | number;

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

function defaultFromSchema(schema: JsonSchemaNode | undefined): unknown {
  if (!schema) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
    return JSON.parse(JSON.stringify(schema.default)) as unknown;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return JSON.parse(JSON.stringify(schema.enum[0])) as unknown;
  }
  const type = schemaType(schema);
  if (type === 'object') {
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

function pathToLabel(path: PathSegment[]): string {
  if (path.length === 0) {
    return '(root)';
  }
  return path
    .map(segment => (typeof segment === 'number' ? `[${segment}]` : segment))
    .join('.');
}

function formatFieldLabel(raw: string): string {
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatKindTitle(kind: string): string {
  return kind.endsWith('s') ? kind : `${kind}s`;
}

function hasValueAtPath(root: unknown, path: PathSegment[]): boolean {
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

function setValueAtPath(
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
    if (typeof segment === 'number') {
      if (!Array.isArray(cursor)) {
        return clone;
      }
      const arr = cursor;
      if (!isRecord(arr[segment]) && !Array.isArray(arr[segment])) {
        arr[segment] = typeof nextSegment === 'number' ? [] : {};
      }
      cursor = arr[segment];
      continue;
    }

    if (!isRecord(cursor)) {
      return clone;
    }
    const nextValue = cursor[segment];
    if (!isRecord(nextValue) && !Array.isArray(nextValue)) {
      cursor[segment] = typeof nextSegment === 'number' ? [] : {};
    }
    cursor = cursor[segment];
  }

  const leaf = path[path.length - 1];
  if (typeof leaf === 'number') {
    if (!Array.isArray(cursor)) {
      return clone;
    }
    cursor[leaf] = value;
    return clone;
  }

  if (!isRecord(cursor)) {
    return clone;
  }
  if (value === undefined) {
    delete cursor[leaf];
  } else {
    cursor[leaf] = value;
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

function FieldTitle({ label, description, required, requiredMissing }: Readonly<FieldTitleProps>) {
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

function OptionalFieldToggle({
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

function KeyValueEditor({
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

interface PrimitiveFieldProps {
  label: string;
  path: PathSegment[];
  schema: JsonSchemaNode;
  required: boolean;
  value: unknown;
  onChange: (next: unknown) => void;
}

function PrimitiveField({
  label,
  path,
  schema,
  required,
  value,
  onChange
}: Readonly<PrimitiveFieldProps>) {
  const type = schemaType(schema);
  const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
  const enabled = Boolean(value);
  const requiredMissing = required && isRequiredValueMissing(value);

  if (enumValues.length > 0) {
    const selected = value === undefined || value === null ? '' : String(value);
    return (
      <Stack spacing={0.75}>
        <FieldTitle
          label={label}
          description={schema.description}
          required={required}
          requiredMissing={requiredMissing}
        />
        <TextField
          select
          size="small"
          fullWidth
          value={selected}
          onChange={(event) => onChange(event.target.value)}
        >
          {enumValues.map(item => (
            <MenuItem key={String(item)} value={String(item)}>
              {String(item)}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    );
  }

  if (type === 'boolean') {
    return (
      <Stack spacing={0.75}>
        <FieldTitle
          label={label}
          description={schema.description}
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

  if (type === 'number' || type === 'integer') {
    const numericValue = typeof value === 'number' ? String(value) : '';
    return (
      <Stack spacing={0.75}>
        <FieldTitle
          label={label}
          description={schema.description}
          required={required}
          requiredMissing={requiredMissing}
        />
        <TextField
          size="small"
          fullWidth
          type="number"
          value={numericValue}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw.trim().length === 0) {
              onChange(undefined);
              return;
            }
            const parsed = type === 'integer'
              ? Number.parseInt(raw, 10)
              : Number.parseFloat(raw);
            if (!Number.isNaN(parsed)) {
              onChange(parsed);
            }
          }}
          inputProps={type === 'integer' ? { step: 1 } : { step: 'any' }}
        />
      </Stack>
    );
  }

  const stringValue = value === undefined || value === null ? '' : String(value);
  return (
    <Stack spacing={0.75}>
      <FieldTitle
        label={label}
        description={schema.description}
        required={required}
        requiredMissing={requiredMissing}
      />
      <TextField
        size="small"
        fullWidth
        value={stringValue}
        onChange={(event) => onChange(event.target.value)}
        helperText={required && stringValue.trim().length === 0 ? `${pathToLabel(path)} is required` : undefined}
        error={required && stringValue.trim().length === 0}
      />
    </Stack>
  );
}

interface SchemaFieldRendererProps {
  resource: Record<string, unknown>;
  schema: JsonSchemaNode | undefined;
  path: PathSegment[];
  label: string;
  required: boolean;
  depth: number;
  onResourceChange: (next: Record<string, unknown>) => void;
}

function SchemaFieldRenderer({
  resource,
  schema,
  path,
  label,
  required,
  depth,
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
    const properties = schema.properties ?? {};
    const requiredSet = new Set(schema.required ?? []);
    const keys = Object.keys(properties).sort((left, right) => {
      const leftPriority = requiredSet.has(left) ? 0 : 1;
      const rightPriority = requiredSet.has(right) ? 0 : 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.localeCompare(right);
    });
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

  if (type === 'array') {
    const itemsSchema = schema.items;
    if (!itemsSchema) {
      return <UnsupportedFieldNotice path={path} schema={schema} />;
    }
    const arrayValue = Array.isArray(currentValue) ? currentValue : [];
    const workingResource = Array.isArray(currentValue)
      ? resource
      : setValueAtPath(resource, path, arrayValue);

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
              Add Item
            </Button>
          </Box>
        </Stack>
      </Box>
    );
  }

  return (
    <PrimitiveField
      label={label}
      path={path}
      schema={schema}
      required={required}
      value={currentValue}
      onChange={(nextValue) => onResourceChange(setValueAtPath(resource, path, nextValue))}
    />
  );
}

interface OutlineEntry {
  id: string;
  section: 'Metadata' | 'Specification';
  label: string;
}

function ResourceCreatePanelView() {
  const theme = useTheme();
  const postMessage = usePostMessage<ResourceCreateWebviewMessage>();
  const [crd, setCrd] = useState<EdaCrd | null>(null);
  const [schema, setSchema] = useState<JsonSchemaNode | null>(null);
  const [resource, setResource] = useState<Record<string, unknown> | null>(null);
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [outlineFilter, setOutlineFilter] = useState('');
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const suppressPostRef = useRef(false);
  const initializedRef = useRef(false);

  useReadySignal();

  const setResourceFromHost = useCallback((nextResource: Record<string, unknown>) => {
    suppressPostRef.current = true;
    setResource(nextResource);
  }, []);

  useMessageListener<ResourceCreatePanelToWebviewMessage>(useCallback((message) => {
    if (message.command === 'init') {
      setCrd(message.crd);
      setSchema(message.schema);
      setYamlError(null);
      setResourceFromHost(message.resource);
      initializedRef.current = true;
      return;
    }
    if (message.command === 'yamlModel') {
      setYamlError(null);
      setResourceFromHost(message.resource);
      return;
    }
    if (message.command === 'yamlError') {
      setYamlError(message.error);
    }
  }, [setResourceFromHost]));

  useEffect(() => {
    if (!initializedRef.current || !resource) {
      return;
    }
    if (yamlError) {
      return;
    }
    if (suppressPostRef.current) {
      suppressPostRef.current = false;
      return;
    }
    postMessage({
      command: 'formUpdate',
      resource
    });
  }, [postMessage, resource, yamlError]);

  const metadata = useMemo(() => {
    if (!resource) {
      return {};
    }
    const currentMetadata = resource.metadata;
    return isRecord(currentMetadata) ? currentMetadata : {};
  }, [resource]);

  const nameValue = typeof metadata.name === 'string' ? metadata.name : '';
  const namespaceValue = typeof metadata.namespace === 'string' ? metadata.namespace : '';
  const labelsEnabled = hasValueAtPath(resource, ['metadata', 'labels']);
  const annotationsEnabled = hasValueAtPath(resource, ['metadata', 'annotations']);
  const isNamespaced = crd?.namespaced ?? false;

  const specSchema = schema?.properties?.spec;
  const {
    specProperties,
    specKeys,
    requiredSpecKeys,
    optionalSpecKeys
  } = useMemo(() => {
    const nextSpecProperties = specSchema?.properties ?? {};
    const nextSpecRequiredSet = new Set(specSchema?.required ?? []);
    const nextSpecKeys = Object.keys(nextSpecProperties).sort((left, right) => {
      const leftPriority = nextSpecRequiredSet.has(left) ? 0 : 1;
      const rightPriority = nextSpecRequiredSet.has(right) ? 0 : 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return left.localeCompare(right);
    });
    return {
      specProperties: nextSpecProperties,
      specKeys: nextSpecKeys,
      requiredSpecKeys: nextSpecKeys.filter(key => nextSpecRequiredSet.has(key)),
      optionalSpecKeys: nextSpecKeys.filter(key => !nextSpecRequiredSet.has(key))
    };
  }, [specSchema]);

  const outlineEntries = useMemo(() => {
    const metadataEntries: OutlineEntry[] = [
      { id: 'metadata-name', section: 'Metadata', label: 'Name' },
      ...(isNamespaced ? [{ id: 'metadata-namespace', section: 'Metadata' as const, label: 'Namespace' }] : []),
      { id: 'metadata-labels', section: 'Metadata', label: 'Labels' },
      { id: 'metadata-annotations', section: 'Metadata', label: 'Annotations' }
    ];
    const specEntries: OutlineEntry[] = specKeys.map(key => ({
      id: `spec-${key}`,
      section: 'Specification',
      label: formatFieldLabel(key)
    }));
    return [...metadataEntries, ...specEntries];
  }, [isNamespaced, specKeys]);

  const filteredOutlineEntries = useMemo(() => {
    const filter = outlineFilter.trim().toLowerCase();
    if (filter.length === 0) {
      return outlineEntries;
    }
    return outlineEntries.filter(entry => entry.label.toLowerCase().includes(filter));
  }, [outlineEntries, outlineFilter]);

  const scrollToEntry = useCallback((id: string) => {
    const node = document.getElementById(id);
    node?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  const executeAction = useCallback((action: 'commit' | 'dryRun' | 'basket') => {
    postMessage({
      command: 'executeAction',
      action
    });
  }, [postMessage]);

  if (!resource || !crd) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Loading create-resource form...
        </Typography>
      </Box>
    );
  }

  const metadataOutline = filteredOutlineEntries.filter(entry => entry.section === 'Metadata');
  const specOutline = filteredOutlineEntries.filter(entry => entry.section === 'Specification');
  const surfaceBorder = alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.24 : 0.18);
  const hoverHighlight = alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1);
  const outlineWidth = isOutlineCollapsed ? 40 : 212;
  const actionsDisabled = Boolean(yamlError);

  return (
    <Box sx={{ height: '100vh', bgcolor: 'background.default' }}>
      <Stack direction="row" sx={{ height: '100%', minWidth: 0 }}>
        <Box
          sx={{
            width: outlineWidth,
            flexShrink: 0,
            borderRight: 1,
            borderColor: surfaceBorder,
            bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.38 : 0.62),
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100%',
            transition: 'width 180ms ease'
          }}
        >
          {!isOutlineCollapsed && (
            <>
              <Box sx={{ px: 2.5, py: 1.4, borderBottom: 1, borderColor: surfaceBorder }}>
                <Typography variant="h6" sx={{ fontWeight: 500, letterSpacing: 0.1 }}>
                  {formatKindTitle(crd.kind)}
                </Typography>
              </Box>
              <Box sx={{ px: 2, py: 1.2, borderBottom: 1, borderColor: surfaceBorder }}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
                  <AccountTreeOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Outline
                  </Typography>
                </Stack>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Search"
                  value={outlineFilter}
                  onChange={(event) => setOutlineFilter(event.target.value)}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      height: 32
                    }
                  }}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      )
                    }
                  }}
                />
              </Box>
              <Box sx={{ px: 1.25, py: 1, overflowY: 'auto', flex: 1 }}>
                <Stack spacing={1.5}>
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 0.75 }}>
                      <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Metadata
                      </Typography>
                    </Stack>
                    <Stack spacing={0.2} sx={{ mt: 0.4 }}>
                      {metadataOutline.map(entry => (
                        <Button
                          key={entry.id}
                          size="small"
                          color="inherit"
                          onClick={() => scrollToEntry(entry.id)}
                          sx={{
                            justifyContent: 'flex-start',
                            px: 3,
                            py: 0.35,
                            minHeight: 28,
                            textTransform: 'none',
                            color: 'text.primary',
                            borderRadius: 0.75,
                            fontWeight: 500,
                            '&:hover': {
                              bgcolor: hoverHighlight
                            }
                          }}
                        >
                          {entry.label}
                        </Button>
                      ))}
                    </Stack>
                  </Box>
                  <Box>
                    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 0.75 }}>
                      <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Specification
                      </Typography>
                    </Stack>
                    <Stack spacing={0.2} sx={{ mt: 0.4 }}>
                      {specOutline.map(entry => (
                        <Button
                          key={entry.id}
                          size="small"
                          color="inherit"
                          onClick={() => scrollToEntry(entry.id)}
                          sx={{
                            justifyContent: 'flex-start',
                            px: 3,
                            py: 0.35,
                            minHeight: 28,
                            textTransform: 'none',
                            color: 'text.primary',
                            borderRadius: 0.75,
                            fontWeight: 500,
                            '&:hover': {
                              bgcolor: hoverHighlight
                            }
                          }}
                        >
                          {entry.label}
                        </Button>
                      ))}
                      {specOutline.length === 0 && (
                        <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 0.6 }}>
                          No fields
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                </Stack>
              </Box>
            </>
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative' }}>
          <IconButton
            size="small"
            onClick={() => setIsOutlineCollapsed(current => !current)}
            sx={{
              position: 'absolute',
              left: -10,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 5,
              bgcolor: alpha(theme.palette.primary.main, 0.3),
              border: 1,
              borderColor: surfaceBorder
            }}
          >
            {isOutlineCollapsed ? <ChevronRightIcon sx={{ fontSize: 16 }} /> : <ChevronLeftIcon sx={{ fontSize: 16 }} />}
          </IconButton>
            <Box sx={{ p: { xs: 0.75, md: 1.5 }, minHeight: '100%' }}>
              <Box
                sx={{
                  bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.28 : 0.76),
                  minHeight: '100%',
                  display: 'flex',
                  flexDirection: 'column'
                }}
            >
              {yamlError && (
                <Alert
                  severity="warning"
                  icon={<WarningAmberIcon fontSize="inherit" />}
                  sx={{ borderRadius: 0, borderBottom: 1, borderColor: surfaceBorder }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    YAML is currently invalid.
                  </Typography>
                  <Typography variant="body2">
                    {yamlError}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Form values are frozen until YAML becomes valid again.
                  </Typography>
                </Alert>
              )}

                <Box sx={{
                  ...(yamlError ? { opacity: 0.7, pointerEvents: 'none' } : undefined),
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: '100%'
                }}
                >
                <Box
                  id="section-metadata"
                  sx={{ px: { xs: 1.5, md: 2.8 }, py: { xs: 1.4, md: 2 }, borderBottom: 1, borderColor: surfaceBorder }}
                >
                  <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.75 }}>
                    Metadata
                  </Typography>
                  <Stack spacing={1.5}>
                    <Box id="metadata-name">
                      <FieldTitle label="Name" required requiredMissing={nameValue.trim().length === 0} />
                      <TextField
                        size="small"
                        fullWidth
                        placeholder={`Enter ${crd.kind.toLowerCase()} name`}
                        value={nameValue}
                        onChange={(event) => setResource(setValueAtPath(resource, ['metadata', 'name'], event.target.value))}
                        error={nameValue.trim().length === 0}
                        helperText={nameValue.trim().length === 0 ? 'Name is required' : undefined}
                      />
                    </Box>
                    {isNamespaced && (
                      <Box id="metadata-namespace">
                        <FieldTitle label="Namespace" required requiredMissing={namespaceValue.trim().length === 0} />
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="eda"
                          value={namespaceValue}
                          onChange={(event) => setResource(setValueAtPath(resource, ['metadata', 'namespace'], event.target.value))}
                          error={namespaceValue.trim().length === 0}
                          helperText={namespaceValue.trim().length === 0 ? 'Namespace is required for this resource kind' : undefined}
                        />
                      </Box>
                    )}
                    <Box id="metadata-labels">
                      <OptionalFieldToggle
                        label="Labels"
                        description="Optional labels to classify the resource."
                        enabled={labelsEnabled}
                        onToggle={(enabled) => {
                          setResource(setValueAtPath(
                            resource,
                            ['metadata', 'labels'],
                            enabled ? {} : undefined
                          ));
                        }}
                      >
                        <KeyValueEditor
                          label="Labels"
                          description="Provide one or more key/value labels."
                          resource={resource}
                          path={['metadata', 'labels']}
                          onResourceChange={setResource}
                        />
                      </OptionalFieldToggle>
                    </Box>
                    <Box id="metadata-annotations">
                      <OptionalFieldToggle
                        label="Annotations"
                        description="Optional annotations for non-identifying metadata."
                        enabled={annotationsEnabled}
                        onToggle={(enabled) => {
                          setResource(setValueAtPath(
                            resource,
                            ['metadata', 'annotations'],
                            enabled ? {} : undefined
                          ));
                        }}
                      >
                        <KeyValueEditor
                          label="Annotations"
                          description="Provide one or more key/value annotations."
                          resource={resource}
                          path={['metadata', 'annotations']}
                          onResourceChange={setResource}
                        />
                      </OptionalFieldToggle>
                    </Box>
                  </Stack>
                </Box>

                <Box id="section-spec" sx={{ px: { xs: 1.5, md: 2.8 }, py: { xs: 1.5, md: 2 } }}>
                  <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.2 }}>
                    Specification
                  </Typography>
                  {specSchema?.description && (
                    <Typography variant="body1" color="text.secondary" sx={{ mb: 1.8, maxWidth: 900 }}>
                      {specSchema.description}
                    </Typography>
                  )}
                  {specSchema ? (
                    <Stack spacing={1.5}>
                      {requiredSpecKeys.map(key => (
                        <Box key={`spec-required-${key}`} id={`spec-${key}`}>
                          <SchemaFieldRenderer
                            resource={resource}
                            schema={specProperties[key]}
                            path={['spec', key]}
                            label={formatFieldLabel(key)}
                            required
                            depth={1}
                            onResourceChange={setResource}
                          />
                        </Box>
                      ))}
                      {optionalSpecKeys.map(key => {
                        const fieldPath: PathSegment[] = ['spec', key];
                        const fieldSchema = specProperties[key];
                        return (
                          <Box key={`spec-optional-${key}`} id={`spec-${key}`}>
                            <OptionalFieldToggle
                              label={formatFieldLabel(key)}
                              description={fieldSchema?.description}
                              enabled={hasValueAtPath(resource, fieldPath)}
                              onToggle={(enabled) => {
                                const nextValue = enabled ? defaultFromSchema(fieldSchema) : undefined;
                                setResource(setValueAtPath(resource, fieldPath, nextValue));
                              }}
                            >
                              <SchemaFieldRenderer
                                resource={resource}
                                schema={fieldSchema}
                                path={fieldPath}
                                label={formatFieldLabel(key)}
                                required={false}
                                depth={1}
                                onResourceChange={setResource}
                              />
                            </OptionalFieldToggle>
                          </Box>
                        );
                      })}
                      {specKeys.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                          No schema fields are available for spec.
                        </Typography>
                      )}
                    </Stack>
                  ) : (
                    <Alert severity="info" icon={<InfoOutlinedIcon fontSize="inherit" />}>
                      No schema is available for spec fields. Continue editing on the YAML side.
                    </Alert>
                  )}
                </Box>
                  <Box
                    sx={{
                      mt: 'auto',
                      px: { xs: 1.5, md: 2.8 },
                      py: 1,
                      borderTop: 1,
                      borderColor: surfaceBorder,
                      position: 'sticky',
                      bottom: 0,
                      bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.72 : 0.92),
                      display: 'flex',
                      justifyContent: 'flex-end',
                      gap: 0.5
                    }}
                  >
                  <Tooltip title="Add To Basket">
                    <span>
                      <IconButton
                        size="small"
                        color="inherit"
                        disabled={actionsDisabled}
                        onClick={() => executeAction('basket')}
                      >
                        <ShoppingBasketOutlinedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Dry Run">
                    <span>
                      <IconButton
                        size="small"
                        color="inherit"
                        disabled={actionsDisabled}
                        onClick={() => executeAction('dryRun')}
                      >
                        <FactCheckOutlinedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Commit">
                    <span>
                      <IconButton
                        size="small"
                        color="inherit"
                        disabled={actionsDisabled}
                        onClick={() => executeAction('commit')}
                      >
                        <PlayArrowOutlinedIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      </Stack>
    </Box>
  );
}

mountWebview(ResourceCreatePanelView);
