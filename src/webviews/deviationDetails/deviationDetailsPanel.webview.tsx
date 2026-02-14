import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DataObjectIcon from '@mui/icons-material/DataObject';
import DifferenceIcon from '@mui/icons-material/Difference';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Stack,
  Typography
} from '@mui/material';
import { useCallback, useState, type ReactNode } from 'react';

import { useCopyToClipboard, useMessageListener, usePostMessage, useReadySignal } from '../shared/hooks';
import { LoadingOverlay, VSCodeButton } from '../shared/components';
import { mountWebview } from '../shared/utils';

interface DeviationDetailsData {
  name: string;
  namespace: string;
  kind: string;
  apiVersion: string;
  status: string;
  valueDiff?: string;
  resourceYaml?: string;
  errorMessage?: string;
  rawJson: string;
}

interface DeviationDetailsMessage {
  command: string;
  data?: DeviationDetailsData;
}

function statusColor(status: string | undefined): 'error' | 'warning' | 'success' | 'default' {
  const value = (status || '').toLowerCase();
  if (value.includes('reject') || value.includes('error')) {
    return 'error';
  }
  if (value.includes('accept') || value.includes('resolved')) {
    return 'success';
  }
  if (value.length > 0) {
    return 'warning';
  }
  return 'default';
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

interface CodeBlockCardProps {
  icon: ReactNode;
  title: string;
  text: string;
  onCopy: () => void;
  copied: boolean;
  maxHeight?: number;
}

function CodeBlockCard({
  icon,
  title,
  text,
  onCopy,
  copied,
  maxHeight = 460
}: Readonly<CodeBlockCardProps>) {
  return (
    <Card variant="outlined" sx={{ mb: 2.5 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            {icon}
            <Typography variant="h6">{title}</Typography>
          </Stack>
          <VSCodeButton onClick={onCopy} size="sm">
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
            maxHeight,
            p: 1.5,
            bgcolor: 'background.default',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            m: 0
          }}
        >
          {text}
        </Box>
      </CardContent>
    </Card>
  );
}

function DeviationDetailsView() {
  const postMessage = usePostMessage();
  const [data, setData] = useState<DeviationDetailsData | null>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const { copyToClipboard } = useCopyToClipboard();

  useReadySignal();

  useMessageListener<DeviationDetailsMessage>(useCallback((message) => {
    if (message.command === 'init' && message.data) {
      setData(message.data);
      setCopiedSection(null);
    }
  }, []));

  const copyText = useCallback((section: string, text: string) => {
    postMessage({ command: 'copy', text });
    copyToClipboard(text).catch(() => {});
    setCopiedSection(section);
  }, [copyToClipboard, postMessage]);

  if (!data) {
    return <LoadingOverlay message="Loading..." />;
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
          Deviation <Typography component="span" color="primary.main" variant="h5">{data.name}</Typography>
        </Typography>

        <Card variant="outlined">
          <CardContent>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Namespace" value={data.namespace} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="Kind" value={data.kind} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><SummaryItem label="API Version" value={data.apiVersion} /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Status
                </Typography>
                <Box sx={{ mt: 0.5 }}>
                  <Chip size="small" label={data.status || 'Unknown'} color={statusColor(data.status)} />
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      </Box>

      {data.errorMessage && (
        <Alert severity="error" icon={<ErrorOutlineIcon />} sx={{ mb: 2.5 }}>
          {data.errorMessage}
        </Alert>
      )}

      {data.valueDiff && (
        <CodeBlockCard
          icon={<DifferenceIcon />}
          title="Intended vs Running Diff"
          text={data.valueDiff}
          onCopy={() => copyText('diff', data.valueDiff || '')}
          copied={copiedSection === 'diff'}
          maxHeight={360}
        />
      )}

      {data.resourceYaml && (
        <CodeBlockCard
          icon={<WarningAmberIcon color="warning" />}
          title="Deviation YAML"
          text={data.resourceYaml}
          onCopy={() => copyText('yaml', data.resourceYaml || '')}
          copied={copiedSection === 'yaml'}
        />
      )}

      <CodeBlockCard
        icon={<DataObjectIcon />}
        title="Raw JSON"
        text={data.rawJson}
        onCopy={() => copyText('json', data.rawJson)}
        copied={copiedSection === 'json'}
      />
    </Box>
  );
}

mountWebview(DeviationDetailsView);
