import React, { useState, useCallback, useMemo } from 'react';

import { usePostMessage, useMessageListener, useReadySignal, useCopyToClipboard } from '../shared/hooks';
import { VSCodeButton } from '../shared/components';
import { mountWebview } from '../shared/utils';

interface NodeConfig {
  name: string;
  namespace: string;
  errors?: string[];
}

interface ChangedCr {
  namespace?: string;
  gvk?: { kind: string };
  name?: string;
  names?: string[];
}

interface InputCr {
  name?: {
    namespace?: string;
    gvk?: { kind?: string };
    name?: string;
  };
  isDelete?: boolean;
}

interface TransactionData {
  id: string;
  state: string;
  success: string;
  username: string;
  dryRun: string;
  description: string;
  deleteResources?: string[];
  inputCrs?: InputCr[];
  changedCrs?: ChangedCr[];
  nodesWithConfigChanges?: NodeConfig[];
  generalErrors?: string;
  intentsRun?: Array<{ intentName?: { name?: string }; errors?: Array<{ rawError?: string; message?: string }> }>;
  rawJson: string;
}

interface TransactionMessage {
  command: string;
  data?: TransactionData;
}

interface ErrorSummary {
  type: string;
  source: string;
  message: string;
  crName?: string;
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 p-4 bg-vscode-bg-secondary rounded-lg border border-vscode-border">
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <span>{icon}</span> {title}
      </h2>
      {children}
    </div>
  );
}

function ResourceItem({ path, name, isDelete }: { path: string; name?: string; isDelete?: boolean }) {
  return (
    <li className="flex items-center gap-2 py-1 px-2 hover:bg-vscode-bg-hover rounded-sm">
      <span className="text-vscode-text-secondary">{path}</span>
      {name && <span className="font-medium">{name}</span>}
      {isDelete && <span className="text-xs px-1 py-0.5 bg-status-error/20 text-status-error rounded-sm">DELETE</span>}
    </li>
  );
}

