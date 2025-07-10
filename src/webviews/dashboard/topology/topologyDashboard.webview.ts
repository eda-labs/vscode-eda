declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
};

import type cytoscape from 'cytoscape';
import cytoscapePopper from 'cytoscape-popper';
import tippy, { Instance as TippyInstance } from 'tippy.js';

declare module 'cytoscape' {
  interface Core {
    svg(options?: any): string;
  }
}

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

interface SshTopoNodeMessage {
  command: 'sshTopoNode';
  name: string;
  namespace?: string;
  nodeDetails?: string;
}

type OutboundMessage = ReadyMessage | SetNamespaceMessage | SshTopoNodeMessage;

const tippyFactory = (ref: any, content: HTMLElement): TippyInstance => {
  const dummyDomEle = document.createElement('div');
  const tip = tippy(dummyDomEle, {
    getReferenceClientRect: ref.getBoundingClientRect,
    trigger: 'manual',
    content,
    arrow: false,
    placement: 'top',
    hideOnClick: false,
    sticky: 'reference',
    appendTo: () => document.getElementById('cy') ?? document.body,
    theme: 'edge-label',
    // Ensure edge labels don't overlap UI elements like the SVG export menu
    zIndex: 10
  });
  return tip;
};

class TopologyDashboard {
  private readonly vscode = acquireVsCodeApi();
  private readonly nsSelect = document.getElementById('namespaceSelect') as HTMLSelectElement;
  private readonly labelModeSelect = document.getElementById('labelModeSelect') as HTMLSelectElement;
  private readonly exportBtn = document.getElementById('exportSvgBtn') as HTMLButtonElement;
  private readonly exportPopup = document.getElementById('exportPopup') as HTMLDivElement;
  private readonly exportConfirmBtn = document.getElementById('exportConfirmBtn') as HTMLButtonElement;
  private readonly exportCancelBtn = document.getElementById('exportCancelBtn') as HTMLButtonElement;
  private readonly exportBgColor = document.getElementById('exportBgColor') as HTMLInputElement;
  private readonly exportBgTransparent = document.getElementById('exportBgTransparent') as HTMLInputElement;
  private readonly exportFontColor = document.getElementById('exportFontColor') as HTMLInputElement;
  private readonly exportLinkThickness = document.getElementById('exportLinkThickness') as HTMLInputElement;
  private readonly exportIncludeLabels = document.getElementById('exportIncludeLabels') as HTMLInputElement;
  private readonly cytoscapeUri: string;
  private readonly cytoscapeSvgUri: string;
  private readonly nodeIcon: string;
  private readonly infoCard = document.getElementById('infoCard') as HTMLDivElement;
  private cy?: cytoscape.Core;
  private themeObserver?: MutationObserver;
  private labelMode: 'hide' | 'show' | 'select' = 'select';
  private zoomHandlerRegistered = false;
  private tippyUpdateRegistered = false;
  private currentNamespace?: string;
  private readonly baseNodeFontSize = 12;
  private readonly baseEdgeFontSize = 10;
  private edgeTippies: Map<string, { source?: { tip: TippyInstance; el: HTMLElement }; target?: { tip: TippyInstance; el: HTMLElement } }> = new Map();

  constructor() {
    const bodyEl = document.body as HTMLBodyElement;
    this.cytoscapeUri = bodyEl.dataset.cytoscapeUri ?? '';
    this.cytoscapeSvgUri = bodyEl.dataset.cytoscapeSvgUri ?? '';
    this.nodeIcon = bodyEl.dataset.nodeIcon ?? '';
    this.registerEvents();
    this.updateLabelMode();
    void this.loadScript(this.cytoscapeUri)
      .then(() => this.loadScript(this.cytoscapeSvgUri))
      .then(() => {
        const win = window as unknown as { cytoscape: any };
        if (win.cytoscape) {
          win.cytoscape.use(cytoscapePopper(tippyFactory));
        }
        this.postMessage({ command: 'ready' });
      });
  }

