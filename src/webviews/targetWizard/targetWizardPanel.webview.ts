/// <reference lib="dom" />

/* eslint-env browser */

declare function acquireVsCodeApi(): { postMessage: (msg: any) => void };

interface DeleteConfirmedMessage {
  command: 'deleteConfirmed';
  index: number;
}

class TargetWizardWebview {
  private readonly vscode = acquireVsCodeApi();
  private readonly targets: any[] = [];
  private selectedIdx = 0;
  private editIndex: number | null = null;
  private mode: 'view' | 'edit' | 'new' = 'view';

  constructor() {
    const dataEl = document.getElementById('initialData') as HTMLScriptElement | null;
    if (dataEl?.textContent) {
      try {
        const data = JSON.parse(dataEl.textContent) as { targets: any[]; selected: number };
        this.targets.push(...data.targets);
        this.selectedIdx = data.selected;
      } catch {
        /* ignore */
      }
    }

    this.initialize();
  }

  private initialize(): void {
    this.renderTargetsList();
    if (this.targets.length > 0 && this.selectedIdx < this.targets.length) {
      this.showTargetDetails(this.targets[this.selectedIdx]);
    } else {
      this.showEmptyDetails();
    }

    document.getElementById('addNew')?.addEventListener('click', () => this.addNewTarget());
    document.getElementById('save')?.addEventListener('click', () => this.saveTarget());
    document.getElementById('cancel')?.addEventListener('click', () => this.cancelForm());

    document.querySelectorAll('input').forEach(input => {
      input.addEventListener('keypress', e => {
        if ((e as KeyboardEvent).key === 'Enter') {
          this.saveTarget();
        }
      });
    });

    this.setupToggle('edaPass', 'toggleEdaPass');
    this.setupToggle('clientSecret', 'toggleClientSecret');
    this.setupValidation();

    document.getElementById('retrieveSecret')?.addEventListener('click', () => this.retrieveClientSecret());

    window.addEventListener('message', e => this.handleMessage(e.data as DeleteConfirmedMessage));
  }

  private handleMessage(msg: any): void {
    if (msg.command === 'deleteConfirmed') {
      this.performDelete(msg.index);
    } else if (msg.command === 'clientSecretRetrieved') {
      (document.getElementById('clientSecret') as HTMLInputElement).value = msg.clientSecret;
      (document.getElementById('clientSecretHint') as HTMLElement).textContent = 'Client secret retrieved successfully';
    }
  }

  private renderTargetsList(): void {
    const listContainer = document.getElementById('targetsList') as HTMLElement;
    listContainer.innerHTML = '';

    if (this.targets.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className =
        'py-10 px-4 text-center text-[var(--vscode-descriptionForeground)] italic';
      emptyState.textContent = 'No targets configured yet.';
      listContainer.appendChild(emptyState);
      return;
    }

    this.targets.forEach((target, idx) => {
      const item = document.createElement('div');
      item.className =
        'target-item cursor-pointer border-b border-[var(--vscode-panel-border)] px-4 py-3 relative transition-colors hover:bg-[var(--vscode-list-hoverBackground)]' +
        (idx === this.selectedIdx
          ? ' bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)] selected'
          : '');
      item.dataset.index = String(idx);

      const url = document.createElement('div');
      url.className = 'font-medium mb-1 break-all';
      url.textContent = target.url;

      const meta = document.createElement('div');
      meta.className = 'text-xs text-[var(--vscode-descriptionForeground)] flex items-center gap-2';

      if (target.context) {
        const context = document.createElement('span');
        context.className = 'italic';
        context.textContent = target.context;
        meta.appendChild(context);
      }

      if (idx === this.selectedIdx) {
        const badge = document.createElement('span');
        badge.className = 'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] px-2 rounded-full text-[0.7rem] font-medium';
        badge.textContent = 'Default';
        meta.appendChild(badge);
      }

      if (target.skipTlsVerify) {
        const tls = document.createElement('span');
        tls.className = 'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] px-2 rounded-full text-[0.7rem] font-medium';
        tls.textContent = 'Skip TLS';
        meta.appendChild(tls);
      }

      item.appendChild(url);
      item.appendChild(meta);
      item.addEventListener('click', () => this.selectTarget(idx));
      listContainer.appendChild(item);
    });
  }

