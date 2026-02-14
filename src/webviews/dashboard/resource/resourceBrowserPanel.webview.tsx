import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DescriptionIcon from '@mui/icons-material/Description';
import SearchIcon from '@mui/icons-material/Search';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Collapse,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography
} from '@mui/material';

import { usePostMessage, useMessageListener, useReadySignal } from '../../shared/hooks';
import { VSCodeButton } from '../../shared/components';
import { mountWebview } from '../../shared/utils';

// Context for expand/collapse all trigger
const ExpandContext = createContext<number>(0);

interface ResourceItem {
  name: string;
  kind: string;
}

interface ResourceBrowserMessage {
  command: string;
  list?: ResourceItem[];
  selected?: string;
  schema?: Record<string, unknown>;
  description?: string;
  kind?: string;
  yaml?: string;
  message?: string;
}

interface SchemaNode {
  type?: string;
  description?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  required?: string[];
}

function SchemaProp({ name, node, isRequired }: Readonly<{ name: string; node: SchemaNode; isRequired: boolean }>) {
  const expandTrigger = useContext(ExpandContext);
  const [isOpen, setIsOpen] = useState(false);
  const type = node.type || (node.properties ? 'object' : '');

  // Respond to expand/collapse all
  useEffect(() => {
    if (expandTrigger > 0) setIsOpen(true);
    if (expandTrigger < 0) setIsOpen(false);
  }, [expandTrigger]);

  const hasExpandableContent = Boolean(node.description || node.properties || node.items?.properties);

  return (
    <Box sx={{ ml: 2, mb: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <IconButton
          size="small"
          onClick={() => setIsOpen(prev => !prev)}
          disabled={!hasExpandableContent}
          sx={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
        >
          <ExpandMoreIcon fontSize="small" />
        </IconButton>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'info.main' }}>{name}</Typography>
        {isRequired && <Chip size="small" color="error" label="required" />}
        {type && <Chip size="small" variant="outlined" label={type} />}
      </Stack>
      <Collapse in={isOpen} unmountOnExit>
        <Box sx={{ ml: 3, pl: 1.5, borderLeft: 1, borderColor: 'divider' }}>
          {node.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{node.description}</Typography>
          )}
          {node.properties && <SchemaProps node={node} />}
          {node.items?.properties && <SchemaProps node={node.items} />}
        </Box>
      </Collapse>
    </Box>
  );
}

function SchemaProps({ node }: Readonly<{ node: SchemaNode }>) {
  const required = node.required || [];
  const props = node.properties || {};
  return (
    <Box>
      {Object.entries(props).map(([key, val]) => (
        <SchemaProp key={key} name={key} node={val as SchemaNode} isRequired={required.includes(key)} />
      ))}
    </Box>
  );
}

function SchemaSection({ name, node }: Readonly<{ name: string; node: SchemaNode }>) {
  const expandTrigger = useContext(ExpandContext);
  const [isOpen, setIsOpen] = useState(true);
  const type = node.type || (node.properties ? 'object' : '');

  // Respond to expand/collapse all
  useEffect(() => {
    if (expandTrigger > 0) setIsOpen(true);
    if (expandTrigger < 0) setIsOpen(false);
  }, [expandTrigger]);

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: isOpen ? 1 : 0 }}>
          <IconButton size="small" onClick={() => setIsOpen(!isOpen)} sx={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}>
            <ExpandMoreIcon fontSize="small" />
          </IconButton>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{name}</Typography>
          {type && <Chip size="small" variant="outlined" label={type} />}
        </Stack>

        <Collapse in={isOpen} unmountOnExit>
          {node.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {node.description}
            </Typography>
          )}
          <SchemaProps node={node} />
        </Collapse>
      </CardContent>
    </Card>
  );
}