  private registerEvents(): void {
    this.nsSelect.addEventListener('change', () => {
      this.postMessage({ command: 'setNamespace', namespace: this.nsSelect.value });
    });

    this.exportBtn.addEventListener('click', () => {
      this.showExportPopup();
    });

    this.exportConfirmBtn.addEventListener('click', () => {
      this.performExport();
    });

    this.exportCancelBtn.addEventListener('click', () => {
      this.hideExportPopup();
    });

    this.labelModeSelect.addEventListener('change', () => {
      this.updateLabelMode();
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
    const selectedNs = this.nsSelect.value;
    const namespaceChanged = this.currentNamespace !== selectedNs;
    this.currentNamespace = selectedNs;
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
        weight: 0.5,
        pairIndex: idx  // Store the pair index for use in adjustEdgeCurves
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
              'source-endpoint': 'outside-to-line',
              'target-endpoint': 'outside-to-line'
            } as any
          },
          {
            selector: 'node.highlight',
            style: {
              'border-width': 2,
              'border-color': '#ffa500'
            } as any
          },
          {
            selector: 'edge.highlight',
            style: {
              'line-color': '#ffa500',
              'width': 3
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
        this.adjustEdgeCurves();
        this.createEdgeTippies();
        this.cy!.fit(this.cy!.elements(), 50);
        this.applyThemeColors();
        this.updateEdgeLabelVisibility();
        this.registerCyClickEvents();
        this.registerCustomZoom();
      });
    } else if (namespaceChanged) {
      this.clearHighlights();
      this.cy.elements().remove();
      this.cy.add(elements);
      this.layoutByTier();
      this.adjustEdgeCurves();
      this.createEdgeTippies();
      this.cy.fit(this.cy.elements(), 50);
      this.applyThemeColors();
      this.updateEdgeLabelVisibility();
      this.registerCustomZoom();
    } else {
      this.clearHighlights();
      const cy = this.cy;

      const incomingNodeIds = new Set(nodes.map(n => n.id));
      const existingTierNodes: Record<string, cytoscape.NodeSingular[]> = {};

      cy.nodes().forEach(n => {
        if (!incomingNodeIds.has(n.id())) {
          n.remove();
        } else {
          const t = String(n.data('tier') ?? 1);
          if (!existingTierNodes[t]) existingTierNodes[t] = [];
          existingTierNodes[t].push(n);
        }
      });

      const uniqueTiers = Array.from(new Set(nodes.map(n => Number(n.tier ?? 1)))).sort((a, b) => a - b);
      const tierIndexMap = new Map<number, number>();
      uniqueTiers.forEach((t, idx) => tierIndexMap.set(t, idx));

      const spacingX = 240;
      const spacingY = 260; // Increase vertical spacing between tiers

      nodes.forEach(n => {
        const existing = cy.$id(n.id);
        if (existing.nonempty()) {
          existing.data({ ...existing.data(), label: n.label, tier: n.tier, raw: n.raw });
        } else {
          const newNode = cy.add({ group: 'nodes', data: { id: n.id, label: n.label, tier: n.tier, raw: n.raw } });
          const tier = Number(n.tier ?? 1);
          const idxNodes = existingTierNodes[String(tier)] ?? [];
          const maxX = idxNodes.length ? Math.max(...idxNodes.map(no => no.position('x'))) : 0;
          const tierIndex = tierIndexMap.get(tier) ?? 0;
          newNode.position({ x: idxNodes.length ? maxX + spacingX : 0, y: tierIndex * spacingY });
          idxNodes.push(newNode);
          existingTierNodes[String(tier)] = idxNodes;
        }
      });

      const newEdges: cytoscape.EdgeDefinition[] = [];
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
        if (e.sourceInterface) idParts.push(this.shortenInterfaceName(e.sourceInterface));
        idParts.push(e.target);
        if (e.targetInterface) idParts.push(this.shortenInterfaceName(e.targetInterface));
        idParts.push(String(edgeCount++));

        const edgeData: any = {
          id: idParts.join('--'),
          source: e.source,
          target: e.target,
          raw: e.raw,
          dist: distance,
          weight: 0.5,
          pairIndex: idx
        };

        if (e.state) edgeData.state = e.state;
        if (e.sourceState) edgeData.sourceState = e.sourceState;
        if (e.targetState) edgeData.targetState = e.targetState;
        if (e.sourceInterface) edgeData.sourceInterface = this.shortenInterfaceName(e.sourceInterface);
        if (e.targetInterface) edgeData.targetInterface = this.shortenInterfaceName(e.targetInterface);

        newEdges.push({ group: 'edges', data: edgeData });
      });

      const incomingEdgeIds = new Set(newEdges.map(e => e.data.id));
      cy.edges().forEach(edge => { if (!incomingEdgeIds.has(edge.id())) edge.remove(); });

      newEdges.forEach(def => {
        const existing = cy.$id(def.data.id!);
        if (existing.nonempty()) {
          existing.data(def.data);
        } else {
          cy.add(def);
        }
      });

      this.adjustEdgeCurves();
      this.createEdgeTippies();
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
    const spacingY = 260; // Increased vertical spacing between tiers

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

  private adjustEdgeCurves(): void {
    if (!this.cy) return;

    // Group edges by node pairs
    const edgePairs: Record<string, cytoscape.EdgeSingular[]> = {};
    this.cy.edges().forEach(edge => {
      const key = `${edge.source().id()}|${edge.target().id()}`;
      if (!edgePairs[key]) edgePairs[key] = [];
      edgePairs[key].push(edge);
    });

    // Adjust curves for each pair
    Object.entries(edgePairs).forEach(([_, edges]) => {
      if (edges.length === 0) return;

      const sourcePos = edges[0].source().position();
      const targetPos = edges[0].target().position();
      const sourceTier = edges[0].source().data('tier');
      const targetTier = edges[0].target().data('tier');

      // For edges between different tiers
      if (sourceTier !== targetTier) {
        const dx = targetPos.x - sourcePos.x;
        const absDx = Math.abs(dx);

        edges.forEach((edge) => {
          const pairIdx = edge.data('pairIndex') || 0;

          // Base curve calculation
          let baseCurve = 30;

          // For edges going to far left or far right, increase base curve
          if (absDx > 200) {
            baseCurve = 50;
          } else if (absDx > 100) {
            baseCurve = 40;
          } else if (absDx > 50) {
            baseCurve = 35;
          }

          // Apply alternating pattern for multiple edges
          const sign = pairIdx % 2 === 0 ? 1 : -1;
          const magnitude = Math.floor(pairIdx / 2) + 1;

          // For crossing edges (going opposite direction of tier progression)
          const crossingSign = dx > 0 ? -1 : 1;

          // Final distance calculation
          const distance = crossingSign * sign * magnitude * baseCurve;

          edge.data('dist', distance);
        });
      } else {
        // For edges in the same tier, keep the original alternating pattern
        edges.forEach((edge) => {
          const pairIdx = edge.data('pairIndex') || 0;
          const sign = pairIdx % 2 === 0 ? 1 : -1;
          const magnitude = Math.floor(pairIdx / 2) + 1;
          edge.data('dist', sign * magnitude * 30);
        });
      }
    });
  }

  private createEdgeTippies(): void {
    if (!this.cy) return;

    // Remove existing tippies
    this.edgeTippies.forEach(tips => {
      tips.source?.tip.destroy();
      tips.target?.tip.destroy();
    });
    this.edgeTippies.clear();

    this.registerEdgeTippyUpdates();

    this.cy.edges().forEach(edge => {
      const src = edge.data('sourceInterface');
      const tgt = edge.data('targetInterface');
      if (!src && !tgt) return;

    const tips: { source?: { tip: TippyInstance; el: HTMLElement }; target?: { tip: TippyInstance; el: HTMLElement } } = {};

      const offset = 0; // Place labels directly on the curve
      const orient = edge.target().position('y') > edge.source().position('y') ? 1 : -1;
      const shift = orient * 0.1;

      if (src) {
        const content = document.createElement('div');
        content.classList.add('cy-edge-label');
        content.textContent = src;
        const tip = edge.popper({
          content: () => content,
          renderedPosition: () =>
            this.toRenderedPosition(this.edgeLabelPosition(edge, 0.2, offset, true, shift))
        }) as TippyInstance;
        tip.show();
        tips.source = { tip, el: content };
      }

      if (tgt) {
        const content = document.createElement('div');
        content.classList.add('cy-edge-label');
        content.textContent = tgt;
        const tip = edge.popper({
          content: () => content,
          renderedPosition: () =>
            this.toRenderedPosition(this.edgeLabelPosition(edge, 0.2, offset, false, shift))
        }) as TippyInstance;
        tip.show();
        tips.target = { tip, el: content };
      }

      this.edgeTippies.set(edge.id(), tips);
    });

    this.updateLabelScale();
  }

  private edgeLabelPosition(
    edge: cytoscape.EdgeSingular,
    ratio: number,
    offset: number,
    fromSource = true,
    shift = 0
  ): { x: number; y: number } {
    const src = edge.sourceEndpoint();
    const tgt = edge.targetEndpoint();
    const dist = Number(edge.data('dist')) || 0;
    const weight = Number(edge.data('weight')) || 0.5;

    // Calculate the control point for the quadratic curve
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const len = Math.hypot(dx, dy) || 1;
    const cx = src.x + dx * weight - (dy / len) * dist;
    const cy = src.y + dy * weight + (dx / len) * dist;

    const control = { x: cx, y: cy };

    let t = fromSource
      ? this.tAtArcRatio(src, control, tgt, ratio)
      : 1 - this.tAtArcRatio(tgt, control, src, ratio);

    t = Math.max(0, Math.min(1, t + shift));

    // Quadratic Bezier point at parameter t
    const ax = (1 - t) * (1 - t) * src.x + 2 * (1 - t) * t * cx + t * t * tgt.x;
    const ay = (1 - t) * (1 - t) * src.y + 2 * (1 - t) * t * cy + t * t * tgt.y;

    // Derivative for tangent at parameter t
    const dxT = 2 * (1 - t) * (cx - src.x) + 2 * t * (tgt.x - cx);
    const dyT = 2 * (1 - t) * (cy - src.y) + 2 * t * (tgt.y - cy);
    const lenT = Math.hypot(dxT, dyT) || 1;

    const nx = -dyT / lenT;
    const ny = dxT / lenT;

    return { x: ax + nx * offset, y: ay + ny * offset };
  }

  private tAtArcRatio(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    ratio: number
  ): number {
    if (ratio <= 0) return 0;
    if (ratio >= 1) return 1;
    const total = this.approxArcLength(p0, p1, p2, 1);
    const target = total * ratio;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      const len = this.approxArcLength(p0, p1, p2, mid);
      if (len < target) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return (lo + hi) / 2;
  }

  private approxArcLength(
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    t: number,
    steps = 16
  ): number {
    let length = 0;
    let prevX = p0.x;
    let prevY = p0.y;
    for (let i = 1; i <= steps; i++) {
      const ti = t * (i / steps);
      const x =
        (1 - ti) * (1 - ti) * p0.x + 2 * (1 - ti) * ti * p1.x + ti * ti * p2.x;
      const y =
        (1 - ti) * (1 - ti) * p0.y + 2 * (1 - ti) * ti * p1.y + ti * ti * p2.y;
      length += Math.hypot(x - prevX, y - prevY);
      prevX = x;
      prevY = y;
    }
    return length;
  }

  private toRenderedPosition(point: { x: number; y: number }): { x: number; y: number } {
    if (!this.cy) return point;
    const pan = this.cy.pan();
    const zoom = this.cy.zoom();
    return { x: point.x * zoom + pan.x, y: point.y * zoom + pan.y };
  }

  private registerEdgeTippyUpdates(): void {
    if (!this.cy || this.tippyUpdateRegistered) return;
    this.tippyUpdateRegistered = true;
    const update = () => this.updateEdgeTippyPositions();
    this.cy.on('pan zoom resize', update);
    this.cy.on('position', 'node', update);
    this.cy.on('zoom', () => this.updateLabelScale());
  }

  private updateEdgeTippyPositions(): void {
    this.edgeTippies.forEach(tips => {
      tips.source?.tip.popperInstance?.update();
      tips.target?.tip.popperInstance?.update();
    });
  }

  private updateLabelScale(): void {
    if (!this.cy) return;
    const zoom = this.cy.zoom();
    const nodeSize = Math.min(24, Math.max(6, this.baseNodeFontSize * zoom));
    this.cy.nodes().style('font-size', nodeSize);

    const edgeSize = Math.min(20, Math.max(6, this.baseEdgeFontSize * zoom));
    this.edgeTippies.forEach(tips => {
      tips.source?.el && (tips.source.el.style.fontSize = `${edgeSize}px`);
      tips.target?.el && (tips.target.el.style.fontSize = `${edgeSize}px`);
    });
  }

  private registerCyClickEvents(): void {
    if (!this.cy) return;
    this.cy.on('tap', 'node', evt => {
      this.clearHighlights();
      const node = evt.target;
      node.addClass('highlight');
      node.connectedEdges().addClass('highlight');
      this.displayInfo('Node', node.data('raw'));
      this.updateEdgeLabelVisibility();
    });
    const dbl = (evt: any) => {
      const raw = evt.target.data('raw');
      const name = raw?.metadata?.name;
      const namespace = raw?.metadata?.namespace;
      const nodeDetails =
        raw?.status?.['node-details'] ?? raw?.spec?.productionAddress?.ipv4;
      if (name) {
        this.postMessage({
          command: 'sshTopoNode',
          name,
          namespace,
          nodeDetails
        });
      }
    };
    // Register a single double-click handler. Cytoscape triggers both
    // `dblclick` and `dbltap` events for mouse double clicks, which would
    // result in this handler firing twice if both listeners are registered.
    // Using only `dblclick` covers both mouse and touch interactions.
    this.cy.on('dblclick', 'node', dbl);
    this.cy.on('tap', 'edge', evt => {
      this.clearHighlights();
      const edge = evt.target;
      edge.addClass('highlight');
      edge.connectedNodes().addClass('highlight');
      const raw = edge.data('raw');
      const state = edge.data('state');
      const sourceState = edge.data('sourceState');
      const targetState = edge.data('targetState');
      this.displayInfo('Link', { ...raw, state, sourceState, targetState });
      this.updateEdgeLabelVisibility();
    });

    this.cy.on('tap', evt => {
      if (evt.target === this.cy) {
        this.clearHighlights();
        this.updateEdgeLabelVisibility();
      }
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
      const section = (title: string) => `<tr class="section"><td colspan="2">${title}</td></tr>`;
      this.infoCard.innerHTML = `
        <h3><span class="codicon codicon-plug"></span> ${localNode} → ${remoteNode}</h3>
        <table class="info-table">
          ${row('Type', type)}
          ${row('State', state)}
          ${section('Local Endpoint')}
          ${row('State', sourceState)}
          ${row('Interface', localIf)}
          ${section('Remote Endpoint')}
          ${row('State', targetState)}
          ${row('Interface', remoteIf)}
        </table>
      `;
    }
  }

  private applyThemeColors(): void {
    if (!this.cy) return;
    const textSecondary = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-secondary')
      .trim();

    this.cy.style()
      .selector('node')
      .style({
        'color': '#ffffff', // Keep white text for visibility on dark icon
        'background-color': '#001135' // Match the SVG's dark blue
      })
      .selector('edge')
      .style('line-color', textSecondary)
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
    this.cy.edges().forEach(edge => {
      const tips = this.edgeTippies.get(edge.id());
      let show = false;
      if (this.labelMode === 'show') {
        show = true;
      } else if (this.labelMode === 'select' && edge.hasClass('highlight')) {
        show = true;
      }
      if (tips) {
        tips.source && (show ? tips.source.tip.show() : tips.source.tip.hide());
        tips.target && (show ? tips.target.tip.show() : tips.target.tip.hide());
      }
      edge.style({
        'text-opacity': 0,
        'source-text-background-opacity': 0,
        'target-text-background-opacity': 0
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
    this.updateLabelScale();
  }

  private showExportPopup(): void {
    const bodyColor = getComputedStyle(document.body).color;
    const cyContainer = document.getElementById('cy');
    const bgColor = cyContainer
      ? getComputedStyle(cyContainer).backgroundColor
      : 'white';

    this.exportFontColor.value = this.rgbToHex(bodyColor);
    this.exportBgColor.value = this.rgbToHex(bgColor);
    this.exportPopup.classList.remove('hidden');
  }

  private hideExportPopup(): void {
    this.exportPopup.classList.add('hidden');
  }

  private rgbToHex(color: string): string {
    const ctx = document.createElement('div');
    ctx.style.color = color;
    document.body.appendChild(ctx);
    const computed = getComputedStyle(ctx).color;
    document.body.removeChild(ctx);
    const m = computed.match(/\d+/g);
    if (!m) return '#000000';
    const [r, g, b] = m.map(x => Number(x));
    return (
      '#' +
      [r, g, b]
        .map(x => x.toString(16).padStart(2, '0'))
        .join('')
    );
  }

  private performExport(): void {
    if (!this.cy) return;
    const includeLabels = this.exportIncludeLabels.checked;
    const linkThickness = parseInt(this.exportLinkThickness.value, 10) || 1;
    const transparent = this.exportBgTransparent.checked;
    const bgColor = this.exportBgColor.value;
    const fontColor = this.exportFontColor.value;

    const nodes = this.cy.nodes();
    const edges = this.cy.edges();
    const prevNodeLabels: string[] = [];
    const prevNodeColors: string[] = [];
    const prevBorders: string[] = [];
    const prevEdgeWidths: string[] = [];
    const prevEdgeColors: string[] = [];

    nodes.forEach(n => {
      prevNodeLabels.push(n.style('label'));
      prevNodeColors.push(n.style('color'));
      prevBorders.push(n.style('border-width'));
      if (!includeLabels) {
        n.style('label', '');
      }
      n.style('border-width', 0);
      n.style('color', fontColor);
    });

    edges.forEach(e => {
      prevEdgeWidths.push(e.style('width'));
      prevEdgeColors.push(e.style('color'));
      // Native Cytoscape labels are suppressed during export
      e.style('width', linkThickness);
      e.style('color', fontColor);
    });

    const svgOpts: any = { full: true };
    if (!transparent) {
      svgOpts.bg = bgColor;
    }

    let svg = this.cy.svg(svgOpts);

    if (includeLabels) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svg, 'image/svg+xml');
      const root = doc.documentElement;

      const style = getComputedStyle(document.documentElement);
      const bg = style.getPropertyValue('--edge-label-bg').trim() || '#fff';
      const border = style.getPropertyValue('--edge-label-border').trim() || '#000';
      const bb = this.cy.elements().boundingBox();
      const pxRatio = (this.cy as any).renderer().getPixelRatio();

      const createLabel = (x: number, y: number, text: string) => {
        const paddingX = 6;
        const paddingY = 2;
        const fontSize = 10;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        ctx.font = `500 ${fontSize}px sans-serif`;
        const width = ctx.measureText(text).width + paddingX * 2;
        const height = fontSize + paddingY * 2;

        const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(x - width / 2));
        rect.setAttribute('y', String(y - height / 2));
        rect.setAttribute('width', String(width));
        rect.setAttribute('height', String(height));
        rect.setAttribute('fill', bg);
        rect.setAttribute('stroke', border);
        rect.setAttribute('rx', '3');
        rect.setAttribute('ry', '3');
        g.appendChild(rect);

        const textEl = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', String(x));
        textEl.setAttribute('y', String(y + fontSize / 2 - 1));
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('font-size', String(fontSize));
        textEl.setAttribute('font-weight', '500');
        textEl.setAttribute('fill', fontColor);
        textEl.textContent = text;
        g.appendChild(textEl);
        root.appendChild(g);
      };

      edges.forEach(edge => {
        const src = edge.data('sourceInterface');
        const tgt = edge.data('targetInterface');
        const offset = 0;
        const orient = edge.target().position('y') > edge.source().position('y') ? 1 : -1;
        const shift = orient * 0.1;
        if (src) {
          const pos = this.edgeLabelPosition(edge, 0.2, offset, true, shift);
          const x = (pos.x - bb.x1) * pxRatio;
          const y = (pos.y - bb.y1) * pxRatio;
          createLabel(x, y, src);
        }
        if (tgt) {
          const pos = this.edgeLabelPosition(edge, 0.2, offset, false, shift);
          const x = (pos.x - bb.x1) * pxRatio;
          const y = (pos.y - bb.y1) * pxRatio;
          createLabel(x, y, tgt);
        }
      });

      svg = new XMLSerializer().serializeToString(doc);
    }

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'topology.svg';
    a.click();
    URL.revokeObjectURL(url);

    nodes.forEach((n, idx) => {
      n.style('label', prevNodeLabels[idx]);
      n.style('color', prevNodeColors[idx]);
      n.style('border-width', prevBorders[idx]);
    });
    edges.forEach((e, idx) => {
      e.style('color', prevEdgeColors[idx]);
      e.style('width', prevEdgeWidths[idx]);
    });

    this.updateEdgeLabelVisibility();
    this.hideExportPopup();
  }

  private updateLabelMode(): void {
    if (!this.labelModeSelect) return;
    this.labelMode = this.labelModeSelect.value as 'hide' | 'show' | 'select';
    this.updateEdgeLabelVisibility();
  }

  private clearHighlights(): void {
    if (!this.cy) return;
    this.cy.elements().removeClass('highlight');
    this.updateEdgeLabelVisibility();
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