import React, { useState, useCallback, useMemo } from 'react';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DataObjectIcon from '@mui/icons-material/DataObject';
import DifferenceIcon from '@mui/icons-material/Difference';
import InputIcon from '@mui/icons-material/Input';
import LanIcon from '@mui/icons-material/Lan';
import ModeEditIcon from '@mui/icons-material/ModeEdit';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography
} from '@mui/material';

import { usePostMessage, useMessageListener, useReadySignal, useCopyToClipboard } from '../shared/hooks';
import { LoadingOverlay, VSCodeButton } from '../shared/components';
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

const COLOR_ERROR = 'error.main' as const;
const COLOR_SUCCESS = 'success.main' as const;

function Section({
  icon,
  title,
  children
}: Readonly<{ icon: React.ReactNode; title: string; children: React.ReactNode }>) {
  return (
    <Card variant="outlined" sx={{ mb: 2.5 }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          {icon}
          <Typography variant="h6">{title}</Typography>
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

function ResourceItem({ path, name, isDelete }: Readonly<{ path: string; name?: string; isDelete?: boolean }>) {
  return (
    <ListItem divider disableGutters sx={{ px: 1 }}>
      <ListItemText
        primary={
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">{path}</Typography>
            {name && <Typography variant="body2" sx={{ fontWeight: 600 }}>{name}</Typography>}
            {isDelete && <Chip size="small" color="error" label="DELETE" />}
          </Stack>
        }
      />
    </ListItem>
  );
}

function NodeItem({ node }: Readonly<{ node: NodeConfig }>) {
  const hasErrors = Boolean(node.errors && node.errors.length > 0);

  return (
    <Card variant="outlined" sx={{ mb: 1.5, borderColor: hasErrors ? COLOR_ERROR : 'divider' }}>
      <CardContent sx={{ py: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: hasErrors ? 1 : 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{node.name}</Typography>
          <Typography variant="caption" color="text.secondary">Namespace: {node.namespace}</Typography>
        </Stack>
        {hasErrors && (
          <Stack spacing={1}>
            {node.errors!.map((err, idx) => (
              <Alert key={idx} severity="error" variant="outlined" sx={{ py: 0 }}>
                {err}
              </Alert>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function ErrorsSummary({ errors }: Readonly<{ errors: ErrorSummary[] }>) {
  if (errors.length === 0) return <></>;

  return (
    <Alert severity="error" sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Errors ({errors.length})</Typography>
      <Stack spacing={1}>
        {errors.map((err, idx) => (
          <Card key={idx} variant="outlined" sx={{ p: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <Chip
                size="small"
                color={err.type === 'Intent Error' ? 'warning' : 'error'}
                label={err.type}
              />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{err.source}</Typography>
              {err.crName && <Typography variant="caption" color="text.secondary">CR: {err.crName}</Typography>}
            </Stack>
            <Typography variant="body2" color="text.secondary">{err.message}</Typography>
          </Card>
        ))}
      </Stack>
    </Alert>
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
      copyToClipboard(data.rawJson).catch(() => {});
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
            const validationMatch = /failed\s+validate:\s*(\S+)\s+error_str:"([^"]*)"\s*cr_name:"([^"]*)"/.exec(err);
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
    return <LoadingOverlay message="Loading..." />;
  }

  const isSuccess = data.success === 'Yes';

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Transaction <Typography component="span" variant="h5" color={isSuccess ? COLOR_SUCCESS : COLOR_ERROR}>#{data.id}</Typography>
          </Typography>
          <VSCodeButton onClick={handleShowDiffs}>
            <DifferenceIcon fontSize="small" sx={{ mr: 0.5 }} />
            Show Diffs
          </VSCodeButton>
        </Stack>

        <ErrorsSummary errors={allErrors} />

        <Card variant="outlined">
          <CardContent>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>State</Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: isSuccess ? COLOR_SUCCESS : COLOR_ERROR }} />
                  <Typography variant="body2">{data.state}</Typography>
                </Stack>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>User</Typography>
                <Typography variant="body2">{data.username}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>Success</Typography>
                <Typography variant="body2" color={isSuccess ? COLOR_SUCCESS : COLOR_ERROR}>{data.success}</Typography>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>Dry Run</Typography>
                <Typography variant="body2">{data.dryRun}</Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>Description</Typography>
                <Typography variant="body2">{data.description}</Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Box>

      {data.deleteResources && data.deleteResources.length > 0 && (
        <Section icon={<DeleteIcon color="error" />} title="Deleted Resources">
          <List dense>
            {data.deleteResources.map((res, idx) => (
              <ResourceItem key={idx} path={res} />
            ))}
          </List>
        </Section>
      )}

      {data.inputCrs && data.inputCrs.length > 0 && (
        <Section icon={<InputIcon color="primary" />} title="Input Resources">
          <List dense>
            {data.inputCrs.map((cr, idx) => (
              <ResourceItem
                key={idx}
                path={`${cr.name?.namespace || 'default'} / ${cr.name?.gvk?.kind || 'Unknown'}`}
                name={cr.name?.name}
                isDelete={cr.isDelete}
              />
            ))}
          </List>
        </Section>
      )}

      {data.changedCrs && data.changedCrs.length > 0 && (
        <Section icon={<ModeEditIcon color="info" />} title="Changed Resources">
          <List dense>
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
          </List>
        </Section>
      )}

      {data.nodesWithConfigChanges && data.nodesWithConfigChanges.length > 0 && (
        <Section icon={<LanIcon color="secondary" />} title="Nodes with Configuration Changes">
          <List disablePadding>
            {data.nodesWithConfigChanges.map((node, idx) => (
              <NodeItem key={idx} node={node} />
            ))}
          </List>
        </Section>
      )}

      {data.generalErrors && (
        <Alert severity="error" icon={<WarningAmberIcon />} sx={{ mb: 2.5 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>General Errors</Typography>
          <Typography variant="body2">{data.generalErrors}</Typography>
        </Alert>
      )}

      <Card variant="outlined" sx={{ mb: 2.5 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <DataObjectIcon />
              <Typography variant="h6">Raw JSON</Typography>
            </Stack>
            <VSCodeButton onClick={handleCopy} size="sm">
              {copied ? (
                <>
                  <CheckIcon fontSize="small" sx={{ mr: 0.5 }} />
                  Copied
                </>
              ) : (
                <>
                  <ContentCopyIcon fontSize="small" sx={{ mr: 0.5 }} />
                  Copy
                </>
              )}
            </VSCodeButton>
          </Stack>
          <Box
            component="pre"
            sx={{
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 420,
              p: 1.5,
              bgcolor: 'background.default',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              m: 0
            }}
          >
            {data.rawJson}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

mountWebview(TransactionDetailsPanel);
