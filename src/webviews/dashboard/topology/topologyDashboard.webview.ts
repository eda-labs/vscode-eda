declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
};

import type cytoscape from 'cytoscape';

interface TopologyNode {
  id: string;
  label: string;
  tier?: number;
  raw?: unknown;
}

interface TopologyEdge {
  source: string;
  target: string;
  sourceInterface?: string;
  targetInterface?: string;
  sourceState?: string;
  targetState?: string;
  state?: string;
  label?: string;
  raw?: unknown;
}

interface InitMessage {
  command: 'init';
  namespaces: string[];
  selected?: string;
}

interface DataMessage {
  command: 'data';
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

type InboundMessage = InitMessage | DataMessage;

interface ReadyMessage {
  command: 'ready';
}

interface SetNamespaceMessage {
  command: 'setNamespace';
  namespace: string;
}

type OutboundMessage = ReadyMessage | SetNamespaceMessage;

class TopologyDashboard {
  private readonly vscode = acquireVsCodeApi();
  private readonly nsSelect = document.getElementById('namespaceSelect') as HTMLSelectElement;
  private readonly toggleLabelBtn = document.getElementById('toggleLabelBtn') as HTMLButtonElement;
  private readonly cytoscapeUri: string;
  private readonly nodeIcon: string;
  private readonly infoCard = document.getElementById('infoCard') as HTMLDivElement;
  private cy?: cytoscape.Core;
  private themeObserver?: MutationObserver;
  private labelsVisible = true;
  private zoomHandlerRegistered = false;

  constructor() {
    const bodyEl = document.body as HTMLBodyElement;
    this.cytoscapeUri = bodyEl.dataset.cytoscapeUri ?? '';
    this.nodeIcon = bodyEl.dataset.nodeIcon ?? '';
    this.registerEvents();
    this.updateToggleButton();
    void this.loadScript(this.cytoscapeUri).then(() => {
      this.postMessage({ command: 'ready' });
    });
  }

