import React, { useState, useCallback, useMemo } from 'react';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import {
  Button,
  Box,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';

import { usePostMessage, useMessageListener, useReadySignal } from '../shared/hooks';
import { mountWebview } from '../shared/utils';

// Constants for repeated values
const DEFAULT_CORE_NAMESPACE = 'eda-system';
const DEFAULT_EDA_USERNAME = 'admin';
const FIELD_REQUIRED_ERROR = 'This field is required';

interface Target {
  url: string;
  context?: string;
  coreNamespace?: string;
  edaUsername?: string;
  edaPassword?: string;
  clientSecret?: string;
  skipTlsVerify?: boolean;
}

interface TargetWizardMessage {
  command: string;
  targets?: Target[];
  selected?: number;
  contexts?: string[];
  logoUri?: string;
  index?: number;
  clientSecret?: string;
}

type Mode = 'view' | 'edit' | 'new';

interface FormData {
  url: string;
  context: string;
  coreNs: string;
  edaUser: string;
  edaPass: string;
  clientSecret: string;
  skipTls: boolean;
}

interface FormUIState {
  showEdaPass: boolean;
  showClientSecret: boolean;
  edaPassHint: string;
  clientSecretHint: string;
}

const initialFormData: FormData = {
  url: '',
  context: '',
  coreNs: DEFAULT_CORE_NAMESPACE,
  edaUser: DEFAULT_EDA_USERNAME,
  edaPass: '',
  clientSecret: '',
  skipTls: false
};

const initialFormUIState: FormUIState = {
  showEdaPass: false,
  showClientSecret: false,
  edaPassHint: '',
  clientSecretHint: 'Leave empty to auto-retrieve from Keycloak'
};

// Message handler functions extracted for clarity
function handleInitMessage(
  msg: TargetWizardMessage,
  setTargets: React.Dispatch<React.SetStateAction<Target[]>>,
  setSelectedIdx: React.Dispatch<React.SetStateAction<number>>,
  setDefaultIdx: React.Dispatch<React.SetStateAction<number>>,
  setContexts: React.Dispatch<React.SetStateAction<string[]>>,
  setLogoUri: React.Dispatch<React.SetStateAction<string>>
): void {
  const selected = msg.selected ?? 0;
  setTargets(msg.targets ?? []);
  setSelectedIdx(selected);
  setDefaultIdx(selected);
  setContexts(msg.contexts ?? []);
  setLogoUri(msg.logoUri ?? '');
}

function handleDeleteConfirmedMessage(
  msg: TargetWizardMessage,
  setTargets: React.Dispatch<React.SetStateAction<Target[]>>,
  setSelectedIdx: React.Dispatch<React.SetStateAction<number>>,
  setDefaultIdx: React.Dispatch<React.SetStateAction<number>>,
  setMode: React.Dispatch<React.SetStateAction<Mode>>
): void {
  const idx = msg.index ?? 0;
  setTargets(prev => {
    const newTargets = [...prev];
    newTargets.splice(idx, 1);
    return newTargets;
  });
  setSelectedIdx(prev => Math.max(0, prev >= idx ? prev - 1 : prev));
  setDefaultIdx(prev => Math.max(0, prev >= idx ? prev - 1 : prev));
  setMode('view');
}

function handleClientSecretRetrievedMessage(
  msg: TargetWizardMessage,
  setFormData: React.Dispatch<React.SetStateAction<FormData>>,
  setFormUI: React.Dispatch<React.SetStateAction<FormUIState>>
): void {
  setFormData(prev => ({ ...prev, clientSecret: msg.clientSecret ?? '' }));
  setFormUI(prev => ({ ...prev, clientSecretHint: 'Client secret retrieved successfully' }));
}

function TargetItem({
  target,
  isSelected,
  isDefault,
  onClick,
  onSetDefault
}: Readonly<{
  target: Target;
  isSelected: boolean;
  isDefault: boolean;
  onClick: () => void;
  onSetDefault: () => void;
}>) {
  return (
    <ListItemButton selected={isSelected} onClick={onClick} divider>
      <ListItemText
        primary={
          <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-all' }}>
            {target.url}
          </Typography>
        }
        secondary={
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.25, flexWrap: 'wrap' }}>
            {target.context && <Typography variant="caption" sx={{ fontStyle: 'italic' }}>{target.context}</Typography>}
            {isDefault && <Chip size="small" color="primary" label="Default" />}
            {target.skipTlsVerify && <Chip size="small" variant="outlined" label="Skip TLS" />}
            {!isDefault && (
              <Button
                size="small"
                variant="contained"
                onClick={(event) => {
                  event.stopPropagation();
                  onSetDefault();
                }}
                sx={{
                  bgcolor: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                  border: '1px solid var(--vscode-button-background)',
                  '&:hover': {
                    bgcolor: 'var(--vscode-button-hoverBackground, var(--vscode-button-background))',
                    borderColor: 'var(--vscode-button-hoverBackground, var(--vscode-button-background))'
                  }
                }}
              >
                Set as Default
              </Button>
            )}
          </Stack>
        }
      />
    </ListItemButton>
  );
}

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

