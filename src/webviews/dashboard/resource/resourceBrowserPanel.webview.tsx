import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';

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

function SchemaProp({ name, node, isRequired }: { name: string; node: SchemaNode; isRequired: boolean }) {
  const expandTrigger = useContext(ExpandContext);
  const [isOpen, setIsOpen] = useState(false);
  const type = node.type || (node.properties ? 'object' : '');

  // Respond to expand/collapse all
  useEffect(() => {
    if (expandTrigger > 0) setIsOpen(true);
    if (expandTrigger < 0) setIsOpen(false);
  }, [expandTrigger]);

  return (
    <details className="ml-4 mb-1" open={isOpen}>
      <summary
        className="flex items-center gap-2 cursor-pointer py-1 hover:bg-vscode-bg-hover"
        onClick={(e) => { e.preventDefault(); setIsOpen(!isOpen); }}
      >
        <span className="font-medium text-(--vscode-symbolIcon-propertyForeground)">{name}</span>
        {isRequired && (
          <span className="text-xs px-1 py-0.5 bg-status-error/20 text-status-error rounded-sm">required</span>
        )}
        <span className="text-xs px-1 py-0.5 bg-(--vscode-badge-background) text-(--vscode-badge-foreground) rounded-sm">{type}</span>
      </summary>
      <div className="ml-2 border-l border-vscode-border pl-2">
        {node.description && (
          <p className="text-sm text-vscode-text-secondary mb-1">{node.description}</p>
        )}
        {node.properties && <SchemaProps node={node} />}
        {node.items?.properties && <SchemaProps node={node.items} />}
      </div>
    </details>
  );
}

function SchemaProps({ node }: { node: SchemaNode }) {
  const required = node.required || [];
  const props = node.properties || {};
  return (
    <div>
      {Object.entries(props).map(([key, val]) => (
        <SchemaProp key={key} name={key} node={val as SchemaNode} isRequired={required.includes(key)} />
      ))}
    </div>
  );
}

function SchemaSection({ name, node }: { name: string; node: SchemaNode }) {
  const expandTrigger = useContext(ExpandContext);
  const [isOpen, setIsOpen] = useState(true);
  const type = node.type || (node.properties ? 'object' : '');

  // Respond to expand/collapse all
  useEffect(() => {
    if (expandTrigger > 0) setIsOpen(true);
    if (expandTrigger < 0) setIsOpen(false);
  }, [expandTrigger]);

  return (
    <details className="mb-4 border border-vscode-border rounded-sm" open={isOpen}>
      <summary
        className="flex items-center gap-2 cursor-pointer p-2 bg-vscode-bg-secondary hover:bg-vscode-bg-hover"
        onClick={(e) => { e.preventDefault(); setIsOpen(!isOpen); }}
      >
        <span className="font-semibold">{name}</span>
        <span className="text-xs px-1 py-0.5 bg-(--vscode-badge-background) text-(--vscode-badge-foreground) rounded-sm">{type}</span>
      </summary>
      <div className="p-2">
        {node.description && (
          <p className="text-sm text-vscode-text-secondary mb-2">{node.description}</p>
        )}
        <SchemaProps node={node} />
      </div>
    </details>
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

  const handleResourceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
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
      <div className="p-6 max-w-350 mx-auto">
        <header className="flex items-center gap-2 mb-4">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search..."
            className="px-2 py-1 bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded-sm flex-1 max-w-xs"
          />
          <select
            value={selectedResource}
            onChange={handleResourceChange}
            className="px-2 py-1 bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded-sm flex-1"
          >
            {filteredResources.map(r => (
              <option key={r.name} value={r.name}>{r.kind} ({r.name})</option>
            ))}
          </select>
          <VSCodeButton onClick={handleViewYaml}>View YAML</VSCodeButton>
        </header>

        <h1 className="text-xl font-semibold mb-2">{title}</h1>

        <div className="mb-4 p-2 bg-vscode-code-bg rounded-sm overflow-auto max-h-48">
          <pre className="text-sm whitespace-pre-wrap">{yaml}</pre>
        </div>

        {description && (
          <p className="text-vscode-text-secondary mb-4">{description}</p>
        )}

        <div className="flex gap-2 mb-4">
          <VSCodeButton variant="secondary" size="sm" onClick={handleExpandAll}>+ Expand All</VSCodeButton>
          <VSCodeButton variant="secondary" size="sm" onClick={handleCollapseAll}>- Collapse All</VSCodeButton>
        </div>

        <div>
          {specSchema && <SchemaSection name="spec" node={specSchema} />}
          {statusSchema && <SchemaSection name="status" node={statusSchema} />}
          {!specSchema && !statusSchema && schema && (
            <SchemaSection name="schema" node={schema as SchemaNode} />
          )}
        </div>
      </div>
    </ExpandContext.Provider>
  );
}

mountWebview(ResourceBrowserPanel);
