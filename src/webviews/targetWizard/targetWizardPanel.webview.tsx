import React, { useState, useCallback, useMemo } from 'react';

import { usePostMessage, useMessageListener, useReadySignal } from '../shared/hooks';
import { VSCodeButton } from '../shared/components';
import { mountWebview } from '../shared/utils';

// Constants for repeated values
const DEFAULT_CORE_NAMESPACE = 'eda-system';
const DEFAULT_EDA_USERNAME = 'admin';
const FIELD_REQUIRED_ERROR = 'This field is required';
const INPUT_BASE_CLASSES = 'w-full px-3 py-2 text-vscode-input-fg bg-vscode-input-bg border border-vscode-input-border rounded-sm text-sm';
const INPUT_ERROR_CLASSES = 'border-(--vscode-inputValidation-errorBorder)';

// Helper to build input class string with optional error state
function getInputClasses(hasError: boolean, extraClasses = ''): string {
  return `${INPUT_BASE_CLASSES} ${hasError ? INPUT_ERROR_CLASSES : ''} ${extraClasses}`.trim();
}

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
    <div
      className={`cursor-pointer border-b border-vscode-border px-4 py-3 transition-colors hover:bg-vscode-bg-hover ${isSelected ? 'bg-(--vscode-list-activeSelectionBackground) text-(--vscode-list-activeSelectionForeground)' : ''}`}
      onClick={onClick}
    >
      <div className="font-medium mb-1 break-all">{target.url}</div>
      <div className="text-xs text-vscode-text-secondary flex items-center gap-2">
        {target.context && <span className="italic">{target.context}</span>}
        {isSelected && (
          <span className="bg-(--vscode-badge-background) text-(--vscode-badge-foreground) px-2 rounded-full text-[0.7rem] font-medium">
            Default
          </span>
        )}
        {target.skipTlsVerify && (
          <span className="bg-(--vscode-badge-background) text-(--vscode-badge-foreground) px-2 rounded-full text-[0.7rem] font-medium">
            Skip TLS
          </span>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value, placeholder }: Readonly<{ label: string; value?: string; placeholder?: string }>) {
  return (
    <div className="mb-5">
      <div className="text-sm font-medium text-vscode-text-secondary mb-1">{label}</div>
      <div className={`text-sm px-3 py-2 bg-vscode-input-bg border border-vscode-input-border rounded-sm break-all ${!value && placeholder ? 'text-vscode-text-secondary italic' : ''}`}>
        {value || placeholder || ''}
      </div>
    </div>
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
    <div>
      <label className="block text-sm font-medium">
        {label} {required && <span className="text-status-error">*</span>}
        {!required && <span className="text-vscode-text-secondary text-xs">(optional)</span>}
      </label>
      {children}
      {error && <span className="text-xs text-status-error mt-1">{error}</span>}
      {hint && <span className="text-xs text-vscode-text-secondary mt-1 block">{hint}</span>}
    </div>
  );
}

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  showPassword: boolean;
  onToggleShow: () => void;
  hasError: boolean;
  placeholder?: string;
  extraClasses?: string;
}