  private selectTarget(idx: number): void {
    if (this.mode === 'edit' || this.mode === 'new') return;
    this.selectedIdx = idx;
    this.vscode.postMessage({ command: 'select', index: idx });
    this.renderTargetsList();
    this.showTargetDetails(this.targets[idx]);
  }

  private showTargetDetails(target: any): void {
    this.mode = 'view';
    this.editIndex = null;

    const detailsTitle = document.getElementById('detailsTitle') as HTMLElement;
    const detailsContent = document.getElementById('detailsContent') as HTMLElement;
    const formContainer = document.getElementById('formContainer') as HTMLElement;
    const setDefaultBtn = document.getElementById('setDefault') as HTMLButtonElement;

    detailsTitle.textContent = 'Target Details';
    detailsContent.style.display = 'block';
    formContainer.style.display = 'none';

    const currentIdx = this.targets.indexOf(target);
    if (currentIdx !== this.selectedIdx) {
      setDefaultBtn.style.display = 'inline-block';
      setDefaultBtn.onclick = () => {
        this.selectedIdx = currentIdx;
        this.vscode.postMessage({ command: 'select', index: currentIdx });
        this.renderTargetsList();
        this.showTargetDetails(target);
      };
    } else {
      setDefaultBtn.style.display = 'none';
    }

    detailsContent.innerHTML = '';
    const detailsEl = this.generateDetailsElement(target);
    detailsContent.appendChild(detailsEl);

    const editBtn = detailsEl.querySelector('.edit-btn');
    const deleteBtn = detailsEl.querySelector('.delete-btn');
    if (editBtn) editBtn.addEventListener('click', () => this.editTarget(currentIdx));
    if (deleteBtn) deleteBtn.addEventListener('click', () => this.requestDelete(currentIdx));
  }

  private generateDetailsElement(target: any): HTMLElement {
    const container = document.createElement('div');
    container.className = 'max-w-[500px] pl-4';

    const addRow = (label: string, value?: string, placeholder?: string) => {
      const wrap = document.createElement('div');
      wrap.className = 'mb-5';

      const lbl = document.createElement('div');
      lbl.className = 'text-sm font-medium text-[var(--vscode-descriptionForeground)] mb-1';
      lbl.textContent = label;
      wrap.appendChild(lbl);

      const val = document.createElement('div');
      val.className = 'text-sm px-3 py-2 bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] rounded break-all';
      if (placeholder && !value) {
        val.classList.add('text-[var(--vscode-descriptionForeground)]', 'italic');
        val.textContent = placeholder;
      } else {
        val.textContent = value ?? '';
      }
      wrap.appendChild(val);
      container.appendChild(wrap);
    };

    addRow('EDA API URL', target.url);
    addRow('Kubernetes Context', target.context, 'None');
    addRow('EDA Core Namespace', target.coreNamespace || 'eda-system');
    addRow('EDA Username', target.edaUsername || 'admin');
    addRow('EDA Password', target.edaPassword ? '••••••••' : '', 'Not configured');
    addRow('Client Secret', target.clientSecret ? '••••••••' : '', 'Not configured');
    addRow('Skip TLS Verification', target.skipTlsVerify ? 'Yes' : 'No');

    const actions = document.createElement('div');
    actions.className = 'flex gap-3 pt-4 mt-6 border-t border-[var(--vscode-panel-border)]';

    const edit = document.createElement('button');
    edit.className =
      'px-4 py-2 rounded font-medium text-sm cursor-pointer transition-colors bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] border border-[var(--vscode-button-border)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] edit-btn';
    edit.textContent = 'Edit';
    actions.appendChild(edit);

    const del = document.createElement('button');
    del.className =
      'px-4 py-2 rounded font-medium text-sm cursor-pointer transition-colors bg-[var(--vscode-errorForeground)] text-[var(--vscode-editor-background)] border-none hover:opacity-90 delete-btn';
    del.textContent = 'Delete';
    actions.appendChild(del);

    container.appendChild(actions);
    return container;
  }

