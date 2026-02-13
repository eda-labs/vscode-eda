import React, { useState, useCallback, useMemo } from 'react';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import {
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
import { VSCodeButton } from '../shared/components';
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
  setContexts: React.Dispatch<React.SetStateAction<string[]>>,
  setLogoUri: React.Dispatch<React.SetStateAction<string>>
): void {
  setTargets(msg.targets ?? []);
  setSelectedIdx(msg.selected ?? 0);
  setContexts(msg.contexts ?? []);
  setLogoUri(msg.logoUri ?? '');
}

function handleDeleteConfirmedMessage(
  msg: TargetWizardMessage,
  setTargets: React.Dispatch<React.SetStateAction<Target[]>>,
  setSelectedIdx: React.Dispatch<React.SetStateAction<number>>,
  setMode: React.Dispatch<React.SetStateAction<Mode>>
): void {
  const idx = msg.index ?? 0;
  setTargets(prev => {
    const newTargets = [...prev];
    newTargets.splice(idx, 1);
    return newTargets;
  });
  setSelectedIdx(prev => Math.max(0, prev >= idx ? prev - 1 : prev));
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

function TargetItem({ target, isSelected, onClick }: Readonly<{ target: Target; isSelected: boolean; onClick: () => void }>) {
  return (
    <ListItemButton selected={isSelected} onClick={onClick} divider>
      <ListItemText
        primary={
          <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-all' }}>
            {target.url}
          </Typography>
        }
        secondary={
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.25 }}>
            {target.context && <Typography variant="caption" sx={{ fontStyle: 'italic' }}>{target.context}</Typography>}
            {isSelected && <Chip size="small" label="Default" />}
            {target.skipTlsVerify && <Chip size="small" variant="outlined" label="Skip TLS" />}
          </Stack>
        }
      />
    </ListItemButton>
  );
}

function DetailRow({ label, value, placeholder }: Readonly<{ label: string; value?: string; placeholder?: string }>) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>{label}</Typography>
      <Typography variant="body2" sx={{ mt: 0.5, wordBreak: 'break-all' }} color={!value && placeholder ? 'text.secondary' : 'text.primary'}>
        {value || placeholder || ''}
      </Typography>
    </Box>
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
  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {label}{' '}
        {required && <Typography component="span" color="error.main">*</Typography>}
        {!required && <Typography component="span" color="text.secondary" variant="caption">(optional)</Typography>}
      </Typography>
      {children}
      {error && <FormHelperText error>{error}</FormHelperText>}
      {hint && <FormHelperText>{hint}</FormHelperText>}
    </Box>
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
    <>
      <DetailRow label="EDA API URL" value={target.url} />
      <DetailRow label="Kubernetes Context" value={target.context} placeholder="None" />
      <DetailRow label="EDA Core Namespace" value={target.coreNamespace || DEFAULT_CORE_NAMESPACE} />
      <DetailRow label="EDA Username" value={target.edaUsername || DEFAULT_EDA_USERNAME} />
      <DetailRow label="EDA Password" value={target.edaPassword ? '••••••••' : ''} placeholder="Not configured" />
      <DetailRow label="Client Secret" value={target.clientSecret ? '••••••••' : ''} placeholder="Not configured" />
      <DetailRow label="Skip TLS Verification" value={target.skipTlsVerify ? 'Yes' : 'No'} />

      <Stack direction="row" spacing={1.5} sx={{ pt: 1 }}>
        <VSCodeButton variant="secondary" onClick={onEdit}>
          <EditIcon fontSize="small" sx={{ mr: 0.5 }} />
          Edit
        </VSCodeButton>
        <VSCodeButton onClick={onDelete}>
          <DeleteIcon fontSize="small" sx={{ mr: 0.5 }} />
          Delete
        </VSCodeButton>
      </Stack>
    </>
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
    <Stack spacing={2} sx={{ p: 2.5, maxWidth: 700 }}>
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
          <VSCodeButton variant="secondary" onClick={onRetrieveSecret}>Retrieve</VSCodeButton>
        </Stack>
      </FormField>

      <FormControlLabel
        control={
          <Checkbox
            checked={formData.skipTls}
            onChange={(e) => setFormData(prev => ({ ...prev, skipTls: e.target.checked }))}
          />
        }
        label="Skip TLS Verification"
      />

      <Divider />

      <Stack direction="row" spacing={1.5} justifyContent="flex-end">
        <VSCodeButton variant="secondary" onClick={onCancel}>Cancel</VSCodeButton>
        <VSCodeButton onClick={onSave}>Save</VSCodeButton>
      </Stack>
    </Stack>
  );
}

function TargetWizardPanel() {
  const postMessage = usePostMessage();
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
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
        handleInitMessage(msg, setTargets, setSelectedIdx, setContexts, setLogoUri);
        break;
      case 'deleteConfirmed':
        handleDeleteConfirmedMessage(msg, setTargets, setSelectedIdx, setMode);
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
    postMessage({ command: 'select', index: idx });
  }, [mode, postMessage]);

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
      postMessage({ command: 'select', index: newSelectedIdx });
    }

    postMessage({ command: 'commit', targets: newTargets });
    setTargets(newTargets);
    setSelectedIdx(newSelectedIdx);
    setMode('view');
    setEditIndex(null);
  }, [validateForm, formData, targets, editIndex, selectedIdx, postMessage]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack alignItems="center" spacing={1} sx={{ mb: 3 }}>
        {logoUri && <Box component="img" src={logoUri} alt="EDA" sx={{ width: 160, height: 'auto' }} />}
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Nokia Event-Driven Automation</Typography>
      </Stack>

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} alignItems="flex-start" sx={{ maxWidth: 1600, mx: 'auto' }}>
        <Card variant="outlined" sx={{ width: { xs: '100%', lg: 420 }, flexShrink: 0 }}>
          <CardContent sx={{ p: 0 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="h6">EDA Targets</Typography>
              <VSCodeButton onClick={handleAddNew}>
                <AddIcon fontSize="small" sx={{ mr: 0.5 }} />
                Add New
              </VSCodeButton>
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
                    onClick={() => handleSelectTarget(idx)}
                  />
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ flex: 1, width: '100%' }}>
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
