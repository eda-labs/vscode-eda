import { useState, useCallback, useMemo } from 'react';

import { usePostMessage, useMessageListener, useReadySignal } from '../shared/hooks';
import { VSCodeButton } from '../shared/components';
import { mountWebview } from '../shared/utils';

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
  coreNs: 'eda-system',
  edaUser: 'admin',
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

function TargetItem({ target, isSelected, onClick }: { target: Target; isSelected: boolean; onClick: () => void }) {
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

function DetailRow({ label, value, placeholder }: { label: string; value?: string; placeholder?: string }) {
  return (
    <div className="mb-5">
      <div className="text-sm font-medium text-vscode-text-secondary mb-1">{label}</div>
      <div className={`text-sm px-3 py-2 bg-vscode-input-bg border border-vscode-input-border rounded-sm break-all ${!value && placeholder ? 'text-vscode-text-secondary italic' : ''}`}>
        {value || placeholder || ''}
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
    if (msg.command === 'init') {
      setTargets(msg.targets ?? []);
      setSelectedIdx(msg.selected ?? 0);
      setContexts(msg.contexts ?? []);
      setLogoUri(msg.logoUri ?? '');
    } else if (msg.command === 'deleteConfirmed') {
      const idx = msg.index ?? 0;
      setTargets(prev => {
        const newTargets = [...prev];
        newTargets.splice(idx, 1);
        return newTargets;
      });
      setSelectedIdx(prev => Math.max(0, prev >= idx ? prev - 1 : prev));
      setMode('view');
    } else if (msg.command === 'clientSecretRetrieved') {
      setFormData(prev => ({ ...prev, clientSecret: msg.clientSecret ?? '' }));
      setFormUI(prev => ({ ...prev, clientSecretHint: 'Client secret retrieved successfully' }));
    }
  }, []));

  const currentTarget = useMemo(() => {
    return targets[selectedIdx] ?? null;
  }, [targets, selectedIdx]);

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.url.trim()) newErrors.url = 'This field is required';
    if (!formData.coreNs.trim()) newErrors.coreNs = 'This field is required';
    if (!formData.edaUser.trim()) newErrors.edaUser = 'This field is required';
    if (!formData.edaPass.trim()) newErrors.edaPass = 'This field is required';
    if (!formData.clientSecret.trim()) newErrors.clientSecret = 'This field is required';
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
      coreNs: target.coreNamespace ?? 'eda-system',
      edaUser: target.edaUsername ?? 'admin',
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
                <>
                  <DetailRow label="EDA API URL" value={currentTarget.url} />
                  <DetailRow label="Kubernetes Context" value={currentTarget.context} placeholder="None" />
                  <DetailRow label="EDA Core Namespace" value={currentTarget.coreNamespace || 'eda-system'} />
                  <DetailRow label="EDA Username" value={currentTarget.edaUsername || 'admin'} />
                  <DetailRow label="EDA Password" value={currentTarget.edaPassword ? '••••••••' : ''} placeholder="Not configured" />
                  <DetailRow label="Client Secret" value={currentTarget.clientSecret ? '••••••••' : ''} placeholder="Not configured" />
                  <DetailRow label="Skip TLS Verification" value={currentTarget.skipTlsVerify ? 'Yes' : 'No'} />

                  <div className="flex gap-3 pt-4 mt-6 border-t border-vscode-border">
                    <VSCodeButton variant="secondary" onClick={() => handleEdit(selectedIdx)}>Edit</VSCodeButton>
                    <button
                      className="px-4 py-2 rounded-sm font-medium text-sm cursor-pointer transition-colors bg-status-error text-vscode-bg-primary border-none hover:opacity-90"
                      onClick={() => handleDelete(selectedIdx)}
                    >
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-48 text-center">
                  <p className="text-gray-500">Select a target to view details, or add a new target to get started.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 p-6 max-w-125">
              <div>
                <label className="block text-sm font-medium">EDA API URL <span className="text-status-error">*</span></label>
                <input
                  type="text"
                  value={formData.url}
                  onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
                  placeholder="https://eda.example.com"
                  className={`w-full px-3 py-2 text-vscode-input-fg bg-vscode-input-bg border border-vscode-input-border rounded-sm text-sm ${errors.url ? 'border-(--vscode-inputValidation-errorBorder)' : ''}`}
                />
                {errors.url && <span className="text-xs text-status-error mt-1">{errors.url}</span>}
              </div>

              <div>
                <label className="block text-sm font-medium">Kubernetes Context <span className="text-vscode-text-secondary text-xs">(optional)</span></label>
                <select
                  value={formData.context}
                  onChange={(e) => setFormData(prev => ({ ...prev, context: e.target.value }))}
                  className="w-full px-3 py-2 text-vscode-input-fg bg-vscode-input-bg border border-vscode-input-border rounded-sm text-sm"
                >
                  <option value="">None</option>
                  {contexts.map(ctx => <option key={ctx} value={ctx}>{ctx}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium">EDA Core Namespace <span className="text-status-error">*</span></label>
                <input
                  type="text"
                  value={formData.coreNs}
                  onChange={(e) => setFormData(prev => ({ ...prev, coreNs: e.target.value }))}
                  className={`w-full px-3 py-2 text-vscode-input-fg bg-vscode-input-bg border border-vscode-input-border rounded-sm text-sm ${errors.coreNs ? 'border-(--vscode-inputValidation-errorBorder)' : ''}`}
                />
                {errors.coreNs && <span className="text-xs text-status-error mt-1">{errors.coreNs}</span>}
              </div>

              <div>
                <label className="block text-sm font-medium">EDA Username <span className="text-status-error">*</span></label>
                <input
                  type="text"
                  value={formData.edaUser}
                  onChange={(e) => setFormData(prev => ({ ...prev, edaUser: e.target.value }))}
                  className={`w-full px-3 py-2 text-vscode-input-fg bg-vscode-input-bg border border-vscode-input-border rounded-sm text-sm ${errors.edaUser ? 'border-(--vscode-inputValidation-errorBorder)' : ''}`}
                />
                {errors.edaUser && <span className="text-xs text-status-error mt-1">{errors.edaUser}</span>}
              </div>

              <div>
                <label className="block text-sm font-medium">EDA Password <span className="text-status-error">*</span></label>
                <div className="relative">
                  <input
                    type={formUI.showEdaPass ? 'text' : 'password'}
                    value={formData.edaPass}
                    onChange={(e) => setFormData(prev => ({ ...prev, edaPass: e.target.value }))}
                    className={`w-full px-3 py-2 pr-8 text-vscode-input-fg bg-vscode-input-bg border border-vscode-input-border rounded-sm text-sm ${errors.edaPass ? 'border-(--vscode-inputValidation-errorBorder)' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={() => setFormUI(prev => ({ ...prev, showEdaPass: !prev.showEdaPass }))}
                    className="absolute top-1/2 right-2 -translate-y-1/2 bg-transparent border-none cursor-pointer p-1"
                  >
                    {formUI.showEdaPass ? '🙈' : '👁'}
                  </button>
                </div>
                {errors.edaPass && <span className="text-xs text-status-error mt-1">{errors.edaPass}</span>}
                {formUI.edaPassHint && <span className="text-xs text-vscode-text-secondary mt-1">{formUI.edaPassHint}</span>}
              </div>

              <div>
                <label className="block text-sm font-medium">Client Secret <span className="text-status-error">*</span></label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={formUI.showClientSecret ? 'text' : 'password'}
                      value={formData.clientSecret}
                      onChange={(e) => setFormData(prev => ({ ...prev, clientSecret: e.target.value }))}
                      placeholder="Client secret for OAuth2 authentication"
                      className={`w-full px-3 py-2 pr-8 text-vscode-input-fg bg-vscode-input-bg border border-vscode-input-border rounded-sm text-sm ${errors.clientSecret ? 'border-(--vscode-inputValidation-errorBorder)' : ''}`}
                    />
                    <button
                      type="button"
                      onClick={() => setFormUI(prev => ({ ...prev, showClientSecret: !prev.showClientSecret }))}
                      className="absolute top-1/2 right-2 -translate-y-1/2 bg-transparent border-none cursor-pointer p-1"
                    >
                      {formUI.showClientSecret ? '🙈' : '👁'}
                    </button>
                  </div>
                  <VSCodeButton variant="secondary" onClick={handleRetrieveSecret}>Retrieve</VSCodeButton>
                </div>
                {errors.clientSecret && <span className="text-xs text-status-error mt-1">{errors.clientSecret}</span>}
                <span className="text-xs text-vscode-text-secondary mt-1 block">{formUI.clientSecretHint}</span>
              </div>

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
                <VSCodeButton variant="secondary" onClick={handleCancel}>Cancel</VSCodeButton>
                <VSCodeButton onClick={handleSave}>Save</VSCodeButton>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

mountWebview(TargetWizardPanel);
