import { useCallback } from 'react';
import { DataGridDashboard, DataGridContext, DataGridMessage } from '../../shared/components';
import { mountWebview } from '../../shared/utils';

interface SimnodesMessage extends DataGridMessage {
  status?: string;
}

function getStatusClassName(value: string): string {
  if (value === 'Running') return 'text-green-500';
  if (value === 'Starting' || value === 'Pending') return 'text-yellow-500';
  if (value === 'No Pod' || value === 'Failed' || value === 'Unknown') return 'text-red-500';
  return '';
}

function SimnodesDashboard() {
  const renderActions = useCallback((row: unknown[], ctx: DataGridContext) => {
    const { nameIdx, nsIdx, hasKubernetesContext, postMessage, getColumnIndex } = ctx;
    const name = nameIdx >= 0 ? row[nameIdx] : '';
    const ns = nsIdx >= 0 ? row[nsIdx] : '';
    const osIdx = getColumnIndex('operatingSystem');
    const os = osIdx >= 0 ? row[osIdx] : '';

    const handleViewYaml = () => {
      postMessage({ command: 'viewSimnodeYaml', name, namespace: ns });
    };

    const handleSSH = () => {
      postMessage({ command: 'sshSimnode', name, namespace: ns, operatingSystem: os });
    };

    return (
      <>
        <button
          className="mr-1 p-1 border-none bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded cursor-pointer inline-flex items-center justify-center hover:bg-[var(--vscode-button-hoverBackground)]"
          title="View YAML"
          onClick={handleViewYaml}
        >
          <span className="codicon codicon-file-code" />
        </button>
        <button
          className="p-1 border-none bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded cursor-pointer inline-flex items-center justify-center hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50 disabled:cursor-not-allowed"
          title={hasKubernetesContext ? 'SSH to SimNode' : 'Kubernetes context needs to be set to enable SSH'}
          disabled={!hasKubernetesContext}
          onClick={handleSSH}
        >
          <span className="codicon codicon-terminal" />
        </button>
      </>
    );
  }, []);

  const renderCell = useCallback((value: string, column: string) => {
    if (column === 'pod-status') {
      const statusClass = getStatusClassName(value);
      return <span className={statusClass}>{value}</span>;
    }
    return value;
  }, []);

  return (
    <DataGridDashboard<SimnodesMessage>
      renderActions={renderActions}
      renderCell={renderCell}
    />
  );
}

mountWebview(SimnodesDashboard);
