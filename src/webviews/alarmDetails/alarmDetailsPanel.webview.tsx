import React, { useState, useCallback } from 'react';
import BuildIcon from '@mui/icons-material/Build';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DataObjectIcon from '@mui/icons-material/DataObject';
import DescriptionIcon from '@mui/icons-material/Description';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Box, Card, CardContent, Chip, Grid, Stack, Typography } from '@mui/material';

import { usePostMessage, useMessageListener, useReadySignal, useCopyToClipboard } from '../shared/hooks';
import { LoadingOverlay, VSCodeButton } from '../shared/components';
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
      return 'error.main';
    case 'major':
      return 'warning.main';
    case 'minor':
    case 'warning':
      return 'info.main';
    case 'info':
      return 'success.main';
    default:
      return 'info.main';
  }
}

function SummaryItem({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.25, wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Box>
  );
}

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
        <Typography variant="body2">{children}</Typography>
      </CardContent>
    </Card>
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
      copyToClipboard(data.rawJson).catch(() => {});
    }
  }, [data, postMessage, copyToClipboard]);

  if (!data) {
    return <LoadingOverlay message="Loading..." />;
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
          Alarm <Typography component="span" color="primary.main" variant="h5">{data.name}</Typography>
        </Typography>

        <Card variant="outlined">
          <CardContent>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Kind" value={data.kind} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Type" value={data.type} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Severity
                </Typography>
                <Box sx={{ mt: 0.5 }}>
                  <Chip
                    size="small"
                    label={data.severity}
                    sx={{ color: 'common.white', bgcolor: getSeverityColor(data.severity) }}
                  />
                </Box>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Namespace" value={data.namespace} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Group" value={data.group} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Source Group" value={data.sourceGroup} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Source Kind" value={data.sourceKind} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Source Resource" value={data.sourceResource} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Parent Alarm" value={data.parentAlarm} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Cluster Specific" value={data.clusterSpecific} /></Grid>
              <Grid size={{ xs: 12, md: 6 }}><SummaryItem label="Jspath" value={data.jspath} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Resource" value={data.resource} /></Grid>
            </Grid>
          </CardContent>
        </Card>
      </Box>

      {data.probableCause && (
        <Section icon={<WarningAmberIcon color="warning" />} title="Probable Cause">
          {data.probableCause}
        </Section>
      )}

      {data.remedialAction && (
        <Section icon={<BuildIcon color="info" />} title="Remedial Action">
          {data.remedialAction}
        </Section>
      )}

      {data.description && (
        <Section icon={<DescriptionIcon color="primary" />} title="Description">
          {data.description}
        </Section>
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

mountWebview(AlarmDetailsPanel);
