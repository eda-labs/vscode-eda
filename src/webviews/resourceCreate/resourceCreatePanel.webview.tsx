import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';

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

function hasValueAtPath(root: unknown, path: PathSegment[]): boolean {
  return getValueAtPath(root, path) !== undefined;
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
  typeLabel?: string;
}

function FieldTitle({ label, description, required, typeLabel }: Readonly<FieldTitleProps>) {
  return (
    <Stack spacing={0.25} sx={{ mb: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {label}
        </Typography>
        {required
          ? <Chip size="small" color="error" label="required" />
          : <Chip size="small" variant="outlined" label="optional" />}
        {typeLabel && <Chip size="small" variant="outlined" label={typeLabel} />}
      </Stack>
      {description && (
        <Typography variant="body2" color="text.secondary">
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
    <Card variant="outlined" sx={{ borderStyle: 'dashed' }}>
      <CardContent sx={{ p: 1.25, '&:last-child': { pb: 1.25 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: enabled ? 1 : 0 }}>
          <Stack spacing={0.25}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {label}
              </Typography>
              <Chip size="small" variant="outlined" label="optional" />
            </Stack>
            {description && (
              <Typography variant="body2" color="text.secondary">
                {description}
              </Typography>
            )}
          </Stack>
          <FormControlLabel
            sx={{ mr: 0 }}
            control={<Switch checked={enabled} onChange={(event) => onToggle(event.target.checked)} />}
            label={enabled ? 'Enabled' : 'Disabled'}
            labelPlacement="start"
          />
        </Stack>
        <Collapse in={enabled}>
          <Box sx={{ mt: 0.5 }}>
            {children}
          </Box>
        </Collapse>
      </CardContent>
    </Card>
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
    <Card variant="outlined">
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <FieldTitle label={label} description={description} typeLabel="map<string,string>" />
        <Stack spacing={1}>
          {entries.map(([key, value], index) => (
            <Stack key={`${key}-${index}`} direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                label="Key"
                value={key}
                onChange={(event) => updateEntry(index, event.target.value, value)}
                sx={{ flex: 1 }}
              />
              <TextField
                size="small"
                label="Value"
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
              variant="outlined"
              size="small"
              startIcon={<AddIcon fontSize="small" />}
              onClick={addEntry}
            >
              Add Entry
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
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

  if (enumValues.length > 0) {
    const selected = value === undefined || value === null ? '' : String(value);
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <FieldTitle label={label} description={schema.description} required={required} typeLabel="enum" />
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
        </CardContent>
      </Card>
    );
  }

  if (type === 'boolean') {
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <FieldTitle label={label} description={schema.description} required={required} typeLabel={type} />
          <FormControlLabel
            control={<Switch checked={enabled} onChange={(event) => onChange(event.target.checked)} />}
            label={enabled ? 'Enabled' : 'Disabled'}
          />
        </CardContent>
      </Card>
    );
  }

  if (type === 'number' || type === 'integer') {
    const numericValue = typeof value === 'number' ? String(value) : '';
    return (
      <Card variant="outlined">
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <FieldTitle label={label} description={schema.description} required={required} typeLabel={type} />
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
        </CardContent>
      </Card>
    );
  }

  const stringValue = value === undefined || value === null ? '' : String(value);
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <FieldTitle label={label} description={schema.description} required={required} typeLabel={type || 'string'} />
        <TextField
          size="small"
          fullWidth
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
          helperText={required && stringValue.trim().length === 0 ? `${pathToLabel(path)} is required` : undefined}
          error={required && stringValue.trim().length === 0}
        />
      </CardContent>
    </Card>
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
      <Card variant="outlined">
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <FieldTitle label={label} description={schema.description} required={required} typeLabel="object" />
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
        </CardContent>
      </Card>
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
      <Card variant="outlined">
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          <FieldTitle label={label} description={schema.description} required={required} typeLabel="array" />
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
                variant="outlined"
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
        </CardContent>
      </Card>
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

function ResourceCreatePanelView() {
  const postMessage = usePostMessage<ResourceCreateWebviewMessage>();
  const [resourceUri, setResourceUri] = useState('');
  const [crd, setCrd] = useState<EdaCrd | null>(null);
  const [schema, setSchema] = useState<JsonSchemaNode | null>(null);
  const [resource, setResource] = useState<Record<string, unknown> | null>(null);
  const [yamlError, setYamlError] = useState<string | null>(null);
  const suppressPostRef = useRef(false);
  const initializedRef = useRef(false);

  useReadySignal();

  const setResourceFromHost = useCallback((nextResource: Record<string, unknown>) => {
    suppressPostRef.current = true;
    setResource(nextResource);
  }, []);

  useMessageListener<ResourceCreatePanelToWebviewMessage>(useCallback((message) => {
    if (message.command === 'init') {
      setResourceUri(message.uri);
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

  const specSchema = schema?.properties?.spec;
  const apiVersionValue = resource && typeof resource.apiVersion === 'string' ? resource.apiVersion : '';
  const kindValue = resource && typeof resource.kind === 'string' ? resource.kind : (crd?.kind ?? '');

  if (!resource || !crd) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Loading create-resource form...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, maxWidth: 1100, mx: 'auto' }}>
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Create {crd.kind}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Fixed identity: <strong>{apiVersionValue}</strong> / <strong>{kindValue}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            YAML editor stays in sync on the right. Unsupported fields remain YAML-only.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {resourceUri}
          </Typography>
        </Stack>

        {yamlError && (
          <Alert severity="warning" icon={<WarningAmberIcon fontSize="inherit" />}>
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

        <Box sx={yamlError ? { opacity: 0.7, pointerEvents: 'none' } : undefined}>
          <Stack spacing={2}>
            <Card variant="outlined">
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Metadata
                  </Typography>
                  <Chip size="small" color="error" label="required: name" />
                  {crd.namespaced && <Chip size="small" color="error" label="required: namespace" />}
                  <Chip size="small" variant="outlined" label="optional: labels / annotations" />
                </Stack>
                <Stack spacing={1.25}>
                  <TextField
                    size="small"
                    label="metadata.name"
                    required
                    value={nameValue}
                    onChange={(event) => setResource(setValueAtPath(resource, ['metadata', 'name'], event.target.value))}
                    error={nameValue.trim().length === 0}
                    helperText={nameValue.trim().length === 0 ? 'metadata.name is required' : undefined}
                  />
                  {crd.namespaced && (
                    <TextField
                      size="small"
                      label="metadata.namespace"
                      required
                      value={namespaceValue}
                      onChange={(event) => setResource(setValueAtPath(resource, ['metadata', 'namespace'], event.target.value))}
                      error={namespaceValue.trim().length === 0}
                      helperText={namespaceValue.trim().length === 0 ? 'metadata.namespace is required for this resource kind' : undefined}
                    />
                  )}
                  <Divider />
                  <OptionalFieldToggle
                    label="metadata.labels"
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
                      label="metadata.labels"
                      description="Optional labels to classify the resource."
                      resource={resource}
                      path={['metadata', 'labels']}
                      onResourceChange={setResource}
                    />
                  </OptionalFieldToggle>
                  <OptionalFieldToggle
                    label="metadata.annotations"
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
                      label="metadata.annotations"
                      description="Optional annotations for non-identifying metadata."
                      resource={resource}
                      path={['metadata', 'annotations']}
                      onResourceChange={setResource}
                    />
                  </OptionalFieldToggle>
                </Stack>
              </CardContent>
            </Card>

            <Card variant="outlined">
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Spec
                </Typography>
                {specSchema ? (
                  <SchemaFieldRenderer
                    resource={resource}
                    schema={specSchema}
                    path={['spec']}
                    label="spec"
                    required
                    depth={0}
                    onResourceChange={setResource}
                  />
                ) : (
                  <Alert severity="info" icon={<InfoOutlinedIcon fontSize="inherit" />}>
                    No schema is available for spec fields. Continue editing on the YAML side.
                  </Alert>
                )}
              </CardContent>
            </Card>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}

mountWebview(ResourceCreatePanelView);