function FormField({ label, required, error, hint, children }: Readonly<FormFieldProps>) {
  const helperText = error || hint;

  return (
    <Stack spacing={0.75}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
        {label}
        {required ? ' *' : ''}
      </Typography>
      {children}
      {helperText && <FormHelperText error={Boolean(error)}>{helperText}</FormHelperText>}
    </Stack>
  );
}

interface ReadOnlyFieldProps {
  label: string;
  value?: string;
  placeholder?: string;
}

function ReadOnlyField({ label, value, placeholder = 'Not configured' }: Readonly<ReadOnlyFieldProps>) {
  return (
    <FormField label={label}>
      <TextField
        size="small"
        fullWidth
        value={value ?? ''}
        placeholder={placeholder}
        slotProps={{
          input: { readOnly: true }
        }}
      />
    </FormField>
  );
}

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  showPassword: boolean;
  onToggleShow: () => void;
  hasError: boolean;
  placeholder?: string;
}

function PasswordInput({ value, onChange, showPassword, onToggleShow, hasError, placeholder }: Readonly<PasswordInputProps>) {
  return (
    <TextField
      type={showPassword ? 'text' : 'password'}
      size="small"
      fullWidth
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      error={hasError}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" onClick={onToggleShow}>
                {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </IconButton>
            </InputAdornment>
          )
        }
      }}
    />
  );
}

interface TargetDetailsViewProps {
  target: Target;
  onEdit: () => void;
  onDelete: () => void;
}

function TargetDetailsView({ target, onEdit, onDelete }: Readonly<TargetDetailsViewProps>) {
  return (
    <Stack spacing={2.25} sx={{ maxWidth: 760 }}>
      <ReadOnlyField label="EDA API URL" value={target.url} />
      <ReadOnlyField label="Kubernetes Context" value={target.context} placeholder="None" />
      <ReadOnlyField label="EDA Core Namespace" value={target.coreNamespace || DEFAULT_CORE_NAMESPACE} />
      <ReadOnlyField label="EDA Username" value={target.edaUsername || DEFAULT_EDA_USERNAME} />
      <ReadOnlyField label="EDA Password" value={target.edaPassword ? 'Configured' : ''} />
      <ReadOnlyField label="Client Secret" value={target.clientSecret ? 'Configured' : ''} />
      <ReadOnlyField label="Skip TLS Verification" value={target.skipTlsVerify ? 'Enabled' : 'Disabled'} />

      <Divider />

      <Stack direction="row" spacing={1.5} justifyContent="flex-end">
        <Button variant="contained" startIcon={<EditIcon />} onClick={onEdit}>
          Edit Target
        </Button>
        <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={onDelete}>
          Delete Target
        </Button>
      </Stack>
    </Stack>
  );
}

