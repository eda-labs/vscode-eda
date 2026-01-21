import React, { useState, useCallback, useEffect, useRef } from 'react';
import { usePostMessage, useMessageListener } from '../../shared/hooks';
import { mountWebview } from '../../shared/utils';
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
  rawResource?: unknown;
}

interface TopologyMessage {
  command: string;
  namespaces?: string[];
  selected?: string;
  nodes?: TopologyNode[];
  edges?: TopologyEdge[];
}

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
    zIndex: 10
  });
  return tip;
};

function shortenInterfaceName(name: string | undefined): string {
  if (!name) return '';
  return name.replace(/ethernet-/gi, 'e-');
}

function TopologyDashboard() {
  const postMessage = usePostMessage();
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [labelMode, setLabelMode] = useState<'hide' | 'show' | 'select'>('select');
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [exportBgColor, setExportBgColor] = useState('#ffffff');
  const [exportBgTransparent, setExportBgTransparent] = useState(false);
  const [exportFontColor, setExportFontColor] = useState('#000000');
  const [exportLinkThickness, setExportLinkThickness] = useState(1);
  const [exportIncludeLabels, setExportIncludeLabels] = useState(true);
  const [infoCardContent, setInfoCardContent] = useState<string>('Select a node or link');

  const cyContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const edgeTippiesRef = useRef<Map<string, { source?: { tip: TippyInstance; el: HTMLElement }; target?: { tip: TippyInstance; el: HTMLElement } }>>(new Map());
  const zoomHandlerRegisteredRef = useRef(false);
  const tippyUpdateRegisteredRef = useRef(false);
  const currentNamespaceRef = useRef<string>('');
  const nodeIconRef = useRef<string>('');

  const baseNodeFontSize = 12;
  const baseEdgeFontSize = 10;

  // Load Cytoscape scripts and initialize
  useEffect(() => {
    const bodyEl = document.body as HTMLBodyElement;
    const cytoscapeUri = bodyEl.dataset.cytoscapeUri ?? '';
    const cytoscapeSvgUri = bodyEl.dataset.cytoscapeSvgUri ?? '';
    nodeIconRef.current = bodyEl.dataset.nodeIcon ?? '';

    const loadScript = (src: string): Promise<void> => {
      return new Promise(resolve => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        document.head.appendChild(script);
      });
    };

    loadScript(cytoscapeUri)
      .then(() => loadScript(cytoscapeSvgUri))
      .then(() => {
        const win = window as unknown as { cytoscape: any };
        if (win.cytoscape) {
          win.cytoscape.use(cytoscapePopper(tippyFactory));
        }
        postMessage({ command: 'ready' });
      });

    return () => {
      edgeTippiesRef.current.forEach(tips => {
        tips.source?.tip.destroy();
        tips.target?.tip.destroy();
      });
      edgeTippiesRef.current.clear();
      cyRef.current?.destroy();
    };
  }, [postMessage]);

  // Theme observer
  useEffect(() => {
    const observer = new MutationObserver(() => {
      applyThemeColors();
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const applyThemeColors = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const textSecondary = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-secondary')
      .trim();

    cy.style()
      .selector('node')
      .style({
        'color': '#ffffff',
        'background-color': '#001135'
      })
      .selector('edge')
      .style('line-color', textSecondary)
      .update();

    updateEdgeColors();
  }, []);

  const updateEdgeColors = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const success = getComputedStyle(document.documentElement)
      .getPropertyValue('--success')
      .trim();
    const error = getComputedStyle(document.documentElement)
      .getPropertyValue('--error')
      .trim();
    const defaultColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-secondary')
      .trim();

    cy.edges().forEach(edge => {
      const state = String(edge.data('state') ?? '').toLowerCase();
      let color = defaultColor;
      if (state === 'up' || state === 'active') {
        color = success || '#4ade80';
      } else if (state) {
        color = error || '#f87171';
      }
      edge.style('line-color', color);
    });
  }, []);

  const updateEdgeLabelVisibility = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.edges().forEach(edge => {
      const tips = edgeTippiesRef.current.get(edge.id());
      let show = false;
      if (labelMode === 'show') {
        show = true;
      } else if (labelMode === 'select' && edge.hasClass('highlight')) {
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
  }, [labelMode]);

  const updateLabelScale = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const zoom = cy.zoom();
    const nodeSize = Math.min(24, Math.max(6, baseNodeFontSize * zoom));
    cy.nodes().style('font-size', nodeSize);

    const edgeSize = Math.min(20, Math.max(6, baseEdgeFontSize * zoom));
    edgeTippiesRef.current.forEach(tips => {
      tips.source?.el && (tips.source.el.style.fontSize = `${edgeSize}px`);
      tips.target?.el && (tips.target.el.style.fontSize = `${edgeSize}px`);
    });
  }, []);

  const clearHighlights = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('highlight');
    updateEdgeLabelVisibility();
  }, [updateEdgeLabelVisibility]);

  const toRenderedPosition = useCallback((point: { x: number; y: number }): { x: number; y: number } => {
    const cy = cyRef.current;
    if (!cy) return point;
    const pan = cy.pan();
    const zoom = cy.zoom();
    return { x: point.x * zoom + pan.x, y: point.y * zoom + pan.y };
  }, []);

  const approxArcLength = useCallback((
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    t: number,
    steps = 16
  ): number => {
    let length = 0;
    let prevX = p0.x;
    let prevY = p0.y;
    for (let i = 1; i <= steps; i++) {
      const ti = t * (i / steps);
      const x = (1 - ti) * (1 - ti) * p0.x + 2 * (1 - ti) * ti * p1.x + ti * ti * p2.x;
      const y = (1 - ti) * (1 - ti) * p0.y + 2 * (1 - ti) * ti * p1.y + ti * ti * p2.y;
      length += Math.hypot(x - prevX, y - prevY);
      prevX = x;
      prevY = y;
    }
    return length;
  }, []);

  const tAtArcRatio = useCallback((
    p0: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    ratio: number
  ): number => {
    if (ratio <= 0) return 0;
    if (ratio >= 1) return 1;
    const total = approxArcLength(p0, p1, p2, 1);
    const target = total * ratio;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      const len = approxArcLength(p0, p1, p2, mid);
      if (len < target) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return (lo + hi) / 2;
  }, [approxArcLength]);

  const edgeLabelPosition = useCallback((
    edge: cytoscape.EdgeSingular,
    ratio: number,
    offset: number,
    fromSource = true,
    shift = 0
  ): { x: number; y: number } => {
    const src = edge.sourceEndpoint();
    const tgt = edge.targetEndpoint();
    const dist = Number(edge.data('dist')) || 0;
    const weight = Number(edge.data('weight')) || 0.5;

    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const len = Math.hypot(dx, dy) || 1;
    const cx = src.x + dx * weight - (dy / len) * dist;
    const cy = src.y + dy * weight + (dx / len) * dist;

    const control = { x: cx, y: cy };

    let t = fromSource
      ? tAtArcRatio(src, control, tgt, ratio)
      : 1 - tAtArcRatio(tgt, control, src, ratio);

    t = Math.max(0, Math.min(1, t + shift));

    const ax = (1 - t) * (1 - t) * src.x + 2 * (1 - t) * t * cx + t * t * tgt.x;
    const ay = (1 - t) * (1 - t) * src.y + 2 * (1 - t) * t * cy + t * t * tgt.y;

    const dxT = 2 * (1 - t) * (cx - src.x) + 2 * t * (tgt.x - cx);
    const dyT = 2 * (1 - t) * (cy - src.y) + 2 * t * (tgt.y - cy);
    const lenT = Math.hypot(dxT, dyT) || 1;

    const nx = -dyT / lenT;
    const ny = dxT / lenT;

    return { x: ax + nx * offset, y: ay + ny * offset };
  }, [tAtArcRatio]);

  const displayInfo = useCallback((title: 'Node' | 'Link', data: any) => {
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
      const nodeDetails = data?.status?.['node-details'] ?? data?.spec?.productionAddress?.ipv4;
      const nodeState = data?.status?.['node-state'] ?? data?.status?.nodeState;
      const nppState = data?.status?.['npp-state'] ?? data?.status?.nppState;
      const os = data?.spec?.operatingSystem ?? data?.status?.operatingSystem ?? '';
      const platform = data?.spec?.platform ?? data?.status?.platform ?? '';
      const version = data?.spec?.version ?? data?.status?.version ?? '';
      setInfoCardContent(`
        <h3><span class="codicon codicon-server-environment"></span> <a href="#" class="node-link">${name}</a></h3>
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
      `);
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
      setInfoCardContent(`
        <h3><span class="codicon codicon-plug"></span> <a href="#" class="link-resource">${localNode} \u2192 ${remoteNode}</a></h3>
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
      `);
    }
  }, []);

  // Handle clicks in info card
  useEffect(() => {
    const infoCard = document.getElementById('infoCard');
    if (!infoCard) return;

    const handleClick = (evt: Event) => {
      const target = evt.target as HTMLElement;
      if (target.classList.contains('node-link')) {
        evt.preventDefault();
        const cy = cyRef.current;
        if (cy) {
          const node = cy.nodes('.highlight').first();
          if (node.nonempty()) {
            postMessage({
              command: 'openResource',
              raw: node.data('raw'),
              streamGroup: 'core'
            });
          }
        }
      } else if (target.classList.contains('link-resource')) {
        evt.preventDefault();
        const cy = cyRef.current;
        if (cy) {
          const edge = cy.edges('.highlight').first();
          if (edge.nonempty()) {
            postMessage({
              command: 'openResource',
              raw: edge.data('rawResource'),
              streamGroup: 'core'
            });
          }
        }
      }
    };

    infoCard.addEventListener('click', handleClick);
    return () => infoCard.removeEventListener('click', handleClick);
  }, [postMessage]);

  const createEdgeTippies = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    edgeTippiesRef.current.forEach(tips => {
      tips.source?.tip.destroy();
      tips.target?.tip.destroy();
    });
    edgeTippiesRef.current.clear();

    if (!tippyUpdateRegisteredRef.current) {
      tippyUpdateRegisteredRef.current = true;
      const update = () => {
        edgeTippiesRef.current.forEach(tips => {
          tips.source?.tip.popperInstance?.update();
          tips.target?.tip.popperInstance?.update();
        });
      };
      cy.on('pan zoom resize', update);
      cy.on('position', 'node', update);
      cy.on('zoom', () => updateLabelScale());
    }

    cy.edges().forEach(edge => {
      const src = edge.data('sourceInterface');
      const tgt = edge.data('targetInterface');
      if (!src && !tgt) return;

      const tips: { source?: { tip: TippyInstance; el: HTMLElement }; target?: { tip: TippyInstance; el: HTMLElement } } = {};

      const offset = 0;
      const orient = edge.target().position('y') > edge.source().position('y') ? 1 : -1;
      const shift = orient * 0.1;

      if (src) {
        const content = document.createElement('div');
        content.classList.add('cy-edge-label');
        content.textContent = src;
        const tip = edge.popper({
          content: () => content,
          renderedPosition: () =>
            toRenderedPosition(edgeLabelPosition(edge, 0.2, offset, true, shift))
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
            toRenderedPosition(edgeLabelPosition(edge, 0.2, offset, false, shift))
        }) as TippyInstance;
        tip.show();
        tips.target = { tip, el: content };
      }

      edgeTippiesRef.current.set(edge.id(), tips);
    });

    updateLabelScale();
  }, [toRenderedPosition, edgeLabelPosition, updateLabelScale]);

  const layoutByTier = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const tiers: Record<string, cytoscape.NodeSingular[]> = {};
    cy.nodes().forEach(n => {
      const t = Number(n.data('tier') ?? 1);
      if (!tiers[t]) tiers[t] = [];
      tiers[t].push(n);
    });

    const spacingX = 240;
    const spacingY = 260;

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
  }, []);

  const adjustEdgeCurves = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const edgePairs: Record<string, cytoscape.EdgeSingular[]> = {};
    cy.edges().forEach(edge => {
      const key = `${edge.source().id()}|${edge.target().id()}`;
      if (!edgePairs[key]) edgePairs[key] = [];
      edgePairs[key].push(edge);
    });

    Object.entries(edgePairs).forEach(([_, edges]) => {
      if (edges.length === 0) return;

      const sourcePos = edges[0].source().position();
      const targetPos = edges[0].target().position();
      const sourceTier = edges[0].source().data('tier');
      const targetTier = edges[0].target().data('tier');

      if (sourceTier !== targetTier) {
        const dx = targetPos.x - sourcePos.x;
        const absDx = Math.abs(dx);

        edges.forEach((edge) => {
          const pairIdx = edge.data('pairIndex') || 0;
          let baseCurve = 30;

          if (absDx > 200) {
            baseCurve = 50;
          } else if (absDx > 100) {
            baseCurve = 40;
          } else if (absDx > 50) {
            baseCurve = 35;
          }

          const sign = pairIdx % 2 === 0 ? 1 : -1;
          const magnitude = Math.floor(pairIdx / 2) + 1;
          const crossingSign = dx > 0 ? -1 : 1;
          const distance = crossingSign * sign * magnitude * baseCurve;

          edge.data('dist', distance);
        });
      } else {
        edges.forEach((edge) => {
          const pairIdx = edge.data('pairIndex') || 0;
          const sign = pairIdx % 2 === 0 ? 1 : -1;
          const magnitude = Math.floor(pairIdx / 2) + 1;
          edge.data('dist', sign * magnitude * 30);
        });
      }
    });
  }, []);

  const registerCustomZoom = useCallback(() => {
    const cy = cyRef.current;
    if (!cy || zoomHandlerRegisteredRef.current) return;
    zoomHandlerRegisteredRef.current = true;
    cy.userZoomingEnabled(false);
    const container = cy.container();
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      if (!cy) return;
      event.preventDefault();
      const step = event.deltaY;
      const isTrackpad = Math.abs(step) < 50;
      const sensitivity = isTrackpad ? 0.002 : 0.0002;
      const factor = Math.pow(10, -step * sensitivity);
      const newZoom = cy.zoom() * factor;
      cy.zoom({
        level: newZoom,
        renderedPosition: { x: event.offsetX, y: event.offsetY }
      });
      updateLabelScale();
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
  }, [updateLabelScale]);

  const registerCyClickEvents = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.on('tap', 'node', evt => {
      clearHighlights();
      const node = evt.target;
      node.addClass('highlight');
      node.connectedEdges().addClass('highlight');
      displayInfo('Node', node.data('raw'));
      updateEdgeLabelVisibility();
    });

    const dbl = (evt: any) => {
      const raw = evt.target.data('raw');
      const name = raw?.metadata?.name;
      const namespace = raw?.metadata?.namespace;
      const nodeDetails = raw?.status?.['node-details'] ?? raw?.spec?.productionAddress?.ipv4;
      if (name) {
        postMessage({
          command: 'sshTopoNode',
          name,
          namespace,
          nodeDetails
        });
      }
    };
    cy.on('dblclick', 'node', dbl);

    cy.on('tap', 'edge', evt => {
      clearHighlights();
      const edge = evt.target;
      edge.addClass('highlight');
      edge.connectedNodes().addClass('highlight');
      const raw = edge.data('raw');
      const rawResource = edge.data('rawResource');
      const state = edge.data('state');
      const sourceState = edge.data('sourceState');
      const targetState = edge.data('targetState');
      displayInfo('Link', { ...raw, rawResource, state, sourceState, targetState });
      updateEdgeLabelVisibility();
    });

    cy.on('tap', evt => {
      if (evt.target === cy) {
        clearHighlights();
        updateEdgeLabelVisibility();
      }
    });
  }, [clearHighlights, displayInfo, updateEdgeLabelVisibility, postMessage]);

  const renderTopology = useCallback((nodes: TopologyNode[], edges: TopologyEdge[]) => {
    const namespaceChanged = currentNamespaceRef.current !== selectedNamespace;
    currentNamespaceRef.current = selectedNamespace;

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
        id: idParts.join('--'),
        source: e.source,
        target: e.target,
        raw: e.raw,
        rawResource: e.rawResource,
        dist: distance,
        weight: 0.5,
        pairIndex: idx
      };

      if (e.sourceInterface) {
        edgeData.sourceInterface = shortenInterfaceName(e.sourceInterface);
      }
      if (e.targetInterface) {
        edgeData.targetInterface = shortenInterfaceName(e.targetInterface);
      }
      if (e.state) edgeData.state = e.state;
      if (e.sourceState) edgeData.sourceState = e.sourceState;
      if (e.targetState) edgeData.targetState = e.targetState;

      elements.push({ group: 'edges', data: edgeData });
    });

    if (!cyRef.current) {
      const win = window as unknown as { cytoscape: (opts: cytoscape.CytoscapeOptions) => cytoscape.Core };
      cyRef.current = win.cytoscape({
        container: cyContainerRef.current,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': '#001135',
              'background-image': nodeIconRef.current,
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
        layout: { name: 'preset' },
        wheelSensitivity: 0
      });

      cyRef.current.ready(() => {
        layoutByTier();
        adjustEdgeCurves();
        createEdgeTippies();
        cyRef.current!.fit(cyRef.current!.elements(), 50);
        applyThemeColors();
        updateEdgeLabelVisibility();
        registerCyClickEvents();
        registerCustomZoom();
      });
    } else if (namespaceChanged) {
      clearHighlights();
      cyRef.current.elements().remove();
      cyRef.current.add(elements);
      layoutByTier();
      adjustEdgeCurves();
      createEdgeTippies();
      cyRef.current.fit(cyRef.current.elements(), 50);
      applyThemeColors();
      updateEdgeLabelVisibility();
      registerCustomZoom();
    } else {
      // Incremental update logic (simplified for React)
      clearHighlights();
      cyRef.current.elements().remove();
      cyRef.current.add(elements);
      adjustEdgeCurves();
      createEdgeTippies();
      applyThemeColors();
      updateEdgeLabelVisibility();
      registerCustomZoom();
    }
  }, [
    selectedNamespace,
    layoutByTier,
    adjustEdgeCurves,
    createEdgeTippies,
    applyThemeColors,
    updateEdgeLabelVisibility,
    registerCyClickEvents,
    registerCustomZoom,
    clearHighlights
  ]);

  useMessageListener<TopologyMessage>(useCallback((msg) => {
    if (msg.command === 'init') {
      setNamespaces(msg.namespaces || []);
      setSelectedNamespace(msg.selected || (msg.namespaces?.[0] || ''));
    } else if (msg.command === 'data') {
      renderTopology(msg.nodes || [], msg.edges || []);
    }
  }, []));

  // Update label visibility when mode changes
  useEffect(() => {
    updateEdgeLabelVisibility();
  }, [labelMode, updateEdgeLabelVisibility]);

  const handleNamespaceChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const ns = e.target.value;
    setSelectedNamespace(ns);
    postMessage({ command: 'setNamespace', namespace: ns });
  }, [postMessage]);

  const handleExport = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const nodes = cy.nodes();
    const edges = cy.edges();
    const prevNodeLabels: string[] = [];
    const prevNodeColors: string[] = [];
    const prevBorders: string[] = [];
    const prevEdgeWidths: string[] = [];
    const prevEdgeColors: string[] = [];

    nodes.forEach(n => {
      prevNodeLabels.push(n.style('label'));
      prevNodeColors.push(n.style('color'));
      prevBorders.push(n.style('border-width'));
      if (!exportIncludeLabels) {
        n.style('label', '');
      }
      n.style('border-width', 0);
      n.style('color', exportFontColor);
    });

    edges.forEach(e => {
      prevEdgeWidths.push(e.style('width'));
      prevEdgeColors.push(e.style('color'));
      e.style('width', exportLinkThickness);
      e.style('color', exportFontColor);
    });

    const svgOpts: any = { full: true };
    if (!exportBgTransparent) {
      svgOpts.bg = exportBgColor;
    }

    let svg = cy.svg(svgOpts);

    if (exportIncludeLabels) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svg, 'image/svg+xml');
      const root = doc.documentElement;

      const style = getComputedStyle(document.documentElement);
      const bg = style.getPropertyValue('--edge-label-bg').trim() || '#fff';
      const border = style.getPropertyValue('--edge-label-border').trim() || '#000';
      const bb = cy.elements().boundingBox();
      const pxRatio = (cy as any).renderer().getPixelRatio();

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
        textEl.setAttribute('fill', exportFontColor);
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
          const pos = edgeLabelPosition(edge, 0.2, offset, true, shift);
          const x = (pos.x - bb.x1) * pxRatio;
          const y = (pos.y - bb.y1) * pxRatio;
          createLabel(x, y, src);
        }
        if (tgt) {
          const pos = edgeLabelPosition(edge, 0.2, offset, false, shift);
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

    updateEdgeLabelVisibility();
    setShowExportPopup(false);
  }, [exportIncludeLabels, exportFontColor, exportLinkThickness, exportBgTransparent, exportBgColor, edgeLabelPosition, updateEdgeLabelVisibility]);

  const showExportPopupWithDefaults = useCallback(() => {
    const bodyColor = getComputedStyle(document.body).color;
    const cyContainer = document.getElementById('cy');
    const bgColor = cyContainer ? getComputedStyle(cyContainer).backgroundColor : 'white';

    const rgbToHex = (color: string): string => {
      const ctx = document.createElement('div');
      ctx.style.color = color;
      document.body.appendChild(ctx);
      const computed = getComputedStyle(ctx).color;
      document.body.removeChild(ctx);
      const m = computed.match(/\d+/g);
      if (!m) return '#000000';
      const [r, g, b] = m.map(x => Number(x));
      return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    };

    setExportFontColor(rgbToHex(bodyColor));
    setExportBgColor(rgbToHex(bgColor));
    setShowExportPopup(true);
  }, []);

  return (
    <div className="dashboard">
      <header className="header">
        <button className="toggle-btn" onClick={showExportPopupWithDefaults}>Export SVG</button>
        <select
          className="select label-select"
          value={labelMode}
          onChange={(e) => setLabelMode(e.target.value as 'hide' | 'show' | 'select')}
        >
          <option value="hide">Hide Labels</option>
          <option value="show">Show Labels</option>
          <option value="select">Show Link Labels on Select</option>
        </select>
        <select
          className="select"
          value={selectedNamespace}
          onChange={handleNamespaceChange}
        >
          {namespaces.map(ns => (
            <option key={ns} value={ns}>{ns}</option>
          ))}
        </select>
      </header>
      <div className="body">
        <div ref={cyContainerRef} id="cy" className="cy"></div>
        <div
          id="infoCard"
          className="info-card"
          dangerouslySetInnerHTML={{ __html: infoCardContent }}
        />
      </div>
      <div className={`popup ${showExportPopup ? '' : 'hidden'}`} id="exportPopup">
        <div className="popup-content">
          <label>
            Background Color
            <input
              type="color"
              value={exportBgColor}
              onChange={(e) => setExportBgColor(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={exportBgTransparent}
              onChange={(e) => setExportBgTransparent(e.target.checked)}
            /> Transparent
          </label>
          <label>
            Font Color
            <input
              type="color"
              value={exportFontColor}
              onChange={(e) => setExportFontColor(e.target.value)}
            />
          </label>
          <label>
            Link Thickness
            <input
              type="number"
              min={0}
              value={exportLinkThickness}
              onChange={(e) => setExportLinkThickness(parseInt(e.target.value, 10) || 1)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={exportIncludeLabels}
              onChange={(e) => setExportIncludeLabels(e.target.checked)}
            /> Include Labels
          </label>
          <div className="popup-buttons">
            <button className="toggle-btn" onClick={handleExport}>Export</button>
            <button className="toggle-btn" onClick={() => setShowExportPopup(false)}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

mountWebview(TopologyDashboard);
