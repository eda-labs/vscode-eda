import React, { useState, useCallback } from 'react';
import { usePostMessage, useMessageListener, useReadySignal, useCopyToClipboard } from '../shared/hooks';
import { VSCodeButton } from '../shared/components';
import { mountWebview } from '../shared/utils';

interface AlarmData {
  name: string;
  kind: string;
  type: string;
  severity: string;
  namespace: string;
  group: string;
  sourceGroup: string;
  sourceKind: string;
  sourceResource: string;
  parentAlarm: string;
  clusterSpecific: string;
  jspath: string;
  resource: string;
  probableCause?: string;
  remedialAction?: string;
  description?: string;
  rawJson: string;
}

interface AlarmMessage {
  command: string;
  data?: AlarmData;
}

function getSeverityColor(severity: string | undefined): string {
  const level = (severity || '').toLowerCase();
  switch (level) {
    case 'critical':
      return 'var(--vscode-errorForeground)';
    case 'major':
      return 'var(--vscode-editorWarning-foreground)';
    case 'minor':
    case 'warning':
      return 'var(--vscode-editorInfo-foreground)';
    case 'info':
      return 'var(--vscode-testing-iconPassed)';
    default:
      return 'var(--vscode-editorInfo-foreground)';
  }
}

function SummaryItem({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="text-xs text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 p-4 bg-[var(--vscode-panel-background)] rounded-lg border border-[var(--vscode-panel-border)]">
      <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
        <span>{icon}</span> {title}
      </h2>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function AlarmDetailsPanel() {
  const postMessage = usePostMessage();
  const [data, setData] = useState<AlarmData | null>(null);
  const { copied, copyToClipboard } = useCopyToClipboard();

  useReadySignal();

  useMessageListener<AlarmMessage>(useCallback((msg) => {
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

  if (!data) {
    return (
      <div className="p-6 flex items-center justify-center">
        <span className="text-[var(--vscode-descriptionForeground)]">Loading...</span>
      </div>
    );
  }

  const severityColor = getSeverityColor(data.severity);

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-4">
          Alarm <span className="text-[var(--vscode-textLink-foreground)]">{data.name}</span>
        </h1>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4 bg-[var(--vscode-panel-background)] rounded-lg border border-[var(--vscode-panel-border)]">
          <SummaryItem label="Kind" value={data.kind} />
          <SummaryItem label="Type" value={data.type} />
          <div className="flex flex-col gap-1">
            <div className="text-xs text-[var(--vscode-descriptionForeground)] uppercase tracking-wide">Severity</div>
            <div className="text-sm" style={{ color: severityColor }}>{data.severity}</div>
          </div>
          <SummaryItem label="Namespace" value={data.namespace} />
          <SummaryItem label="Group" value={data.group} />
          <SummaryItem label="Source Group" value={data.sourceGroup} />
          <SummaryItem label="Source Kind" value={data.sourceKind} />
          <SummaryItem label="Source Resource" value={data.sourceResource} />
          <SummaryItem label="Parent Alarm" value={data.parentAlarm} />
          <SummaryItem label="Cluster Specific" value={data.clusterSpecific} />
          <SummaryItem label="Jspath" value={data.jspath} className="col-span-2" />
          <SummaryItem label="Resource" value={data.resource} />
        </div>
      </div>

      {data.probableCause && (
        <Section icon="⚠️" title="Probable Cause">
          {data.probableCause}
        </Section>
      )}

      {data.remedialAction && (
        <Section icon="🛠️" title="Remedial Action">
          {data.remedialAction}
        </Section>
      )}

      {data.description && (
        <Section icon="📝" title="Description">
          {data.description}
        </Section>
      )}

      <div className="mb-6 p-4 bg-[var(--vscode-panel-background)] rounded-lg border border-[var(--vscode-panel-border)]">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span>📋</span> Raw JSON
          </h2>
          <VSCodeButton onClick={handleCopy} size="sm">
            {copied ? '✓ Copied!' : '📋 Copy'}
          </VSCodeButton>
        </div>
        <pre className="text-xs overflow-auto max-h-96 p-2 bg-[var(--vscode-textCodeBlock-background)] rounded">
          {data.rawJson}
        </pre>
      </div>
    </div>
  );
}

mountWebview(AlarmDetailsPanel);
