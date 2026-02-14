import React, { useCallback } from 'react';
import CodeIcon from '@mui/icons-material/Code';
import TerminalIcon from '@mui/icons-material/Terminal';
import { Box, Tooltip } from '@mui/material';

import type { DataGridContext, DataGridMessage } from '../../shared/components';
import { DataGridDashboard, VSCodeButton } from '../../shared/components';
import { mountWebview } from '../../shared/utils';

interface SimnodesMessage extends DataGridMessage {
  status?: string;
}

function getStatusColor(value: string): string | undefined {
  if (value === 'Running') return 'success.main';
  if (value === 'Starting' || value === 'Pending') return 'warning.main';
  if (value === 'No Pod' || value === 'Failed' || value === 'Unknown') return 'error.main';
  return undefined;
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
        <Tooltip title="View YAML">
          <span>
            <VSCodeButton variant="icon" size="sm" onClick={handleViewYaml}>
              <CodeIcon fontSize="small" />
            </VSCodeButton>
          </span>
        </Tooltip>
        <Tooltip title={hasKubernetesContext ? 'SSH to SimNode' : 'Kubernetes context needs to be set to enable SSH'}>
          <span>
            <VSCodeButton variant="icon" size="sm" disabled={!hasKubernetesContext} onClick={handleSSH}>
              <TerminalIcon fontSize="small" />
            </VSCodeButton>
          </span>
        </Tooltip>
      </>
    );
  }, []);

  const renderCell = useCallback((value: string, column: string): React.ReactElement => {
    const statusColor = column === 'pod-status' ? getStatusColor(value) : undefined;
    return (
      <Box component="span" sx={{ color: statusColor }}>
        {value}
      </Box>
    );
  }, []);

  return (
    <DataGridDashboard<SimnodesMessage>
      renderActions={renderActions}
      renderCell={renderCell}
    />
  );
}

mountWebview(SimnodesDashboard);