  private showEmptyDetails(): void {
    const detailsTitle = document.getElementById('detailsTitle') as HTMLElement;
    const detailsContent = document.getElementById('detailsContent') as HTMLElement;
    const formContainer = document.getElementById('formContainer') as HTMLElement;
    const setDefaultBtn = document.getElementById('setDefault') as HTMLButtonElement;

    detailsTitle.textContent = 'Target Details';
    detailsContent.style.display = 'block';
    formContainer.style.display = 'none';
    setDefaultBtn.style.display = 'none';

    detailsContent.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-details';
    const p = document.createElement('p');
    p.className = 'text-gray-500';
    p.textContent = 'Select a target to view details, or add a new target to get started.';
    empty.appendChild(p);
    detailsContent.appendChild(empty);
  }

  private editTarget(idx: number): void {
    this.mode = 'edit';
    this.editIndex = idx;
    const target = this.targets[idx];

    this.showForm('Edit Target');
    this.populateForm(target);
  }

  private addNewTarget(): void {
    this.mode = 'new';
    this.editIndex = null;

    this.showForm('Add New Target');
    this.clearForm();
  }

  private showForm(title: string): void {
    const detailsTitle = document.getElementById('detailsTitle') as HTMLElement;
    const detailsContent = document.getElementById('detailsContent') as HTMLElement;
    const formContainer = document.getElementById('formContainer') as HTMLElement;
    const setDefaultBtn = document.getElementById('setDefault') as HTMLButtonElement;

    detailsTitle.textContent = title;
    detailsContent.style.display = 'none';
    formContainer.style.display = 'block';
    setDefaultBtn.style.display = 'none';

    // Reset validation state
    this.resetValidationState();
  }

  private populateForm(target: any): void {
    (document.getElementById('url') as HTMLInputElement).value = target.url || '';
    (document.getElementById('context') as HTMLSelectElement).value = target.context || '';
    (document.getElementById('coreNs') as HTMLInputElement).value = target.coreNamespace || 'eda-system';
    (document.getElementById('edaUser') as HTMLInputElement).value = target.edaUsername || 'admin';
    (document.getElementById('edaPass') as HTMLInputElement).value = target.edaPassword || '';
    (document.getElementById('clientSecret') as HTMLInputElement).value = target.clientSecret || '';
    (document.getElementById('edaPassHint') as HTMLElement).textContent = target.edaPassword ? 'Loaded from secret storage' : '';
    (document.getElementById('clientSecretHint') as HTMLElement).textContent = target.clientSecret ? 'Loaded from secret storage' : 'Leave empty to auto-retrieve from Keycloak';
    (document.getElementById('skipTls') as HTMLInputElement).checked = !!target.skipTlsVerify;
  }

  private clearForm(): void {
    (document.getElementById('url') as HTMLInputElement).value = '';
    (document.getElementById('context') as HTMLSelectElement).value = '';
    (document.getElementById('coreNs') as HTMLInputElement).value = 'eda-system';
    (document.getElementById('edaUser') as HTMLInputElement).value = 'admin';
    (document.getElementById('edaPass') as HTMLInputElement).value = '';
    (document.getElementById('clientSecret') as HTMLInputElement).value = '';
    (document.getElementById('edaPassHint') as HTMLElement).textContent = '';
    (document.getElementById('clientSecretHint') as HTMLElement).textContent = 'Click Retrieve to fetch from Keycloak';
    (document.getElementById('skipTls') as HTMLInputElement).checked = false;
  }

  private cancelForm(): void {
    this.mode = 'view';
    this.editIndex = null;

    if (this.targets.length > 0 && this.selectedIdx < this.targets.length) {
      this.showTargetDetails(this.targets[this.selectedIdx]);
    } else {
      this.showEmptyDetails();
    }
  }