interface TargetFormProps {
  formData: FormData;
  setFormData: React.Dispatch<React.SetStateAction<FormData>>;
  formUI: FormUIState;
  setFormUI: React.Dispatch<React.SetStateAction<FormUIState>>;
  errors: Record<string, string>;
  contexts: string[];
  onSave: () => void;
  onCancel: () => void;
  onRetrieveSecret: () => void;
}

function TargetForm({
  formData,
  setFormData,
  formUI,
  setFormUI,
  errors,
  contexts,
  onSave,
  onCancel,
  onRetrieveSecret
}: Readonly<TargetFormProps>) {
  return (
    <Stack spacing={2.25} sx={{ p: 2.5, maxWidth: 760 }}>
      <FormField label="EDA API URL" required error={errors.url}>
        <TextField
          size="small"
          fullWidth
          value={formData.url}
          onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
          placeholder="https://eda.example.com"
          error={Boolean(errors.url)}
        />
      </FormField>

      <FormField label="Kubernetes Context">
        <TextField
          select
          size="small"
          fullWidth
          value={formData.context}
          onChange={(e) => setFormData(prev => ({ ...prev, context: e.target.value }))}
        >
          <MenuItem value="">None</MenuItem>
          {contexts.map(ctx => <MenuItem key={ctx} value={ctx}>{ctx}</MenuItem>)}
        </TextField>
      </FormField>

      <FormField label="EDA Core Namespace" required error={errors.coreNs}>
        <TextField
          size="small"
          fullWidth
          value={formData.coreNs}
          onChange={(e) => setFormData(prev => ({ ...prev, coreNs: e.target.value }))}
          error={Boolean(errors.coreNs)}
        />
      </FormField>

      <FormField label="EDA Username" required error={errors.edaUser}>
        <TextField
          size="small"
          fullWidth
          value={formData.edaUser}
          onChange={(e) => setFormData(prev => ({ ...prev, edaUser: e.target.value }))}
          error={Boolean(errors.edaUser)}
        />
      </FormField>

      <FormField label="EDA Password" required error={errors.edaPass} hint={formUI.edaPassHint}>
        <PasswordInput
          value={formData.edaPass}
          onChange={(val) => setFormData(prev => ({ ...prev, edaPass: val }))}
          showPassword={formUI.showEdaPass}
          onToggleShow={() => setFormUI(prev => ({ ...prev, showEdaPass: !prev.showEdaPass }))}
          hasError={Boolean(errors.edaPass)}
        />
      </FormField>

      <FormField label="Client Secret" required error={errors.clientSecret} hint={formUI.clientSecretHint}>
        <Stack direction="row" spacing={1}>
          <Box sx={{ flex: 1 }}>
            <PasswordInput
              value={formData.clientSecret}
              onChange={(val) => setFormData(prev => ({ ...prev, clientSecret: val }))}
              showPassword={formUI.showClientSecret}
              onToggleShow={() => setFormUI(prev => ({ ...prev, showClientSecret: !prev.showClientSecret }))}
              hasError={Boolean(errors.clientSecret)}
              placeholder="Client secret for OAuth2 authentication"
            />
          </Box>
          <Button variant="contained" color="primary" onClick={onRetrieveSecret} sx={{ minWidth: 96 }}>
            Retrieve
          </Button>
        </Stack>
      </FormField>

      <Box
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          px: 1.25,
          py: 0.75,
          bgcolor: 'background.default'
        }}
      >
        <FormControlLabel
          sx={{ m: 0 }}
          control={
            <Checkbox
              color="primary"
              checked={formData.skipTls}
              onChange={(e) => setFormData(prev => ({ ...prev, skipTls: e.target.checked }))}
              sx={{ '&.Mui-checked': { color: 'primary.main' } }}
            />
          }
          label={<Typography variant="body2">Skip TLS Verification</Typography>}
        />
      </Box>

      <Divider />

      <Stack direction="row" spacing={1.5} justifyContent="flex-end">
        <Button variant="contained" color="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={onSave}>Save Target</Button>
      </Stack>
    </Stack>
  );
}

