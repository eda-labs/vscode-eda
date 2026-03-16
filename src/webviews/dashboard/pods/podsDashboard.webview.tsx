import React, { useCallback } from 'react';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionIcon from '@mui/icons-material/Description';
import SubjectIcon from '@mui/icons-material/Subject';
import TerminalIcon from '@mui/icons-material/Terminal';
import { Box, Tooltip } from '@mui/material';

import type { DataGridContext, DataGridMessage } from '../../shared/components';
import { DataGridDashboard, VSCodeButton } from '../../shared/components';
import { mountWebview } from '../../shared/utils';

interface PodsMessage extends DataGridMessage {
  status?: string;
}

const DISABLED_TOOLTIP = 'Kubernetes context needs to be set to enable pod actions';

function getPhaseColor(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'running' || normalized === 'succeeded') {
    return 'success.main';
  }
  if (normalized.includes('pending') || normalized.includes('creating') || normalized.includes('init')) {
    return 'warning.main';
  }
  if (normalized.includes('fail') || normalized.includes('error') || normalized.includes('crash') || normalized === 'unknown') {
    return 'error.main';
  }
  return undefined;
}

function getRestartColor(value: string): string | undefined {
  const restarts = Number.parseInt(value, 10);
  if (Number.isNaN(restarts) || restarts <= 0) {
    return undefined;
  }
  if (restarts >= 5) {
    return 'error.main';
  }
  return 'warning.main';
}

function PodsDashboard() {
  const renderActions = useCallback((row: unknown[], ctx: DataGridContext) => {
    const { nameIdx, nsIdx, hasKubernetesContext, postMessage } = ctx;
    const name = nameIdx >= 0 ? row[nameIdx] : '';
    const namespace = nsIdx >= 0 ? row[nsIdx] : '';
    const disabled = !hasKubernetesContext;

    const send = (command: string) => {
      postMessage({ command, name, namespace });
    };

    return (
      <>
        <Tooltip title={disabled ? DISABLED_TOOLTIP : 'View Logs'}>
          <span>
            <VSCodeButton variant="icon" size="sm" disabled={disabled} onClick={() => send('podLogs')}>
              <SubjectIcon fontSize="small" />
            </VSCodeButton>
          </span>
        </Tooltip>
        <Tooltip title={disabled ? DISABLED_TOOLTIP : 'Describe Pod'}>
          <span>
            <VSCodeButton variant="icon" size="sm" disabled={disabled} onClick={() => send('describePod')}>
              <DescriptionIcon fontSize="small" />
            </VSCodeButton>
          </span>
        </Tooltip>
        <Tooltip title={disabled ? DISABLED_TOOLTIP : 'Open Terminal'}>
          <span>
            <VSCodeButton variant="icon" size="sm" disabled={disabled} onClick={() => send('terminalPod')}>
              <TerminalIcon fontSize="small" />
            </VSCodeButton>
          </span>
        </Tooltip>
        <Tooltip title={disabled ? DISABLED_TOOLTIP : 'Delete Pod'}>
          <span>
            <VSCodeButton variant="icon" size="sm" disabled={disabled} onClick={() => send('deletePod')}>
              <DeleteOutlineIcon fontSize="small" />
            </VSCodeButton>
          </span>
        </Tooltip>
      </>
    );
  }, []);

  const renderCell = useCallback((value: string, column: string): React.ReactElement => {
    let color: string | undefined;
    if (column === 'phase') {
      color = getPhaseColor(value);
    } else if (column === 'restarts') {
      color = getRestartColor(value);
    }

    return (
      <Box component="span" sx={{ color }}>
        {value}
      </Box>
    );
  }, []);

  return (
    <DataGridDashboard<PodsMessage>
      defaultSortColumn="name"
      autoSizeColumns
      renderActions={renderActions}
      renderCell={renderCell}
    />
  );
}

mountWebview(PodsDashboard);
