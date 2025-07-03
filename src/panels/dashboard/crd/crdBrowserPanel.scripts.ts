export const crdBrowserScripts = `
  const vscode = acquireVsCodeApi();
  const crdSelect = document.getElementById('crdSelect');
  const filterInput = document.getElementById('filterInput');
  const titleEl = document.getElementById('crdTitle');
  const metadataEl = document.getElementById('metadataYaml');
  const descEl = document.getElementById('crdDescription');
  const schemaEl = document.getElementById('schema');
  const expandBtn = document.getElementById('expandAll');
  const collapseBtn = document.getElementById('collapseAll');
  const yamlBtn = document.getElementById('yamlBtn');

  let allCrds = [];

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.command === 'crds') {
      allCrds = msg.list;
      updateOptions();
      if (msg.selected && allCrds.some(c => c.name === msg.selected)) {
        crdSelect.value = msg.selected;
        vscode.postMessage({ command: 'showCrd', name: msg.selected });
      } else if (allCrds.length > 0) {
        vscode.postMessage({ command: 'showCrd', name: allCrds[0].name });
      }
    } else if (msg.command === 'crdData') {
      renderCrd(msg.crd, msg.yaml);
    } else if (msg.command === 'error') {
      titleEl.textContent = 'Error';
      metadataEl.textContent = msg.message;
      descEl.textContent = '';
      schemaEl.innerHTML = '';
    }
  });

  function updateOptions() {
    const filter = filterInput.value.toLowerCase();
    crdSelect.innerHTML = '';
    const filtered = allCrds.filter(c =>
      c.kind.toLowerCase().includes(filter) || c.name.toLowerCase().includes(filter)
    );
    filtered.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.name;
      opt.textContent = item.kind + ' (' + item.name + ')';
      crdSelect.appendChild(opt);
    });
    if (filtered.length > 0) {
      crdSelect.value = filtered[0].name;
    }
  }

  filterInput.addEventListener('input', updateOptions);

  crdSelect.addEventListener('change', () => {
    vscode.postMessage({ command: 'showCrd', name: crdSelect.value });
  });

  expandBtn.addEventListener('click', () => {
    schemaEl.querySelectorAll('details').forEach(d => (d.open = true));
  });

  collapseBtn.addEventListener('click', () => {
    schemaEl.querySelectorAll('details').forEach(d => (d.open = false));
  });

  yamlBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'viewYaml', name: crdSelect.value });
  });

  function renderCrd(crd, yaml) {
    titleEl.textContent = crd.spec?.names?.kind || crd.metadata?.name || '';
    metadataEl.textContent = yaml;
    descEl.textContent = crd.spec?.versions?.[0]?.schema?.openAPIV3Schema?.description || '';
    schemaEl.innerHTML = '';
    const root = crd.spec?.versions?.[0]?.schema?.openAPIV3Schema;
    if (!root) return;
    const spec = root.properties?.spec;
    const status = root.properties?.status;
    if (spec) {
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = 'spec';
      details.appendChild(summary);
      details.appendChild(buildSchema(spec, spec.required || []));
      schemaEl.appendChild(details);
    }
    if (status) {
      const details = document.createElement('details');
      details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = 'status';
      details.appendChild(summary);
      details.appendChild(buildSchema(status, status.required || []));
      schemaEl.appendChild(details);
    }
  }

  function buildSchema(node, required) {
    const container = document.createElement('div');
    const props = node.properties || {};
    Object.entries(props).forEach(([key, val]) => {
      container.appendChild(renderProp(key, val, (required || []).includes(key)));
    });
    return container;
  }

  function renderProp(name, node, isReq) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
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
      const child = buildSchema(node, node.required || []);
      child.className = 'schema-children';
      details.appendChild(child);
    } else if (node.items && node.items.properties) {
      const child = buildSchema(node.items, node.items.required || []);
      child.className = 'schema-children';
      details.appendChild(child);
    }

    return details;
  }

  vscode.postMessage({ command: 'ready' });
`;