function NodeItem({ node }: { node: NodeConfig }) {
  const hasErrors = node.errors && node.errors.length > 0;

  return (
    <li className={`p-3 mb-2 rounded-sm border ${hasErrors ? 'border-status-error/50 bg-status-error/10' : 'border-vscode-border'}`}>
      <div className="flex justify-between items-center mb-1">
        <span className="font-medium">{node.name}</span>
        <span className="text-sm text-vscode-text-secondary">Namespace: {node.namespace}</span>
      </div>
      {hasErrors && (
        <div className="mt-2 space-y-2">
          {node.errors!.map((err, idx) => (
            <div key={idx} className="text-sm p-2 bg-status-error/20 rounded-sm">
              <div className="text-status-error">{err}</div>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function ErrorsSummary({ errors }: { errors: ErrorSummary[] }) {
  if (errors.length === 0) return <></>;

  return (
    <div className="mb-4 p-4 bg-status-error/10 border border-status-error/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <span>⚠️</span>
        <span className="font-semibold">Errors ({errors.length})</span>
      </div>
      <div className="space-y-2">
        {errors.map((err, idx) => (
          <div key={idx} className="p-2 bg-vscode-bg-secondary rounded-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs px-1.5 py-0.5 rounded-sm ${err.type === 'Intent Error' ? 'bg-status-warning/20 text-status-warning' : 'bg-status-error/20 text-status-error'}`}>
                {err.type}
              </span>
              <span className="text-sm font-medium">{err.source}</span>
              {err.crName && <span className="text-xs text-vscode-text-secondary">CR: {err.crName}</span>}
            </div>
            <div className="text-sm text-vscode-text-secondary">{err.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TransactionDetailsPanel() {
  const postMessage = usePostMessage();
  const [data, setData] = useState<TransactionData | null>(null);
  const { copied, copyToClipboard } = useCopyToClipboard();

  useReadySignal();

  useMessageListener<TransactionMessage>(useCallback((msg) => {
    if (msg.command === 'init' && msg.data) {
      setData(msg.data);
    }
  }, []));

  const handleCopy = useCallback(() => {
    if (data?.rawJson) {
      postMessage({ command: 'copy', text: data.rawJson });
      copyToClipboard(data.rawJson);
    }
  }, [data, postMessage, copyToClipboard]);

  const handleShowDiffs = useCallback(() => {
    postMessage({ command: 'showDiffs' });
  }, [postMessage]);

  // Memoize error aggregation
  const allErrors = useMemo((): ErrorSummary[] => {
    if (!data) return [];

    const errors: ErrorSummary[] = [];

    if (data.intentsRun) {
      data.intentsRun.forEach(intent => {
        if (intent.errors) {
          intent.errors.forEach(err => {
            const errorMessage = err.rawError || err.message || String(err);
            const shortError = errorMessage.split('\n').pop()?.trim() || errorMessage;
            errors.push({
              type: 'Intent Error',
              source: intent.intentName?.name || 'Unknown Intent',
              message: shortError
            });
          });
        }
      });
    }

    if (data.nodesWithConfigChanges) {
      data.nodesWithConfigChanges.forEach(node => {
        if (node.errors) {
          node.errors.forEach(err => {
            const validationMatch = err.match(/failed\s+validate:\s*(.+?)\s*error_str:"(.+?)"\s*cr_name:"(.+?)"/);
            if (validationMatch) {
              const [, , errorStr, crName] = validationMatch;
              errors.push({
                type: 'Validation Error',
                source: node.name,
                message: errorStr,
                crName
              });
            }
          });
        }
      });
    }

    return errors;
  }, [data]);

  if (!data) {
    return (
      <div className="p-6 flex items-center justify-center">
        <span className="text-vscode-text-secondary">Loading...</span>
      </div>
    );
  }

  const isSuccess = data.success === 'Yes';

  return (
    <div className="p-6 max-w-300 mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">
            Transaction <span className={isSuccess ? 'text-status-success' : 'text-status-error'}>#{data.id}</span>
          </h1>
          <VSCodeButton onClick={handleShowDiffs}>Show Diffs</VSCodeButton>
        </div>

        <ErrorsSummary errors={allErrors} />

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 p-4 bg-vscode-bg-secondary rounded-lg border border-vscode-border">
          <div>
            <div className="text-xs text-vscode-text-secondary uppercase">State</div>
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${isSuccess ? 'bg-status-success' : 'bg-status-error'}`} />
              {data.state}
            </div>
          </div>
          <div>
            <div className="text-xs text-vscode-text-secondary uppercase">User</div>
            <div>{data.username}</div>
          </div>
          <div>
            <div className="text-xs text-vscode-text-secondary uppercase">Success</div>
            <div className={isSuccess ? 'text-status-success' : 'text-status-error'}>{data.success}</div>
          </div>
          <div>
            <div className="text-xs text-vscode-text-secondary uppercase">Dry Run</div>
            <div>{data.dryRun}</div>
          </div>
          <div className="col-span-2 md:col-span-3 lg:col-span-1">
            <div className="text-xs text-vscode-text-secondary uppercase">Description</div>
            <div>{data.description}</div>
          </div>
        </div>
      </div>

      {data.deleteResources && data.deleteResources.length > 0 && (
        <Section icon="🗑️" title="Deleted Resources">
          <ul className="space-y-1">
            {data.deleteResources.map((res, idx) => (
              <ResourceItem key={idx} path={res} />
            ))}
          </ul>
        </Section>
      )}

      {data.inputCrs && data.inputCrs.length > 0 && (
        <Section icon="📥" title="Input Resources">
          <ul className="space-y-1">
            {data.inputCrs.map((cr, idx) => (
              <ResourceItem
                key={idx}
                path={`${cr.name?.namespace || 'default'} / ${cr.name?.gvk?.kind || 'Unknown'}`}
                name={cr.name?.name}
                isDelete={cr.isDelete}
              />
            ))}
          </ul>
        </Section>
      )}

      {data.changedCrs && data.changedCrs.length > 0 && (
        <Section icon="✏️" title="Changed Resources">
          <ul className="space-y-1">
            {data.changedCrs.flatMap((cr, idx) => {
              let names: string[];
              if (Array.isArray(cr.names) && cr.names.length > 0) {
                names = cr.names;
              } else if (cr.name) {
                names = [cr.name];
              } else {
                names = [];
              }
              const path = `${cr.namespace || 'default'} / ${cr.gvk?.kind || 'Unknown'}`;
              if (names.length === 0) {
                return [<ResourceItem key={idx} path={path} />];
              }
              return names.map((name, nIdx) => (
                <ResourceItem key={`${idx}-${nIdx}`} path={path} name={name} />
              ));
            })}
          </ul>
        </Section>
      )}

      {data.nodesWithConfigChanges && data.nodesWithConfigChanges.length > 0 && (
        <Section icon="🖥️" title="Nodes with Configuration Changes">
          <ul className="space-y-2">
            {data.nodesWithConfigChanges.map((node, idx) => (
              <NodeItem key={idx} node={node} />
            ))}
          </ul>
        </Section>
      )}

      {data.generalErrors && (
        <div className="mb-6 p-4 bg-status-error/10 border border-status-error/50 rounded-lg">
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <span>⚠️</span> General Errors
          </h2>
          <div className="text-sm">{data.generalErrors}</div>
        </div>
      )}

      <div className="mb-6 p-4 bg-vscode-bg-secondary rounded-lg border border-vscode-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span>📋</span> Raw JSON
          </h2>
          <VSCodeButton onClick={handleCopy} size="sm">
            {copied ? '✓ Copied!' : '📋 Copy'}
          </VSCodeButton>
        </div>
        <pre className="text-xs overflow-auto max-h-96 p-2 bg-vscode-code-bg rounded-sm">
          {data.rawJson}
        </pre>
      </div>
    </div>
  );
}

mountWebview(TransactionDetailsPanel);
