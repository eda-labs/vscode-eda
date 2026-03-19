import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccountTreeOutlined as AccountTreeOutlinedIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  FactCheckOutlined as FactCheckOutlinedIcon,
  InfoOutlined as InfoOutlinedIcon,
  PlayArrowOutlined as PlayArrowOutlinedIcon,
  Search as SearchIcon,
  ShoppingBasketOutlined as ShoppingBasketOutlinedIcon,
  WarningAmber as WarningAmberIcon
} from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Stack,
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
  ResourceCreateWebviewMessage,
  ResourceValueSuggestions
} from './types';
import {
  defaultFromSchema,
  FieldTitle,
  formatFieldLabel,
  formatKindTitle,
  hasValueAtPath,
  KeyValueEditor,
  OptionalFieldToggle,
  type PathSegment,
  SchemaFieldRenderer,
  setValueAtPath,
  SuggestiveTextField
} from './resourceCreatePanelFields';

type ResourceModel = Record<string, unknown>;

interface OutlineEntry {
  id: string;
  section: 'Metadata' | 'Specification';
  label: string;
}

interface SpecFieldState {
  specSchema: JsonSchemaNode | undefined;
  specProperties: Record<string, JsonSchemaNode | undefined>;
  specKeys: string[];
  requiredSpecKeys: string[];
  optionalSpecKeys: string[];
}