function ResourceBrowserPanel() {
  const postMessage = usePostMessage();
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [selectedResource, setSelectedResource] = useState('');
  const [filter, setFilter] = useState('');
  const [title, setTitle] = useState('');
  const [yaml, setYaml] = useState('');
  const [description, setDescription] = useState('');
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  // Positive = expand all, negative = collapse all, increment to trigger
  const [expandTrigger, setExpandTrigger] = useState(0);

  useReadySignal();

  useMessageListener<ResourceBrowserMessage>(useCallback((msg) => {
    if (msg.command === 'resources') {
      setResources(msg.list ?? []);
      if (msg.selected && msg.list?.some(c => c.name === msg.selected)) {
        setSelectedResource(msg.selected);
        postMessage({ command: 'showResource', name: msg.selected });
      } else if (msg.list && msg.list.length > 0) {
        setSelectedResource(msg.list[0].name);
        postMessage({ command: 'showResource', name: msg.list[0].name });
      }
    } else if (msg.command === 'resourceData') {
      setTitle(msg.kind ?? '');
      setYaml(msg.yaml ?? '');
      setDescription(msg.description ?? '');
      setSchema(msg.schema as Record<string, unknown> | null);
    } else if (msg.command === 'error') {
      setTitle('Error');
      setYaml(msg.message ?? '');
      setDescription('');
      setSchema(null);
    }
  }, [postMessage]));

  const filteredResources = useMemo(() => {
    const lowerFilter = filter.toLowerCase();
    return resources.filter(r =>
      r.kind.toLowerCase().includes(lowerFilter) || r.name.toLowerCase().includes(lowerFilter)
    );
  }, [resources, filter]);

  const handleResourceChange = useCallback((name: string) => {
    setSelectedResource(name);
    postMessage({ command: 'showResource', name });
  }, [postMessage]);

  const handleViewYaml = useCallback(() => {
    postMessage({ command: 'viewYaml', name: selectedResource });
  }, [postMessage, selectedResource]);

  const handleExpandAll = useCallback(() => {
    setExpandTrigger(prev => Math.abs(prev) + 1);
  }, []);

  const handleCollapseAll = useCallback(() => {
    setExpandTrigger(prev => -(Math.abs(prev) + 1));
  }, []);

  const schemaObj = schema as { properties?: { spec?: SchemaNode; status?: SchemaNode } } | null;
  const specSchema = schemaObj?.properties?.spec;
  const statusSchema = schemaObj?.properties?.status;

  return (
    <ExpandContext.Provider value={expandTrigger}>
      <Box sx={{ p: 3, maxWidth: 1600, mx: 'auto' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          <TextField
            size="small"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search..."
            sx={{ width: { xs: '100%', md: 320 } }}
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

          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel id="resource-select-label">Resource</InputLabel>
            <Select
              labelId="resource-select-label"
              value={selectedResource}
              label="Resource"
              onChange={(event) => handleResourceChange(String(event.target.value))}
            >
              {filteredResources.map(r => (
                <MenuItem key={r.name} value={r.name}>{r.kind} ({r.name})</MenuItem>
              ))}
            </Select>
          </FormControl>
          <VSCodeButton onClick={handleViewYaml}>View YAML</VSCodeButton>
        </Stack>

        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1.5 }}>{title}</Typography>

        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent sx={{ p: 1.5 }}>
            <Box component="pre" sx={{ fontSize: 13, m: 0, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {yaml}
            </Box>
          </CardContent>
        </Card>

        {description && (
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {description}
          </Typography>
        )}

        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <VSCodeButton variant="primary" size="sm" onClick={handleExpandAll}>
            <UnfoldMoreIcon fontSize="small" sx={{ mr: 0.5 }} />
            Expand All
          </VSCodeButton>
          <VSCodeButton variant="primary" size="sm" onClick={handleCollapseAll}>
            <UnfoldLessIcon fontSize="small" sx={{ mr: 0.5 }} />
            Collapse All
          </VSCodeButton>
        </Stack>

        <Box>
          {specSchema && <SchemaSection name="spec" node={specSchema} />}
          {statusSchema && <SchemaSection name="status" node={statusSchema} />}
          {!specSchema && !statusSchema && schema && (
            <SchemaSection name="schema" node={schema as SchemaNode} />
          )}
          {!schema && (
            <Stack direction="row" spacing={1} alignItems="center" color="text.secondary">
              <DescriptionIcon fontSize="small" />
              <Typography variant="body2">No schema available</Typography>
            </Stack>
          )}
        </Box>
      </Box>
    </ExpandContext.Provider>
  );
}

mountWebview(ResourceBrowserPanel);