function TargetWizardPanel() {
  const postMessage = usePostMessage();
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [defaultIdx, setDefaultIdx] = useState(0);
  const [contexts, setContexts] = useState<string[]>([]);
  const [logoUri, setLogoUri] = useState('');
  const [mode, setMode] = useState<Mode>('view');
  const [editIndex, setEditIndex] = useState<number | null>(null);

  // Consolidated form state
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [formUI, setFormUI] = useState<FormUIState>(initialFormUIState);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useReadySignal();

  useMessageListener<TargetWizardMessage>(useCallback((msg) => {
    switch (msg.command) {
      case 'init':
        handleInitMessage(msg, setTargets, setSelectedIdx, setDefaultIdx, setContexts, setLogoUri);
        break;
      case 'deleteConfirmed':
        handleDeleteConfirmedMessage(msg, setTargets, setSelectedIdx, setDefaultIdx, setMode);
        break;
      case 'clientSecretRetrieved':
        handleClientSecretRetrievedMessage(msg, setFormData, setFormUI);
        break;
    }
  }, []));

  const currentTarget = useMemo(() => {
    return targets[selectedIdx] ?? null;
  }, [targets, selectedIdx]);

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.url.trim()) newErrors.url = FIELD_REQUIRED_ERROR;
    if (!formData.coreNs.trim()) newErrors.coreNs = FIELD_REQUIRED_ERROR;
    if (!formData.edaUser.trim()) newErrors.edaUser = FIELD_REQUIRED_ERROR;
    if (!formData.edaPass.trim()) newErrors.edaPass = FIELD_REQUIRED_ERROR;
    if (!formData.clientSecret.trim()) newErrors.clientSecret = FIELD_REQUIRED_ERROR;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleSelectTarget = useCallback((idx: number) => {
    if (mode !== 'view') return;
    setSelectedIdx(idx);
  }, [mode]);

  const handleSetDefault = useCallback((idx: number) => {
    setDefaultIdx(idx);
    postMessage({ command: 'select', index: idx });
  }, [postMessage]);

  const handleAddNew = useCallback(() => {
    setMode('new');
    setEditIndex(null);
    setFormData(initialFormData);
    setFormUI({ ...initialFormUIState, clientSecretHint: 'Click Retrieve to fetch from Keycloak' });
    setErrors({});
  }, []);

  const handleEdit = useCallback((idx: number) => {
    const target = targets[idx];
    setMode('edit');
    setEditIndex(idx);
    setFormData({
      url: target.url,
      context: target.context ?? '',
      coreNs: target.coreNamespace ?? DEFAULT_CORE_NAMESPACE,
      edaUser: target.edaUsername ?? DEFAULT_EDA_USERNAME,
      edaPass: target.edaPassword ?? '',
      clientSecret: target.clientSecret ?? '',
      skipTls: target.skipTlsVerify ?? false
    });
    setFormUI({
      showEdaPass: false,
      showClientSecret: false,
      edaPassHint: target.edaPassword ? 'Loaded from secret storage' : '',
      clientSecretHint: target.clientSecret ? 'Loaded from secret storage' : 'Leave empty to auto-retrieve from Keycloak'
    });
    setErrors({});
  }, [targets]);

  const handleCancel = useCallback(() => {
    setMode('view');
    setEditIndex(null);
    setErrors({});
  }, []);

  const handleDelete = useCallback((idx: number) => {
    postMessage({ command: 'confirmDelete', index: idx, url: targets[idx].url });
  }, [postMessage, targets]);

  const handleRetrieveSecret = useCallback(() => {
    if (!formData.url.trim()) {
      window.alert('Please enter EDA API URL first');
      return;
    }
    postMessage({ command: 'retrieveClientSecret', url: formData.url });
  }, [formData.url, postMessage]);

  const handleSave = useCallback(() => {
    if (!validateForm()) return;

    const newTarget: Target = {
      url: formData.url.trim(),
      context: formData.context || undefined,
      coreNamespace: formData.coreNs.trim(),
      edaUsername: formData.edaUser.trim(),
      skipTlsVerify: formData.skipTls || undefined
    };

    let newTargets = [...targets];
    let newSelectedIdx = selectedIdx;
    let newDefaultIdx = defaultIdx;

    if (editIndex !== null) {
      newTargets[editIndex] = newTarget;
      postMessage({
        command: 'save',
        url: formData.url,
        context: formData.context,
        edaUsername: formData.edaUser,
        edaPassword: formData.edaPass,
        clientSecret: formData.clientSecret,
        skipTlsVerify: formData.skipTls,
        coreNamespace: formData.coreNs,
        originalUrl: targets[editIndex].url,
        index: editIndex
      });
    } else {
      newTargets.push(newTarget);
      newSelectedIdx = newTargets.length - 1;
      if (targets.length === 0) {
        newDefaultIdx = newSelectedIdx;
        postMessage({ command: 'select', index: newSelectedIdx });
      }
      postMessage({
        command: 'add',
        url: formData.url,
        context: formData.context,
        edaUsername: formData.edaUser,
        edaPassword: formData.edaPass,
        clientSecret: formData.clientSecret,
        skipTlsVerify: formData.skipTls,
        coreNamespace: formData.coreNs,
        index: null
      });
    }

    postMessage({ command: 'commit', targets: newTargets });
    setTargets(newTargets);
    setSelectedIdx(newSelectedIdx);
    setDefaultIdx(newDefaultIdx);
    setMode('view');
    setEditIndex(null);
  }, [validateForm, formData, targets, editIndex, selectedIdx, defaultIdx, postMessage]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} alignItems="flex-start" sx={{ maxWidth: 1600, mx: 'auto' }}>
        <Card variant="outlined" sx={{ width: { xs: '100%', lg: 420 }, flexShrink: 0 }}>
          <CardContent sx={{ p: 0 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
              <Stack direction="row" spacing={1} alignItems="center">
                {logoUri && (
                  <Box
                    component="img"
                    src={logoUri}
                    alt="EDA"
                    sx={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }}
                  />
                )}
                <Typography variant="h6">EDA Targets</Typography>
              </Stack>
              <Button variant="contained" size="small" startIcon={<AddIcon fontSize="small" />} onClick={handleAddNew}>
                Add New
              </Button>
            </Stack>
            {targets.length === 0 ? (
              <Typography sx={{ p: 3 }} color="text.secondary">No targets configured yet.</Typography>
            ) : (
              <List disablePadding>
                {targets.map((target, idx) => (
                  <TargetItem
                    key={idx}
                    target={target}
                    isSelected={idx === selectedIdx}
                    isDefault={idx === defaultIdx}
                    onClick={() => handleSelectTarget(idx)}
                    onSetDefault={() => handleSetDefault(idx)}
                  />
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ flex: 1, width: '100%', maxWidth: { xs: '100%', lg: 860 } }}>
          <CardContent sx={{ p: 0 }}>
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="h6">
                {mode === 'new' && 'Add New Target'}
                {mode === 'edit' && 'Edit Target'}
                {mode === 'view' && 'Target Details'}
              </Typography>
            </Box>

            {mode === 'view' ? (
              <Box sx={{ p: 2.5 }}>
                {currentTarget ? (
                  <TargetDetailsView
                    target={currentTarget}
                    onEdit={() => handleEdit(selectedIdx)}
                    onDelete={() => handleDelete(selectedIdx)}
                  />
                ) : (
                  <Box sx={{ py: 8, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                      Select a target to view details, or add a new target to get started.
                    </Typography>
                  </Box>
                )}
              </Box>
            ) : (
              <TargetForm
                formData={formData}
                setFormData={setFormData}
                formUI={formUI}
                setFormUI={setFormUI}
                errors={errors}
                contexts={contexts}
                onSave={handleSave}
                onCancel={handleCancel}
                onRetrieveSecret={handleRetrieveSecret}
              />
            )}
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}

mountWebview(TargetWizardPanel);
