export const topologyDashboardScripts = `
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
              'background-fit': 'contain',
              'background-width': '70%',
              'background-height': '70%',
              'background-position-x': '50%',
              'background-position-y': '50%',
              'shape': 'rectangle',
              'label': 'data(label)',
              'color': getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim(),
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 5,
              'font-size': 12,
              'width': 50,
              'height': 50
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 1,
              'line-color': getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(),
              'target-arrow-shape': 'none',
              'curve-style': 'bezier',
              'control-point-step-size': 20
            }
          }
        ],
        layout: {
          name: 'preset'
        },
        wheelSensitivity: 0.3,
        minZoom: 0.3,
        maxZoom: 3
      });
      
      // Wait for Cytoscape to be ready before initial layout
      cy.ready(() => {
        layoutByTier();
        cy.fit(cy.elements(), 50);
      });
    } else {
      cy.elements().remove();
      cy.add(elements);
      layoutByTier();
      cy.fit(cy.elements(), 50);
    }
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
    
    Object.keys(tiers)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((t, tierIndex) => {
        const nodes = tiers[t];
        const width = (nodes.length - 1) * spacingX;
        nodes.forEach((node, idx) => {
          node.position({
            x: idx * spacingX - width / 2,
            y: tierIndex * spacingY,
          });
        });
      });
  }

  vscode.postMessage({ command: 'ready' });
  
  // Load cytoscape after DOM is ready
  loadScript(cytoscapeUri).then(() => {
    // Cytoscape is now loaded
  });
`;