interface HostMessageHandlers {
  onInit: (message: Extract<ResourceCreatePanelToWebviewMessage, { command: 'init' }>) => void;
  onSuggestions: (message: Extract<ResourceCreatePanelToWebviewMessage, { command: 'suggestions' }>) => void;
  onYamlModel: (message: Extract<ResourceCreatePanelToWebviewMessage, { command: 'yamlModel' }>) => void;
  onYamlError: (message: Extract<ResourceCreatePanelToWebviewMessage, { command: 'yamlError' }>) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function withCurrentOption(options: string[], currentValue: string): string[] {
  const current = currentValue.trim();
  if (current.length === 0 || options.includes(current)) {
    return options;
  }
  return [...options, current].sort((left, right) => left.localeCompare(right));
}

function buildNamespaceOptions(
  fieldSuggestions: Record<string, string[]>,
  suggestionNamespaces: string[],
  namespaceValue: string
): string[] {
  const options = new Set<string>([
    ...(fieldSuggestions['metadata.namespace'] ?? []),
    ...suggestionNamespaces
  ]);
  const current = namespaceValue.trim();
  if (current.length > 0) {
    options.add(current);
  }
  return Array.from(options).sort((left, right) => left.localeCompare(right));
}

function sortKeysByRequired(
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

function deriveSpecFieldState(specSchema: JsonSchemaNode | undefined): SpecFieldState {
  const specProperties = specSchema?.properties ?? {};
  const requiredSet = new Set(specSchema?.required ?? []);
  const specKeys = sortKeysByRequired(specProperties, requiredSet);
  return {
    specSchema,
    specProperties,
    specKeys,
    requiredSpecKeys: specKeys.filter(key => requiredSet.has(key)),
    optionalSpecKeys: specKeys.filter(key => !requiredSet.has(key))
  };
}

function buildOutlineEntries(isNamespaced: boolean, specKeys: string[]): OutlineEntry[] {
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
}

function filterOutlineEntries(entries: OutlineEntry[], filterValue: string): OutlineEntry[] {
  const filter = filterValue.trim().toLowerCase();
  if (filter.length === 0) {
    return entries;
  }
  return entries.filter(entry => entry.label.toLowerCase().includes(filter));
}

function dispatchHostMessage(message: ResourceCreatePanelToWebviewMessage, handlers: HostMessageHandlers): void {
  switch (message.command) {
    case 'init':
      handlers.onInit(message);
      return;
    case 'suggestions':
      handlers.onSuggestions(message);
      return;
    case 'yamlModel':
      handlers.onYamlModel(message);
      return;
    case 'yamlError':
      handlers.onYamlError(message);
      return;
    default:
      return;
  }
}

interface OutlineSectionProps {
  title: string;
  entries: OutlineEntry[];
  hoverHighlight: string;
  onSelect: (id: string) => void;
  emptyLabel?: string;
}

function OutlineSection({
  title,
  entries,
  hoverHighlight,
  onSelect,
  emptyLabel
}: Readonly<OutlineSectionProps>) {
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 0.75 }}>
        <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      </Stack>
      <Stack spacing={0.2} sx={{ mt: 0.4 }}>
        {entries.map(entry => (
          <Button
            key={entry.id}
            size="small"
            color="inherit"
            onClick={() => onSelect(entry.id)}
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
        {emptyLabel && entries.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 0.6 }}>
            {emptyLabel}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

interface OutlinePaneProps {
  collapsed: boolean;
  outlineFilter: string;
  onOutlineFilterChange: (value: string) => void;
  onSelectEntry: (id: string) => void;
  metadataEntries: OutlineEntry[];
  specEntries: OutlineEntry[];
  hoverHighlight: string;
  surfaceBorder: string;
  kind: string;
}

function OutlinePane({
  collapsed,
  outlineFilter,
  onOutlineFilterChange,
  onSelectEntry,
  metadataEntries,
  specEntries,
  hoverHighlight,
  surfaceBorder,
  kind
}: Readonly<OutlinePaneProps>) {
  const outlineWidth = collapsed ? 40 : 212;
  return (
    <Box
      sx={{
        width: outlineWidth,
        flexShrink: 0,
        borderRight: 1,
        borderColor: surfaceBorder,
        bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.38 : 0.62),
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        transition: 'width 180ms ease'
      }}
    >
      {!collapsed && (
        <>
          <Box sx={{ px: 2.5, py: 1.4, borderBottom: 1, borderColor: surfaceBorder }}>
            <Typography variant="h6" sx={{ fontWeight: 500, letterSpacing: 0.1 }}>
              {formatKindTitle(kind)}
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
              onChange={(event) => onOutlineFilterChange(event.target.value)}
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
              <OutlineSection
                title="Metadata"
                entries={metadataEntries}
                hoverHighlight={hoverHighlight}
                onSelect={onSelectEntry}
              />
              <OutlineSection
                title="Specification"
                entries={specEntries}
                hoverHighlight={hoverHighlight}
                onSelect={onSelectEntry}
                emptyLabel="No fields"
              />
            </Stack>
          </Box>
        </>
      )}
    </Box>
  );
}

interface MetadataSectionProps {
  resource: ResourceModel;
  setResource: (next: ResourceModel) => void;
  kind: string;
  isNamespaced: boolean;
  nameValue: string;
  namespaceValue: string;
  metadataNameOptions: string[];
  namespaceOptions: string[];
  labelsEnabled: boolean;
  annotationsEnabled: boolean;
}

function MetadataSection({
  resource,
  setResource,
  kind,
  isNamespaced,
  nameValue,
  namespaceValue,
  metadataNameOptions,
  namespaceOptions,
  labelsEnabled,
  annotationsEnabled
}: Readonly<MetadataSectionProps>) {
  return (
    <Box
      id="section-metadata"
      sx={{ px: { xs: 1.5, md: 2.8 }, py: { xs: 1.4, md: 2 }, borderBottom: 1, borderColor: 'divider' }}
    >
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.75 }}>
        Metadata
      </Typography>
      <Stack spacing={1.5}>
        <Box id="metadata-name">
          <FieldTitle label="Name" required requiredMissing={nameValue.trim().length === 0} />
          <SuggestiveTextField
            placeholder={`Enter ${kind.toLowerCase()} name`}
            value={nameValue}
            onChange={(nextValue) => setResource(setValueAtPath(resource, ['metadata', 'name'], nextValue))}
            options={metadataNameOptions}
            error={nameValue.trim().length === 0}
            helperText={nameValue.trim().length === 0 ? 'Name is required' : undefined}
          />
        </Box>
        {isNamespaced && (
          <Box id="metadata-namespace">
            <FieldTitle label="Namespace" required requiredMissing={namespaceValue.trim().length === 0} />
            <SuggestiveTextField
              placeholder="eda"
              value={namespaceValue}
              onChange={(nextValue) => setResource(setValueAtPath(resource, ['metadata', 'namespace'], nextValue))}
              options={namespaceOptions}
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
              setResource(setValueAtPath(resource, ['metadata', 'labels'], enabled ? {} : undefined));
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
              setResource(setValueAtPath(resource, ['metadata', 'annotations'], enabled ? {} : undefined));
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
  );
}

interface SpecSectionProps {
  resource: ResourceModel;
  setResource: (next: ResourceModel) => void;
  fieldSuggestions: Record<string, string[]>;
  specFieldState: SpecFieldState;
}

function SpecSection({
  resource,
  setResource,
  fieldSuggestions,
  specFieldState
}: Readonly<SpecSectionProps>) {
  const {
    specSchema,
    specProperties,
    specKeys,
    requiredSpecKeys,
    optionalSpecKeys
  } = specFieldState;

  return (
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
                suggestions={fieldSuggestions}
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
                    suggestions={fieldSuggestions}
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
  );
}

interface ActionBarProps {
  disabled: boolean;
  onAction: (action: 'commit' | 'dryRun' | 'basket') => void;
}

function ActionBar({ disabled, onAction }: Readonly<ActionBarProps>) {
  return (
    <Box
      sx={{
        mt: 'auto',
        px: { xs: 1.5, md: 2.8 },
        py: 1,
        borderTop: 1,
        borderColor: 'divider',
        position: 'sticky',
        bottom: 0,
        bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.72 : 0.92),
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 0.5
      }}
    >
      <Tooltip title="Add To Basket">
        <span>
          <IconButton size="small" color="inherit" disabled={disabled} onClick={() => onAction('basket')}>
            <ShoppingBasketOutlinedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Dry Run">
        <span>
          <IconButton size="small" color="inherit" disabled={disabled} onClick={() => onAction('dryRun')}>
            <FactCheckOutlinedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Commit">
        <span>
          <IconButton size="small" color="inherit" disabled={disabled} onClick={() => onAction('commit')}>
            <PlayArrowOutlinedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

interface EditorPaneProps {
  collapsed: boolean;
  surfaceBorder: string;
  yamlError: string | null;
  onToggleCollapsed: () => void;
  onAction: (action: 'commit' | 'dryRun' | 'basket') => void;
  metadataSection: ReactNode;
  specSection: ReactNode;
}

function EditorPane({
  collapsed,
  surfaceBorder,
  yamlError,
  onToggleCollapsed,
  onAction,
  metadataSection,
  specSection
}: Readonly<EditorPaneProps>) {
  return (
    <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative' }}>
      <IconButton
        size="small"
        onClick={onToggleCollapsed}
        sx={{
          position: 'absolute',
          left: -10,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 5,
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.3),
          border: 1,
          borderColor: surfaceBorder
        }}
      >
        {collapsed ? <ChevronRightIcon sx={{ fontSize: 16 }} /> : <ChevronLeftIcon sx={{ fontSize: 16 }} />}
      </IconButton>
      <Box sx={{ p: { xs: 0.75, md: 1.5 }, minHeight: '100%' }}>
        <Box
          sx={{
            bgcolor: (theme) => alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.28 : 0.76),
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
          <Box
            sx={{
              ...(yamlError ? { opacity: 0.7, pointerEvents: 'none' } : undefined),
              display: 'flex',
              flexDirection: 'column',
              minHeight: '100%'
            }}
          >
            {metadataSection}
            {specSection}
            <ActionBar disabled={Boolean(yamlError)} onAction={onAction} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

interface PanelLayoutProps {
  collapsed: boolean;
  outlineFilter: string;
  onOutlineFilterChange: (value: string) => void;
  onSelectEntry: (id: string) => void;
  metadataOutline: OutlineEntry[];
  specOutline: OutlineEntry[];
  hoverHighlight: string;
  surfaceBorder: string;
  kind: string;
  yamlError: string | null;
  onToggleCollapsed: () => void;
  onAction: (action: 'commit' | 'dryRun' | 'basket') => void;
  metadataSection: ReactNode;
  specSection: ReactNode;
}

function PanelLayout({
  collapsed,
  outlineFilter,
  onOutlineFilterChange,
  onSelectEntry,
  metadataOutline,
  specOutline,
  hoverHighlight,
  surfaceBorder,
  kind,
  yamlError,
  onToggleCollapsed,
  onAction,
  metadataSection,
  specSection
}: Readonly<PanelLayoutProps>) {
  return (
    <Box sx={{ height: '100vh', bgcolor: 'background.default' }}>
      <Stack direction="row" sx={{ height: '100%', minWidth: 0 }}>
        <OutlinePane
          collapsed={collapsed}
          outlineFilter={outlineFilter}
          onOutlineFilterChange={onOutlineFilterChange}
          onSelectEntry={onSelectEntry}
          metadataEntries={metadataOutline}
          specEntries={specOutline}
          hoverHighlight={hoverHighlight}
          surfaceBorder={surfaceBorder}
          kind={kind}
        />
        <EditorPane
          collapsed={collapsed}
          surfaceBorder={surfaceBorder}
          yamlError={yamlError}
          onToggleCollapsed={onToggleCollapsed}
          onAction={onAction}
          metadataSection={metadataSection}
          specSection={specSection}
        />
      </Stack>
    </Box>
  );
}

function ResourceCreatePanelView() {
  const theme = useTheme();
  const postMessage = usePostMessage<ResourceCreateWebviewMessage>();
  const [crd, setCrd] = useState<EdaCrd | null>(null);
  const [schema, setSchema] = useState<JsonSchemaNode | null>(null);
  const [resource, setResource] = useState<ResourceModel | null>(null);
  const [suggestions, setSuggestions] = useState<ResourceValueSuggestions>({ namespaces: [], fields: {} });
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [outlineFilter, setOutlineFilter] = useState('');
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const suppressPostRef = useRef(false);
  const initializedRef = useRef(false);
  const lastRequestedNamespaceRef = useRef<string | null>(null);

  useReadySignal();

  const setResourceFromHost = useCallback((nextResource: ResourceModel) => {
    suppressPostRef.current = true;
    setResource(nextResource);
  }, []);

  const onHostInit = useCallback((message: Extract<ResourceCreatePanelToWebviewMessage, { command: 'init' }>) => {
    setCrd(message.crd);
    setSchema(message.schema);
    setSuggestions(message.suggestions);
    setYamlError(null);
    setResourceFromHost(message.resource);
    const initMetadata = isRecord(message.resource.metadata) ? message.resource.metadata : {};
    lastRequestedNamespaceRef.current = typeof initMetadata.namespace === 'string' ? initMetadata.namespace.trim() : '';
    initializedRef.current = true;
  }, [setResourceFromHost]);

  useMessageListener<ResourceCreatePanelToWebviewMessage>(useCallback((message) => {
    dispatchHostMessage(message, {
      onInit: onHostInit,
      onSuggestions: next => setSuggestions(next.suggestions),
      onYamlModel: next => {
        setYamlError(null);
        setResourceFromHost(next.resource);
      },
      onYamlError: next => setYamlError(next.error)
    });
  }, [onHostInit, setResourceFromHost]));

  useEffect(() => {
    if (!initializedRef.current || !resource || yamlError) {
      return;
    }
    if (suppressPostRef.current) {
      suppressPostRef.current = false;
      return;
    }
    postMessage({ command: 'formUpdate', resource });
  }, [postMessage, resource, yamlError]);

  useEffect(() => {
    if (!initializedRef.current || !resource || yamlError) {
      return;
    }
    const metadata = isRecord(resource.metadata) ? resource.metadata : {};
    const selectedNamespace = typeof metadata.namespace === 'string' ? metadata.namespace.trim() : '';
    if (lastRequestedNamespaceRef.current === selectedNamespace) {
      return;
    }
    const timeoutHandle = window.setTimeout(() => {
      lastRequestedNamespaceRef.current = selectedNamespace;
      postMessage({ command: 'refreshSuggestions', resource });
    }, 220);
    return () => window.clearTimeout(timeoutHandle);
  }, [postMessage, resource, yamlError]);

  if (!resource || !crd) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Loading create-resource form...
        </Typography>
      </Box>
    );
  }

  const metadata = isRecord(resource.metadata) ? resource.metadata : {};
  const nameValue = typeof metadata.name === 'string' ? metadata.name : '';
  const namespaceValue = typeof metadata.namespace === 'string' ? metadata.namespace : '';
  const fieldSuggestions = suggestions.fields;
  const metadataNameOptions = withCurrentOption(fieldSuggestions['metadata.name'] ?? [], nameValue);
  const namespaceOptions = buildNamespaceOptions(fieldSuggestions, suggestions.namespaces, namespaceValue);
  const labelsEnabled = hasValueAtPath(resource, ['metadata', 'labels']);
  const annotationsEnabled = hasValueAtPath(resource, ['metadata', 'annotations']);
  const isNamespaced = crd.namespaced;
  const specFieldState = deriveSpecFieldState(schema?.properties?.spec);
  const outlineEntries = buildOutlineEntries(isNamespaced, specFieldState.specKeys);
  const filteredOutlineEntries = filterOutlineEntries(outlineEntries, outlineFilter);
  const metadataOutline = filteredOutlineEntries.filter(entry => entry.section === 'Metadata');
  const specOutline = filteredOutlineEntries.filter(entry => entry.section === 'Specification');
  const surfaceBorder = alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.24 : 0.18);
  const hoverHighlight = alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1);

  const scrollToEntry = (id: string) => {
    const node = document.getElementById(id);
    node?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const executeAction = (action: 'commit' | 'dryRun' | 'basket') => {
    postMessage({ command: 'executeAction', action });
  };

  return (
    <PanelLayout
      collapsed={isOutlineCollapsed}
      outlineFilter={outlineFilter}
      onOutlineFilterChange={setOutlineFilter}
      onSelectEntry={scrollToEntry}
      metadataOutline={metadataOutline}
      specOutline={specOutline}
      hoverHighlight={hoverHighlight}
      surfaceBorder={surfaceBorder}
      kind={crd.kind}
      yamlError={yamlError}
      onToggleCollapsed={() => setIsOutlineCollapsed(current => !current)}
      onAction={executeAction}
      metadataSection={(
        <MetadataSection
          resource={resource}
          setResource={setResource}
          kind={crd.kind}
          isNamespaced={isNamespaced}
          nameValue={nameValue}
          namespaceValue={namespaceValue}
          metadataNameOptions={metadataNameOptions}
          namespaceOptions={namespaceOptions}
          labelsEnabled={labelsEnabled}
          annotationsEnabled={annotationsEnabled}
        />
      )}
      specSection={(
        <SpecSection
          resource={resource}
          setResource={setResource}
          fieldSuggestions={fieldSuggestions}
          specFieldState={specFieldState}
        />
      )}
    />
  );
}

mountWebview(ResourceCreatePanelView);