  private requestDelete(idx: number): void {
    this.vscode.postMessage({ command: 'confirmDelete', index: idx, url: this.targets[idx].url });
  }

  private performDelete(idx: number): void {
    this.targets.splice(idx, 1);

    if (this.selectedIdx === idx) {
      this.selectedIdx = Math.max(0, Math.min(this.selectedIdx, this.targets.length - 1));
      this.vscode.postMessage({ command: 'select', index: this.selectedIdx });
    } else if (this.selectedIdx > idx) {
      this.selectedIdx--;
      this.vscode.postMessage({ command: 'select', index: this.selectedIdx });
    }

    this.renderTargetsList();

    if (this.targets.length > 0) {
      this.showTargetDetails(this.targets[this.selectedIdx]);
    } else {
      this.showEmptyDetails();
    }

    this.vscode.postMessage({ command: 'commit', targets: this.targets });
  }

  private sendData(command: string): void {
    const url = (document.getElementById('url') as HTMLInputElement).value.trim();
    const coreNamespace = (document.getElementById('coreNs') as HTMLInputElement).value.trim();
    const edaUsername = (document.getElementById('edaUser') as HTMLInputElement).value.trim();
    const edaPassword = (document.getElementById('edaPass') as HTMLInputElement).value.trim();
    const clientSecret = (document.getElementById('clientSecret') as HTMLInputElement).value.trim();

    // Validate required fields
    const missingFields: string[] = [];
    if (!url) missingFields.push('EDA API URL');
    if (!coreNamespace) missingFields.push('EDA Core Namespace');
    if (!edaUsername) missingFields.push('EDA Username');
    if (!edaPassword) missingFields.push('EDA Password');
    if (!clientSecret) missingFields.push('Client Secret');

    if (missingFields.length > 0) {
      this.validateAllFields();
      const firstErrorField = document.querySelector('input.error') as HTMLInputElement;
      if (firstErrorField) {
        firstErrorField.focus();
      }
      return;
    }

    const context = (document.getElementById('context') as HTMLSelectElement).value;
    const skipTlsVerify = (document.getElementById('skipTls') as HTMLInputElement).checked;
    const originalUrl = this.editIndex !== null ? this.targets[this.editIndex].url : null;

    this.vscode.postMessage({
      command,
      url,
      context,
      edaUsername,
      edaPassword,
      clientSecret,
      skipTlsVerify,
      coreNamespace,
      originalUrl,
      index: this.editIndex
    });
  }

  private saveTarget(): void {
    const url = (document.getElementById('url') as HTMLInputElement).value.trim();
    const coreNamespace = (document.getElementById('coreNs') as HTMLInputElement).value.trim();
    const edaUsername = (document.getElementById('edaUser') as HTMLInputElement).value.trim();
    const edaPassword = (document.getElementById('edaPass') as HTMLInputElement).value.trim();
    const clientSecret = (document.getElementById('clientSecret') as HTMLInputElement).value.trim();

    // Validate required fields
    const missingFields: string[] = [];
    if (!url) missingFields.push('EDA API URL');
    if (!coreNamespace) missingFields.push('EDA Core Namespace');
    if (!edaUsername) missingFields.push('EDA Username');
    if (!edaPassword) missingFields.push('EDA Password');
    if (!clientSecret) missingFields.push('Client Secret');

    if (missingFields.length > 0) {
      this.validateAllFields();
      const firstErrorField = document.querySelector('input.error') as HTMLInputElement;
      if (firstErrorField) {
        firstErrorField.focus();
      }
      return;
    }

    const item = {
      url,
      context: (document.getElementById('context') as HTMLSelectElement).value || undefined,
      coreNamespace,
      edaUsername,
      skipTlsVerify: (document.getElementById('skipTls') as HTMLInputElement).checked || undefined
    } as any;

    if (this.editIndex !== null) {
      this.targets[this.editIndex] = item;
      this.sendData('save');
    } else {
      this.targets.push(item);
      this.sendData('add');
      this.selectedIdx = this.targets.length - 1;
      this.vscode.postMessage({ command: 'select', index: this.selectedIdx });
    }

    this.vscode.postMessage({ command: 'commit', targets: this.targets });

    this.renderTargetsList();
    this.showTargetDetails(this.targets[this.selectedIdx]);

    (document.getElementById('edaPassHint') as HTMLElement).textContent = '';
    (document.getElementById('clientSecretHint') as HTMLElement).textContent = '';
  }