function PasswordInput({ value, onChange, showPassword, onToggleShow, hasError, placeholder, extraClasses = '' }: Readonly<PasswordInputProps>) {
  return (
    <div className="relative">
      <input
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={getInputClasses(hasError, `pr-8 ${extraClasses}`)}
      />
      <button
        type="button"
        onClick={onToggleShow}
        className="absolute top-1/2 right-2 -translate-y-1/2 bg-transparent border-none cursor-pointer p-1"
      >
        {showPassword ? '🙈' : '👁'}
      </button>
    </div>
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

      <div className="flex gap-3 pt-4 mt-6 border-t border-vscode-border">
        <VSCodeButton variant="secondary" onClick={onEdit}>Edit</VSCodeButton>
        <button
          className="px-4 py-2 rounded-sm font-medium text-sm cursor-pointer transition-colors bg-status-error text-vscode-bg-primary border-none hover:opacity-90"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
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
    <div className="space-y-4 p-6 max-w-125">
      <FormField label="EDA API URL" required error={errors.url}>
        <input
          type="text"
          value={formData.url}
          onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
          placeholder="https://eda.example.com"
          className={getInputClasses(Boolean(errors.url))}
        />
      </FormField>

      <FormField label="Kubernetes Context">
        <select
          value={formData.context}
          onChange={(e) => setFormData(prev => ({ ...prev, context: e.target.value }))}
          className={INPUT_BASE_CLASSES}
        >
          <option value="">None</option>
          {contexts.map(ctx => <option key={ctx} value={ctx}>{ctx}</option>)}
        </select>
      </FormField>

      <FormField label="EDA Core Namespace" required error={errors.coreNs}>
        <input
          type="text"
          value={formData.coreNs}
          onChange={(e) => setFormData(prev => ({ ...prev, coreNs: e.target.value }))}
          className={getInputClasses(Boolean(errors.coreNs))}
        />
      </FormField>

      <FormField label="EDA Username" required error={errors.edaUser}>
        <input
          type="text"
          value={formData.edaUser}
          onChange={(e) => setFormData(prev => ({ ...prev, edaUser: e.target.value }))}
          className={getInputClasses(Boolean(errors.edaUser))}
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
        <div className="flex gap-2">
          <div className="flex-1">
            <PasswordInput
              value={formData.clientSecret}
              onChange={(val) => setFormData(prev => ({ ...prev, clientSecret: val }))}
              showPassword={formUI.showClientSecret}
              onToggleShow={() => setFormUI(prev => ({ ...prev, showClientSecret: !prev.showClientSecret }))}
              hasError={Boolean(errors.clientSecret)}
              placeholder="Client secret for OAuth2 authentication"
            />
          </div>
          <VSCodeButton variant="secondary" onClick={onRetrieveSecret}>Retrieve</VSCodeButton>
        </div>
      </FormField>

      <div>
        <label className="block text-sm font-medium">
          <input
            type="checkbox"
            checked={formData.skipTls}
            onChange={(e) => setFormData(prev => ({ ...prev, skipTls: e.target.checked }))}
            className="mr-1"
          />
          Skip TLS Verification
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-4 mt-6 border-t border-vscode-border">
        <VSCodeButton variant="secondary" onClick={onCancel}>Cancel</VSCodeButton>
        <VSCodeButton onClick={onSave}>Save</VSCodeButton>
      </div>
    </div>
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

  const handleSetDefault = useCallback((idx: number) => {
    setSelectedIdx(idx);
    postMessage({ command: 'select', index: idx });
  }, [postMessage]);

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
    <div className="p-6">
      <div className="flex flex-col items-center justify-center mb-8 w-full">
        {logoUri && <img src={logoUri} alt="EDA" className="w-36 h-auto block" />}
        <div className="mt-2 text-sm font-medium">Nokia Event-Driven Automation</div>
      </div>

      <div className="flex flex-col gap-6 md:flex-row max-w-7xl mx-auto items-start">
        {/* Left Pane: Target List */}
        <div className="flex flex-col flex-none w-96 bg-vscode-bg-widget border border-vscode-border rounded-lg overflow-hidden">
          <div className="flex justify-between items-center p-4 border-b border-vscode-border bg-(--vscode-editorGroupHeader-tabsBackground)">
            <h3 className="text-base font-semibold">EDA Targets</h3>
            <VSCodeButton onClick={handleAddNew}>Add New</VSCodeButton>
          </div>
          <div className="flex-1 py-2">
            {targets.length === 0 ? (
              <div className="py-10 px-4 text-center text-vscode-text-secondary italic">
                No targets configured yet.
              </div>
            ) : (
              targets.map((target, idx) => (
                <TargetItem
                  key={idx}
                  target={target}
                  isSelected={idx === selectedIdx}
                  onClick={() => handleSelectTarget(idx)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right Pane: Details/Form */}
        <div className="flex flex-col flex-1 bg-vscode-bg-primary border border-vscode-border rounded-lg overflow-hidden">
          <div className="flex justify-between items-center p-4 border-b border-vscode-border bg-(--vscode-editorGroupHeader-tabsBackground)">
            <h3 className="text-base font-semibold">
              {mode === 'new' && 'Add New Target'}
              {mode === 'edit' && 'Edit Target'}
              {mode === 'view' && 'Target Details'}
            </h3>
            {mode === 'view' && currentTarget && selectedIdx !== targets.indexOf(currentTarget) && (
              <VSCodeButton variant="secondary" onClick={() => handleSetDefault(targets.indexOf(currentTarget))}>
                Set as Default
              </VSCodeButton>
            )}
          </div>

          {mode === 'view' ? (
            <div className="p-6 max-w-125">
              {currentTarget ? (
                <TargetDetailsView
                  target={currentTarget}
                  onEdit={() => handleEdit(selectedIdx)}
                  onDelete={() => handleDelete(selectedIdx)}
                />
              ) : (
                <div className="flex items-center justify-center h-48 text-center">
                  <p className="text-gray-500">Select a target to view details, or add a new target to get started.</p>
                </div>
              )}
            </div>
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
        </div>
      </div>
    </div>
  );
}

mountWebview(TargetWizardPanel);
