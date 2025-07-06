/* global HTMLSelectElement, HTMLInputElement, HTMLElement, HTMLButtonElement */
declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
};

interface CrdItem {
  name: string;
  kind: string;
}

interface CrdsMessage {
  command: 'crds';
  list: CrdItem[];
  selected?: string;
}

interface CrdDataMessage {
  command: 'crdData';
  crd: unknown;
  yaml: string;
}

interface ErrorMessage {
  command: 'error';
  message: string;
}

type InboundMessage = CrdsMessage | CrdDataMessage | ErrorMessage;

interface ReadyMessage {
  command: 'ready';
}

interface ShowCrdMessage {
  command: 'showCrd';
  name: string;
}

interface ViewYamlMessage {
  command: 'viewYaml';
  name: string;
}

type OutboundMessage = ReadyMessage | ShowCrdMessage | ViewYamlMessage;

class CrdBrowserWebview {
  private vscode = acquireVsCodeApi();
  private crdSelect = document.getElementById('crdSelect') as HTMLSelectElement;
  private filterInput = document.getElementById('filterInput') as HTMLInputElement;
  private titleEl = document.getElementById('crdTitle') as HTMLElement;
  private metadataEl = document.getElementById('metadataYaml') as HTMLElement;
  private descEl = document.getElementById('crdDescription') as HTMLElement;
  private schemaEl = document.getElementById('schema') as HTMLElement;
  private expandBtn = document.getElementById('expandAll') as HTMLButtonElement;
  private collapseBtn = document.getElementById('collapseAll') as HTMLButtonElement;
  private yamlBtn = document.getElementById('yamlBtn') as HTMLButtonElement;

  private allCrds: CrdItem[] = [];

  constructor() {
    this.filterInput.addEventListener('input', () => this.updateOptions());
    this.crdSelect.addEventListener('change', () =>
      this.postMessage({ command: 'showCrd', name: this.crdSelect.value })
    );
    this.expandBtn.addEventListener('click', () => {
      this.schemaEl.querySelectorAll('details').forEach(d => (d.open = true));
    });
    this.collapseBtn.addEventListener('click', () => {
      this.schemaEl.querySelectorAll('details').forEach(d => (d.open = false));
    });
    this.yamlBtn.addEventListener('click', () =>
      this.postMessage({ command: 'viewYaml', name: this.crdSelect.value })
    );
    window.addEventListener('message', e => this.handleMessage(e.data as InboundMessage));
    this.postMessage({ command: 'ready' });
  }

  private postMessage(msg: OutboundMessage): void {
    this.vscode.postMessage(msg);
  }

  private handleMessage(msg: InboundMessage): void {
    if (msg.command === 'crds') {
      this.allCrds = msg.list;
      this.updateOptions();
      if (msg.selected && this.allCrds.some(c => c.name === msg.selected)) {
        this.crdSelect.value = msg.selected;
        this.postMessage({ command: 'showCrd', name: msg.selected });
      } else if (this.allCrds.length > 0) {
        this.postMessage({ command: 'showCrd', name: this.allCrds[0].name });
      }
    } else if (msg.command === 'crdData') {
      this.renderCrd(msg.crd, msg.yaml);
    } else if (msg.command === 'error') {
      this.titleEl.textContent = 'Error';
      this.metadataEl.textContent = msg.message;
      this.descEl.textContent = '';
      this.schemaEl.innerHTML = '';
    }
  }

  private updateOptions(): void {
    const filter = this.filterInput.value.toLowerCase();
    this.crdSelect.innerHTML = '';
    const filtered = this.allCrds.filter(c =>
      c.kind.toLowerCase().includes(filter) || c.name.toLowerCase().includes(filter)
    );
    filtered.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.name;
      opt.textContent = `${item.kind} (${item.name})`;
      this.crdSelect.appendChild(opt);
    });
    if (filtered.length > 0) {
      this.crdSelect.value = filtered[0].name;
    }
  }

  private renderCrd(crd: any, yaml: string): void {
    this.titleEl.textContent = crd.spec?.names?.kind || crd.metadata?.name || '';
    this.metadataEl.textContent = yaml;
    this.descEl.textContent =
      crd.spec?.versions?.[0]?.schema?.openAPIV3Schema?.description || '';
    this.schemaEl.innerHTML = '';
    const root = crd.spec?.versions?.[0]?.schema?.openAPIV3Schema;
    if (!root) return;
    const spec = root.properties?.spec;
    const status = root.properties?.status;
    if (spec) {
      this.schemaEl.appendChild(this.renderSection('spec', spec));
    }
    if (status) {
      this.schemaEl.appendChild(this.renderSection('status', status));
    }
  }

  private renderSection(name: string, node: any): HTMLElement {
    const details = document.createElement('details');
    details.open = true;
    details.className = 'schema-section';
    const summary = document.createElement('summary');
    summary.className = 'section-header';

    const label = document.createElement('span');
    label.textContent = name;
    summary.appendChild(label);

    const badge = document.createElement('span');
    badge.className = 'type-badge';
    badge.textContent = node.type || (node.properties ? 'object' : '');
    summary.appendChild(badge);

    details.appendChild(summary);
    details.appendChild(this.buildSchema(node, node.required || []));
    return details;
  }

  private buildSchema(node: any, required: string[]): HTMLElement {
    const container = document.createElement('div');
    const props = node.properties || {};
    Object.entries(props).forEach(([key, val]) => {
      container.appendChild(this.renderProp(key, val, (required || []).includes(key)));
    });
    return container;
  }

  private renderProp(name: string, node: any, isReq: boolean): HTMLElement {
    const details = document.createElement('details');
    details.className = 'schema-card';
    const summary = document.createElement('summary');
    summary.className = 'prop-header';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'prop-name';
    nameSpan.textContent = name;
    summary.appendChild(nameSpan);
    if (isReq) {
      const req = document.createElement('span');
      req.className = 'required';
      req.textContent = 'required';
      summary.appendChild(req);
    }
    const typeSpan = document.createElement('span');
    typeSpan.className = 'prop-type';
    const t = node.type || (node.properties ? 'object' : '');
    typeSpan.textContent = t;
    summary.appendChild(typeSpan);
    details.appendChild(summary);

    if (node.description) {
      const p = document.createElement('p');
      p.className = 'prop-desc';
      p.textContent = node.description;
      details.appendChild(p);
    }

    if (node.properties) {
      const child = this.buildSchema(node, node.required || []);
      child.className = 'schema-children';
      details.appendChild(child);
    } else if (node.items && node.items.properties) {
      const child = this.buildSchema(node.items, node.items.required || []);
      child.className = 'schema-children';
      details.appendChild(child);
    }

    return details;
  }
}

new CrdBrowserWebview();
