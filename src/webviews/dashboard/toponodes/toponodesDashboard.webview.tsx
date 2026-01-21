import { useCallback } from 'react';

import type { DataGridContext, DataGridMessage } from '../../shared/components';
import { DataGridDashboard } from '../../shared/components';
import { mountWebview } from '../../shared/utils';

interface ToponodesMessage extends DataGridMessage {
  status?: string;
}

function ToponodesDashboard() {
  const renderActions = useCallback((row: unknown[], ctx: DataGridContext) => {
    const { nameIdx, nsIdx, hasKubernetesContext, postMessage, getColumnIndex } = ctx;
    const name = nameIdx >= 0 ? row[nameIdx] : '';
    const ns = nsIdx >= 0 ? row[nsIdx] : '';
    const nodeDetailsIdx = getColumnIndex('node-details');
    const nodeDetails = nodeDetailsIdx >= 0 ? row[nodeDetailsIdx] : undefined;

    const handleViewConfig = () => {
      postMessage({ command: 'viewNodeConfig', name, namespace: ns });
    };

    const handleSSH = () => {
      postMessage({ command: 'sshTopoNode', name, namespace: ns, nodeDetails });
    };

    return (
      <>
        <button
          className="mr-1 p-1 border-none bg-vscode-accent text-vscode-button-fg rounded-sm cursor-pointer inline-flex items-center justify-center hover:bg-vscode-accent-hover"
          title="View Config"
          onClick={handleViewConfig}
        >
          <span className="codicon codicon-file-code" />
        </button>
        <button
          className="p-1 border-none bg-vscode-accent text-vscode-button-fg rounded-sm cursor-pointer inline-flex items-center justify-center hover:bg-vscode-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          title={hasKubernetesContext ? 'SSH' : 'Kubernetes context needs to be set to enable SSH'}
          disabled={!hasKubernetesContext}
          onClick={handleSSH}
        >
          <span className="codicon codicon-terminal" />
        </button>
      </>
    );
  }, []);

  return (
    <DataGridDashboard<ToponodesMessage>
      renderActions={renderActions}
    />
  );
}

mountWebview(ToponodesDashboard);