  private registerEvents(): void {
    this.nsSelect.addEventListener('change', () => {
      this.postMessage({ command: 'setNamespace', namespace: this.nsSelect.value });
    });

    this.toggleLabelBtn.addEventListener('click', () => {
      this.toggleLinkLabels();
    });

    window.addEventListener('message', event => {
      const msg = event.data as InboundMessage;
      if (msg.command === 'init') {
        this.populateNamespaces(msg.namespaces, msg.selected);
      } else if (msg.command === 'data') {
        this.renderTopology(msg.nodes, msg.edges);
      }
    });

    this.themeObserver = new MutationObserver(() => {
      this.applyThemeColors();
    });
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  private populateNamespaces(namespaces: string[], selected?: string): void {
    this.nsSelect.innerHTML = '';
    namespaces.forEach(ns => {
      const opt = document.createElement('option');
      opt.value = ns;
      opt.textContent = ns;
      this.nsSelect.appendChild(opt);
    });
    this.nsSelect.value = selected ?? namespaces[0] ?? '';
  }

  private shortenInterfaceName(name: string | undefined): string {
    if (!name) return '';
    // Replace ethernet with e- (handle ethernet-1-2 -> e-1-2)
    return name.replace(/ethernet-/gi, 'e-');
  }

  private renderTopology(nodes: TopologyNode[], edges: TopologyEdge[]): void {
    const elements: cytoscape.ElementDefinition[] = [];
    nodes.forEach(n => {
      elements.push({ group: 'nodes', data: { id: n.id, label: n.label, tier: n.tier, raw: n.raw } });
    });
    let edgeCount = 0;
    const pairIndex: Record<string, number> = {};
    edges.forEach(e => {
      const pairKey = `${e.source}|${e.target}`;
      const idx = pairIndex[pairKey] ?? 0;
      pairIndex[pairKey] = idx + 1;

      const sign = idx % 2 === 0 ? 1 : -1;
      const magnitude = Math.floor(idx / 2) + 1;
      const distance = sign * magnitude * 30;

      const idParts = [e.source];
      if (e.sourceInterface) idParts.push(e.sourceInterface);
      idParts.push(e.target);
      if (e.targetInterface) idParts.push(e.targetInterface);
      idParts.push(String(edgeCount++));

      const edgeData: any = {
        // Construct a unique ID to support multiple links between nodes
        id: idParts.join('--'),
        source: e.source,
        target: e.target,
        raw: e.raw,
        dist: distance,
        weight: 0.5
      };

      // Add interface names (shortened)
      if (e.sourceInterface) {
        edgeData.sourceInterface = this.shortenInterfaceName(e.sourceInterface);
      }
      if (e.targetInterface) {
        edgeData.targetInterface = this.shortenInterfaceName(e.targetInterface);
      }

      if (e.state) {
        edgeData.state = e.state;
      }
      if (e.sourceState) {
        edgeData.sourceState = e.sourceState;
      }
      if (e.targetState) {
        edgeData.targetState = e.targetState;
      }
      elements.push({ group: 'edges', data: edgeData });
    });

    if (!this.cy) {
      const win = window as unknown as { cytoscape: (opts: cytoscape.CytoscapeOptions) => cytoscape.Core };
      this.cy = win.cytoscape({
        container: document.getElementById('cy'),
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': '#001135',
              'background-image': this.nodeIcon,
              'background-fit': 'contain',
              'background-clip': 'node',
              'background-width': '55%',
              'background-height': '55%',
              'background-position-y': '-15%',
              'shape': 'rectangle',
              'label': 'data(label)',
              'text-valign': 'center',
              'text-halign': 'center',
              'text-margin-y': 42,
              'font-size': 12,
              'font-weight': 'bold',
              'color': '#ffffff',
              'text-background-color': 'transparent',
              'text-background-opacity': 0,
              'width': 100,
              'height': 100,
              'border-width': 0
            } as any
          },
          {
            selector: 'edge',
            style: {
              'width': 1,
              'target-arrow-shape': 'none',
              'curve-style': 'unbundled-bezier',
              'control-point-distances': 'data(dist)',
              'control-point-weights': 'data(weight)',
              'source-endpoint': 'outside-to-node',
              'target-endpoint': 'outside-to-node'
            } as any
          },
          {
            selector: 'edge[sourceInterface]',
            style: {
              'source-label': 'data(sourceInterface)',
              'source-text-offset': 18,
              'font-size': 9,
              'source-text-background-color': 'white',
              'source-text-background-opacity': 0.9,
              'source-text-background-padding': '2px',
              'source-text-background-shape': 'roundrectangle'
            } as any
          },
          {
            selector: 'edge[targetInterface]',
            style: {
              'target-label': 'data(targetInterface)',
              'target-text-offset': 18,
              'font-size': 9,
              'target-text-background-color': 'white',
              'target-text-background-opacity': 0.9,
              'target-text-background-padding': '2px',
              'target-text-background-shape': 'roundrectangle'
            } as any
          }
        ],
        layout: {
          name: 'preset'
        },
        wheelSensitivity: 0,
        minZoom: 0.3,
        maxZoom: 300
      });