  private retrieveClientSecret(): void {
    const url = (document.getElementById('url') as HTMLInputElement).value.trim();
    if (!url) {
      window.alert('Please enter EDA API URL first');
      return;
    }

    this.vscode.postMessage({
      command: 'retrieveClientSecret',
      url
    });
  }

  private setupToggle(id: string, toggleId: string): void {
    const input = document.getElementById(id) as HTMLInputElement;
    const btn = document.getElementById(toggleId) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
        btn.setAttribute('aria-label', 'Hide password');
      } else {
        input.type = 'password';
        btn.textContent = '👁';
        btn.setAttribute('aria-label', 'Show password');
      }
    });
  }

  private setupValidation(): void {
    const requiredFields = [
      { id: 'url', errorId: 'urlError', name: 'EDA API URL' },
      { id: 'coreNs', errorId: 'coreNsError', name: 'EDA Core Namespace' },
      { id: 'edaUser', errorId: 'edaUserError', name: 'EDA Username' },
      { id: 'edaPass', errorId: 'edaPassError', name: 'EDA Password' },
      { id: 'clientSecret', errorId: 'clientSecretError', name: 'Client Secret' }
    ];

    requiredFields.forEach(field => {
      const input = document.getElementById(field.id) as HTMLInputElement;
      const errorSpan = document.getElementById(field.errorId) as HTMLSpanElement;

      input.addEventListener('blur', () => {
        this.validateField(input, errorSpan);
      });

      input.addEventListener('input', () => {
        if (input.classList.contains('error')) {
          this.validateField(input, errorSpan);
        }
      });
    });
  }

  private validateField(input: HTMLInputElement, errorSpan: HTMLSpanElement): boolean {
    const value = input.value.trim();
    if (!value) {
      input.classList.add('error');
      errorSpan.classList.remove('hidden');
      errorSpan.classList.add('field-error');
      return false;
    } else {
      input.classList.remove('error');
      errorSpan.classList.add('hidden');
      errorSpan.classList.remove('field-error');
      return true;
    }
  }

  private validateAllFields(): boolean {
    const requiredFields = [
      { id: 'url', errorId: 'urlError' },
      { id: 'coreNs', errorId: 'coreNsError' },
      { id: 'edaUser', errorId: 'edaUserError' },
      { id: 'edaPass', errorId: 'edaPassError' },
      { id: 'clientSecret', errorId: 'clientSecretError' }
    ];

    let isValid = true;
    requiredFields.forEach(field => {
      const input = document.getElementById(field.id) as HTMLInputElement;
      const errorSpan = document.getElementById(field.errorId) as HTMLSpanElement;
      if (!this.validateField(input, errorSpan)) {
        isValid = false;
      }
    });

    return isValid;
  }

  private resetValidationState(): void {
    const requiredFields = [
      { id: 'url', errorId: 'urlError' },
      { id: 'coreNs', errorId: 'coreNsError' },
      { id: 'edaUser', errorId: 'edaUserError' },
      { id: 'edaPass', errorId: 'edaPassError' },
      { id: 'clientSecret', errorId: 'clientSecretError' }
    ];

    requiredFields.forEach(field => {
      const input = document.getElementById(field.id) as HTMLInputElement;
      const errorSpan = document.getElementById(field.errorId) as HTMLSpanElement;
      input.classList.remove('error');
      errorSpan.classList.add('hidden');
      errorSpan.classList.remove('field-error');
    });
  }
}

new TargetWizardWebview();

export {};
