declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
};

import type cytoscape from 'cytoscape';

interface TopologyNode {
  id: string;
  label: string;
  tier?: number;
}

interface TopologyEdge {
  source: string;
  target: string;
  sourceInterface?: string;
  targetInterface?: string;
  label?: string;
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
  private readonly cytoscapeUri: string;
  private readonly nodeIcon: string;
  private cy?: cytoscape.Core;
  private themeObserver?: MutationObserver;

  constructor() {
    const bodyEl = document.body as HTMLBodyElement;
    this.cytoscapeUri = bodyEl.dataset.cytoscapeUri ?? '';
    this.nodeIcon = bodyEl.dataset.nodeIcon ?? '';
    this.registerEvents();
    this.postMessage({ command: 'ready' });
    void this.loadScript(this.cytoscapeUri);
  }

  private registerEvents(): void {
    this.nsSelect.addEventListener('change', () => {
      this.postMessage({ command: 'setNamespace', namespace: this.nsSelect.value });
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
    // Replace ethernet with e-
    return name.replace(/ethernet/gi, 'e-');
  }

  private renderTopology(nodes: TopologyNode[], edges: TopologyEdge[]): void {
    const elements: cytoscape.ElementDefinition[] = [];
    nodes.forEach(n => {
      elements.push({ group: 'nodes', data: { id: n.id, label: n.label, tier: n.tier } });
    });
    edges.forEach(e => {
      const edgeData: any = {
        id: `${e.source}--${e.target}`,
        source: e.source,
        target: e.target
      };

      // Add interface names (shortened) without middle label
      if (e.sourceInterface) {
        edgeData.sourceInterface = this.shortenInterfaceName(e.sourceInterface);
      }
      if (e.targetInterface) {
        edgeData.targetInterface = this.shortenInterfaceName(e.targetInterface);
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
              'background-color': '#60a5fa',
              'background-image': this.nodeIcon,
              'background-fit': 'contain',
              'background-clip': 'none',
              'shape': 'rectangle',
              'label': 'data(label)',
              'text-valign': 'bottom',
              'text-halign': 'center',
              'text-margin-y': 5,
              'font-size': 12,
              'width': 70,
              'height': 70
            } as any
          },
          {
            selector: 'edge',
            style: {
              'width': 1,
              'target-arrow-shape': 'none',
              'curve-style': 'bezier'
            } as any
          },
          {
            selector: 'edge[sourceInterface]',
            style: {
              'source-label': 'data(sourceInterface)',
              'source-text-offset': 50,
              'source-text-rotation': 'autorotate',
              'source-text-margin-y': -10,
              'font-size': 9
            } as any
          },
          {
            selector: 'edge[targetInterface]',
            style: {
              'target-label': 'data(targetInterface)',
              'target-text-offset': 50,
              'target-text-rotation': 'autorotate',
              'target-text-margin-y': -10,
              'font-size': 9
            } as any
          }
        ],
        layout: {
          name: 'preset'
        },
        wheelSensitivity: 1.5,
        minZoom: 0.3,
        maxZoom: 300
      });

      this.cy.ready(() => {
        this.layoutByTier();
        this.cy!.fit(this.cy!.elements(), 50);
        this.applyThemeColors();
      });
    } else {
      this.cy.elements().remove();
      this.cy.add(elements);
      this.layoutByTier();
      this.cy.fit(this.cy.elements(), 50);
      this.applyThemeColors();
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

    const spacingX = 200; // Increased spacing for interface labels
    const spacingY = 150;

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

  private applyThemeColors(): void {
    if (!this.cy) return;
    const textPrimary = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-primary')
      .trim();
    const textSecondary = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-secondary')
      .trim();

    this.cy.style()
      .selector('node')
      .style('color', textPrimary)
      .selector('edge')
      .style('line-color', textSecondary)
      .selector('edge[sourceInterface]')
      .style('color', textPrimary)
      .selector('edge[targetInterface]')
      .style('color', textPrimary)
      .update();
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