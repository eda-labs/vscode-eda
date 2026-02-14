import React, { useCallback } from 'react';
import CodeIcon from '@mui/icons-material/Code';
import { Box, Tooltip } from '@mui/material';

import type { DataGridContext, DataGridMessage, DataGridToolbarContext } from '../../shared/components';
import { DataGridDashboard, VSCodeButton } from '../../shared/components';
import { mountWebview } from '../../shared/utils';

interface WorkflowsMessage extends DataGridMessage {
  status?: string;
}

const SUCCESS_STATUS_TOKENS = ['success', 'succeed', 'complete', 'done', 'ready'];
const ERROR_STATUS_TOKENS = ['fail', 'error', 'abort', 'timeout'];
const ACTIVE_STATUS_TOKENS = ['running', 'pending', 'progress', 'queued', 'waiting', 'start'];

function hasAnyToken(value: string, tokens: readonly string[]): boolean {
  return tokens.some(token => value.includes(token));
}

function getStatusColor(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (hasAnyToken(normalized, SUCCESS_STATUS_TOKENS)) {
    return 'success.main';
  }
  if (hasAnyToken(normalized, ERROR_STATUS_TOKENS)) {
    return 'error.main';
  }
  if (hasAnyToken(normalized, ACTIVE_STATUS_TOKENS)) {
    return 'warning.main';
  }
  return undefined;
}

function WorkflowsDashboard() {
  const renderToolbarActions = useCallback((ctx: DataGridToolbarContext) => {
    const handleCreateWorkflow = () => {
      ctx.postMessage({
        command: 'createWorkflow',
        namespace: ctx.selectedNamespace
      });
    };

    return (
      <VSCodeButton onClick={handleCreateWorkflow}>
        Create Workflow
      </VSCodeButton>
    );
  }, []);

  const renderActions = useCallback((row: unknown[], ctx: DataGridContext) => {
    const { nameIdx, nsIdx, postMessage } = ctx;
    const name = nameIdx >= 0 ? row[nameIdx] : '';
    const namespace = nsIdx >= 0 ? row[nsIdx] : '';
    const kindIdx = ctx.getColumnIndex('kind');
    const apiVersionIdx = ctx.getColumnIndex('apiVersion');
    const kind = kindIdx >= 0 ? row[kindIdx] : '';
    const apiVersion = apiVersionIdx >= 0 ? row[apiVersionIdx] : '';

    const handleViewYaml = () => {
      postMessage({ command: 'viewWorkflowYaml', name, namespace, kind, apiVersion });
    };

    return (
      <Tooltip title="View YAML">
        <span>
          <VSCodeButton variant="icon" size="sm" onClick={handleViewYaml}>
            <CodeIcon fontSize="small" />
          </VSCodeButton>
        </span>
      </Tooltip>
    );
  }, []);

  const renderCell = useCallback((value: string, column: string): React.ReactElement => {
    const statusColor = column === 'workflow-status' ? getStatusColor(value) : undefined;
    return (
      <Box component="span" sx={{ color: statusColor }}>
        {value}
      </Box>
    );
  }, []);

  return (
    <DataGridDashboard<WorkflowsMessage>
      defaultSortColumn="workflow-id"
      defaultSortDirection="desc"
      renderToolbarActions={renderToolbarActions}
      renderActions={renderActions}
      renderCell={renderCell}
    />
  );
}

mountWebview(WorkflowsDashboard);
