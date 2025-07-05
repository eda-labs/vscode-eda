export const topologieDashboardScripts = `
  const vscode = acquireVsCodeApi();
  const nsSelect = document.getElementById('namespaceSelect');
  let cy;

  const loadScript = src => {
    const script = document.createElement('script');
    script.src = src;
    document.head.appendChild(script);
    return new Promise(res => { script.onload = res; });
  };

  nsSelect.addEventListener('change', () => {
    vscode.postMessage({ command: 'setNamespace', namespace: nsSelect.value });
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.command === 'init') {
      nsSelect.innerHTML = '';
      msg.namespaces.forEach(ns => {
        const opt = document.createElement('option');
        opt.value = ns;
        opt.textContent = ns;
        nsSelect.appendChild(opt);
      });
      nsSelect.value = msg.selected || msg.namespaces[0] || '';
    } else if (msg.command === 'data') {
      renderTopology(msg.nodes, msg.edges);
    }
  });

  function renderTopology(nodes, edges) {
    const elements = [];
    nodes.forEach(n => {
      elements.push({ group: 'nodes', data: { id: n.id, label: n.label, tier: n.tier } });
    });
    edges.forEach(e => {
      elements.push({ group: 'edges', data: { id: e.source + '--' + e.target, source: e.source, target: e.target } });
    });

    if (!cy) {
      cy = cytoscape({
        container: document.getElementById('cy'),
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': '#60a5fa',
              'background-image': nodeIcon,
              'background-fit': 'cover',
              'label': 'data(label)',
              'color': 'var(--text-primary)',
              'text-valign': 'bottom',
              'text-halign': 'center',
              'font-size': 12,
              'width': 40,
              'height': 40
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 2,
              'line-color': '#888',
              'target-arrow-shape': 'triangle',
              'target-arrow-color': '#888',
              'curve-style': 'bezier'
            }
          }
        ]
      });
    } else {
      cy.elements().remove();
      cy.add(elements);
    }
    layoutByTier();
    cy.fit();
  }

  function layoutByTier() {
    const tiers = {};
    cy.nodes().forEach(n => {
      const t = Number(n.data('tier') || 1);
      if (!tiers[t]) tiers[t] = [];
      tiers[t].push(n);
    });
    const spacingX = 120;
    const spacingY = 120;
    Object.keys(tiers).sort((a,b)=>a-b).forEach(t => {
      const nodes = tiers[t];
      nodes.forEach((node, idx) => {
        node.position({ x: idx * spacingX, y: (t - 1) * spacingY });
      });
    });
  }

  vscode.postMessage({ command: 'ready' });
  loadScript(cytoscapeUri);
`;
