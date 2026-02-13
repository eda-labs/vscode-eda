import { useCallback } from 'react';
import CodeIcon from '@mui/icons-material/Code';
import TerminalIcon from '@mui/icons-material/Terminal';
import { Tooltip } from '@mui/material';

import type { DataGridContext, DataGridMessage } from '../../shared/components';
import { DataGridDashboard, VSCodeButton } from '../../shared/components';
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
        <Tooltip title="View Config">
          <span>
            <VSCodeButton variant="icon" size="sm" onClick={handleViewConfig}>
              <CodeIcon fontSize="small" />
            </VSCodeButton>
          </span>
        </Tooltip>
        <Tooltip title={hasKubernetesContext ? 'SSH' : 'Kubernetes context needs to be set to enable SSH'}>
          <span>
            <VSCodeButton variant="icon" size="sm" disabled={!hasKubernetesContext} onClick={handleSSH}>
              <TerminalIcon fontSize="small" />
            </VSCodeButton>
          </span>
        </Tooltip>
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