      this.cy.ready(() => {
        this.layoutByTier();
        this.adjustEdgeLabels();
        this.cy!.fit(this.cy!.elements(), 50);
        this.applyThemeColors();
        this.updateEdgeLabelVisibility();
        this.registerCyClickEvents();
      this.registerCustomZoom();
      });
    } else {
      this.cy.elements().remove();
      this.cy.add(elements);
      this.layoutByTier();
      this.adjustEdgeLabels();
      this.cy.fit(this.cy.elements(), 50);
      this.applyThemeColors();
      this.updateEdgeLabelVisibility();
      this.registerCustomZoom();
    }
  }

  private layoutByTier(): void {
    if (!this.cy) return;
    const tiers: Record<string, cytoscape.NodeSingular[]> = {};
    this.cy.nodes().forEach(n => {
      const t = Number(n.data('tier') ?? 1);
      if (!tiers[t]) tiers[t] = [];
      tiers[t].push(n);
    });

    const spacingX = 240; // Increased spacing for larger nodes
    const spacingY = 220; // Increased vertical spacing for larger nodes

    Object.keys(tiers)
      .sort((a, b) => Number(a) - Number(b))
      .forEach((t, tierIndex) => {
        const nodes = tiers[t];
        const width = (nodes.length - 1) * spacingX;
        nodes.forEach((node, idx) => {
          node.position({
            x: idx * spacingX - width / 2,
            y: tierIndex * spacingY
          });
        });
      });
  }

  private adjustEdgeLabels(): void {
    if (!this.cy) return;

    // Adjust labels for each edge
    this.cy.edges().forEach(edge => {
      const sourcePos = edge.source().position();
      const targetPos = edge.target().position();

      // Calculate angle of the edge
      const dx = targetPos.x - sourcePos.x;
      const dy = targetPos.y - sourcePos.y;
      const angle = Math.atan2(dy, dx);
      const angleDeg = Math.abs(angle * 180 / Math.PI);

      // Check if edge is mostly vertical (between 60-120 degrees or 240-300 degrees)
      const isVertical = (angleDeg > 60 && angleDeg < 120) || (angleDeg > 240 && angleDeg < 300);

      if (isVertical) {
        // For vertical edges, position labels to the right side
        if (edge.data('sourceInterface')) {
          edge.style({
            'source-text-rotation': 'none',
            'source-text-margin-x': 25,
            'source-text-margin-y': 0
          } as any);
        }

        if (edge.data('targetInterface')) {
          edge.style({
            'target-text-rotation': 'none',
            'target-text-margin-x': 25,
            'target-text-margin-y': 0
          } as any);
        }
      } else {
        // For non-vertical edges, use autorotate
        if (edge.data('sourceInterface')) {
          edge.style({
            'source-text-rotation': 'autorotate',
            'source-text-margin-x': 0,
            'source-text-margin-y': -12
          } as any);
        }

        if (edge.data('targetInterface')) {
          edge.style({
            'target-text-rotation': 'autorotate',
            'target-text-margin-x': 0,
            'target-text-margin-y': -12
          } as any);
        }
      }
    });
  }

  private registerCyClickEvents(): void {
    if (!this.cy) return;
    this.cy.on('tap', 'node', evt => {
      this.displayInfo('Node', evt.target.data('raw'));
    });
    this.cy.on('tap', 'edge', evt => {
      const raw = evt.target.data('raw');
      const state = evt.target.data('state');
      const sourceState = evt.target.data('sourceState');
      const targetState = evt.target.data('targetState');
      this.displayInfo('Link', { ...raw, state, sourceState, targetState });
    });
  }

  private displayInfo(title: 'Node' | 'Link', data: any): void {
    if (!this.infoCard) return;

    const row = (label: string, value: string | undefined) =>
      value ? `<tr><td>${label}</td><td>${value}</td></tr>` : '';

    if (title === 'Node') {
      const name = data?.metadata?.name ?? '';
      const labelsObj = data?.metadata?.labels ?? {};
      const labels = Object.keys(labelsObj)
        .map(k => `${k}: ${labelsObj[k]}`)
        .join('<br>');
      const status = data?.status?.status;
      const sync = data?.status?.sync;
      const nodeDetails =
        data?.status?.['node-details'] ?? data?.spec?.productionAddress?.ipv4;
      const nodeState = data?.status?.['node-state'] ?? data?.status?.nodeState;
      const nppState = data?.status?.['npp-state'] ?? data?.status?.nppState;
      const os =
        data?.spec?.operatingSystem ?? data?.status?.operatingSystem ?? '';
      const platform = data?.spec?.platform ?? data?.status?.platform ?? '';
      const version = data?.spec?.version ?? data?.status?.version ?? '';
      this.infoCard.innerHTML = `
        <h3><span class="codicon codicon-server-environment"></span> ${name}</h3>
        <table class="info-table">
          ${row('Labels', labels)}
          ${row('Status', status)}
          ${row('Sync', sync)}
          ${row('Node Details', nodeDetails)}
          ${row('Node State', nodeState)}
          ${row('NPP State', nppState)}
          ${row('Operating System', os)}
          ${row('Platform', platform)}
          ${row('Version', version)}
        </table>
      `;
    } else {
      const localNode = data?.local?.node ?? '';
      const localIf = data?.local?.interface ?? '';
      const remoteNode = data?.remote?.node ?? '';
      const remoteIf = data?.remote?.interface ?? '';
      const type = data?.type ?? '';
      const state = data?.state ?? '';
      const sourceState = data?.sourceState ?? '';
      const targetState = data?.targetState ?? '';
      this.infoCard.innerHTML = `
        <h3><span class="codicon codicon-plug"></span> ${localNode} → ${remoteNode}</h3>
        <table class="info-table">
          ${row('Local', `${localNode} (${localIf})`)}
          ${row('Local State', sourceState)}
          ${row('Remote', `${remoteNode} (${remoteIf})`)}
          ${row('Remote State', targetState)}
          ${row('Type', type)}
          ${row('State', state)}
        </table>
      `;
    }
  }

  private applyThemeColors(): void {
    if (!this.cy) return;
    const textSecondary = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-secondary')
      .trim();
    const bgPrimary = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-primary')
      .trim();

    this.cy.style()
      .selector('node')
      .style({
        'color': '#ffffff', // Keep white text for visibility on dark icon
        'background-color': '#001135' // Match the SVG's dark blue
      })
      .selector('edge')
      .style('line-color', textSecondary)
      .selector('edge[sourceInterface]')
      .style({
        'color': textSecondary,
        'source-text-background-color': bgPrimary
      } as any)
      .selector('edge[targetInterface]')
      .style({
        'color': textSecondary,
        'target-text-background-color': bgPrimary
      } as any)
      .update();

    this.updateEdgeColors();
  }

  private updateEdgeColors(): void {
    if (!this.cy) return;
    const success = getComputedStyle(document.documentElement)
      .getPropertyValue('--success')
      .trim();
    const error = getComputedStyle(document.documentElement)
      .getPropertyValue('--error')
      .trim();
    const defaultColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-secondary')
      .trim();

    this.cy.edges().forEach(edge => {
      const state = String(edge.data('state') ?? '').toLowerCase();
      let color = defaultColor;
      if (state === 'up' || state === 'active') {
        color = success || '#4ade80';
      } else if (state) {
        color = error || '#f87171';
      }
      edge.style('line-color', color);
    });
  }

  private updateEdgeLabelVisibility(): void {
    if (!this.cy) return;
    const opacity = this.labelsVisible ? 1 : 0;
    this.cy.edges().forEach(edge => {
      edge.style({
        'text-opacity': opacity,
        'source-text-background-opacity': this.labelsVisible ? 0.9 : 0,
        'target-text-background-opacity': this.labelsVisible ? 0.9 : 0
      } as any);
    });
  }

  private registerCustomZoom(): void {
    if (!this.cy || this.zoomHandlerRegistered) return;
    this.zoomHandlerRegistered = true;
    this.cy.userZoomingEnabled(false);
    const container = this.cy.container();
    if (!container) return;
    container.addEventListener('wheel', this.handleCustomWheel.bind(this), { passive: false });
  }

  private handleCustomWheel(event: WheelEvent): void {
    if (!this.cy) return;
    event.preventDefault();
    const step = event.deltaY;
    const isTrackpad = Math.abs(step) < 50;
    const sensitivity = isTrackpad ? 0.002 : 0.0002;
    const factor = Math.pow(10, -step * sensitivity);
    const newZoom = this.cy.zoom() * factor;
    this.cy.zoom({
      level: newZoom,
      renderedPosition: { x: event.offsetX, y: event.offsetY }
    });
  }

  private updateToggleButton(): void {
    if (!this.toggleLabelBtn) return;
    this.toggleLabelBtn.textContent = this.labelsVisible ? 'Hide Labels' : 'Show Labels';
  }

  private toggleLinkLabels(): void {
    this.labelsVisible = !this.labelsVisible;
    this.updateEdgeLabelVisibility();
    this.updateToggleButton();
  }

  private postMessage(msg: OutboundMessage): void {
    this.vscode.postMessage(msg);
  }

  private loadScript(src: string): Promise<void> {
    return new Promise(resolve => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      document.head.appendChild(script);
    });
  }
}

new TopologyDashboard();

export {};