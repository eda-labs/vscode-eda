/* global HTMLSelectElement, HTMLInputElement, HTMLElement, HTMLButtonElement */
declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
};

interface ResourceItem {
  name: string;
  kind: string;
}

interface ResourcesMessage {
  command: 'resources';
  list: ResourceItem[];
  selected?: string;
}

interface ResourceDataMessage {
  command: 'resourceData';
  schema: unknown;
  description?: string;
  kind: string;
  yaml: string;
}

interface ErrorMessage {
  command: 'error';
  message: string;
}

type InboundMessage = ResourcesMessage | ResourceDataMessage | ErrorMessage;

interface ReadyMessage {
  command: 'ready';
}

interface ShowResourceMessage {
  command: 'showResource';
  name: string;
}

interface ViewYamlMessage {
  command: 'viewYaml';
  name: string;
}

type OutboundMessage = ReadyMessage | ShowResourceMessage | ViewYamlMessage;
class ResourceBrowserWebview {
  private vscode = acquireVsCodeApi();
  private resourceSelect = document.getElementById('resourceSelect') as HTMLSelectElement;
  private filterInput = document.getElementById('filterInput') as HTMLInputElement;
  private titleEl = document.getElementById('resourceTitle') as HTMLElement;
  private metadataEl = document.getElementById('metadataYaml') as HTMLElement;
  private descEl = document.getElementById('resourceDescription') as HTMLElement;
  private schemaEl = document.getElementById('schema') as HTMLElement;
  private expandBtn = document.getElementById('expandAll') as HTMLButtonElement;
  private collapseBtn = document.getElementById('collapseAll') as HTMLButtonElement;
  private yamlBtn = document.getElementById('yamlBtn') as HTMLButtonElement;

  private allResources: ResourceItem[] = [];

  constructor() {
    this.filterInput.addEventListener('input', () => this.updateOptions());
    this.resourceSelect.addEventListener('change', () =>
      this.postMessage({ command: 'showResource', name: this.resourceSelect.value })
    );
    this.expandBtn.addEventListener('click', () => {
      this.schemaEl.querySelectorAll('details').forEach(d => (d.open = true));
    });
    this.collapseBtn.addEventListener('click', () => {
      this.schemaEl.querySelectorAll('details').forEach(d => (d.open = false));
    });
    this.yamlBtn.addEventListener('click', () =>
      this.postMessage({ command: 'viewYaml', name: this.resourceSelect.value })
    );
    window.addEventListener('message', e => this.handleMessage(e.data as InboundMessage));
    this.postMessage({ command: 'ready' });
  }

  private postMessage(msg: OutboundMessage): void {
    this.vscode.postMessage(msg);
  }

  private handleMessage(msg: InboundMessage): void {
    if (msg.command === 'resources') {
      this.allResources = msg.list;
      this.updateOptions();
      if (msg.selected && this.allResources.some(c => c.name === msg.selected)) {
        this.resourceSelect.value = msg.selected;
        this.postMessage({ command: 'showResource', name: msg.selected });
      } else if (this.allResources.length > 0) {
        this.postMessage({ command: 'showResource', name: this.allResources[0].name });
      }
    } else if (msg.command === 'resourceData') {
      this.renderResource(msg.schema, msg.yaml, msg.kind, msg.description);
    } else if (msg.command === 'error') {
      this.titleEl.textContent = 'Error';
      this.metadataEl.textContent = msg.message;
      this.descEl.textContent = '';
      this.schemaEl.innerHTML = '';
    }
  }

  private updateOptions(): void {
    const filter = this.filterInput.value.toLowerCase();
    this.resourceSelect.innerHTML = '';
    const filtered = this.allResources.filter(c =>
      c.kind.toLowerCase().includes(filter) || c.name.toLowerCase().includes(filter)
    );
    filtered.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.name;
      opt.textContent = `${item.kind} (${item.name})`;
      this.resourceSelect.appendChild(opt);
    });
    if (filtered.length > 0) {
      this.resourceSelect.value = filtered[0].name;
      if (filtered.length === 1) {
        this.postMessage({ command: 'showResource', name: filtered[0].name });
      }
    }
  }

  private renderResource(schema: any, yaml: string, kind: string, description?: string): void {
    this.titleEl.textContent = kind || '';
    this.metadataEl.textContent = yaml;
    this.descEl.textContent = description || '';
    this.schemaEl.innerHTML = '';
    const spec = schema?.properties?.spec;
    const status = schema?.properties?.status;
    if (spec || status) {
      if (spec) {
        this.schemaEl.appendChild(this.renderSection('spec', spec));
      }
      if (status) {
        this.schemaEl.appendChild(this.renderSection('status', status));
      }
    } else if (schema) {
      this.schemaEl.appendChild(this.renderSection('schema', schema));
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

    if (node.description) {
      const p = document.createElement('p');
      p.className = 'section-desc';
      p.textContent = node.description;
      details.appendChild(p);
    }

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

new ResourceBrowserWebview();
