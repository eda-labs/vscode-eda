import { expect } from 'chai';

import {
  collectGrafanaEdgeCellMappings,
  buildGrafanaPanelYaml,
  buildGrafanaDashboardJson,
  sanitizeSvgForGrafana,
  removeUnlinkedNodesFromSvg,
  DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS
} from '../src/webviews/dashboard/topologyFlow/svg-export/index';

describe('topology grafana export helpers', () => {
  it('collects mappings only for edges with valid endpoints and skips duplicates', () => {
    const nodes = [
      { id: 'leaf1', type: 'deviceNode' },
      { id: 'leaf2', type: 'deviceNode' }
    ] as unknown[];

    const edges = [
      {
        id: 'edge-a',
        source: 'leaf1',
        target: 'leaf2',
        data: { sourceEndpoint: 'ethernet-1/1', targetEndpoint: 'ethernet-1/2' }
      },
      {
        id: 'edge-b',
        source: 'leaf1',
        target: 'leaf2',
        data: { sourceEndpoint: 'ethernet-1/1', targetEndpoint: 'ethernet-1/2' }
      },
      {
        id: 'edge-c',
        source: 'leaf1',
        target: 'leaf2',
        data: { sourceEndpoint: '', targetEndpoint: 'ethernet-1/2' }
      }
    ] as unknown[];

    const mappings = collectGrafanaEdgeCellMappings(
      edges as never,
      nodes as never,
      new Set<string>()
    );

    expect(mappings).to.have.length(1);
    expect(mappings[0]).to.include({
      edgeId: 'edge-a',
      source: 'leaf1',
      target: 'leaf2',
      sourceEndpoint: 'ethernet-1/1',
      targetEndpoint: 'ethernet-1/2'
    });
  });

  it('builds panel yaml with thresholds and optional hide-rates tags', () => {
    const mappings = [
      {
        edgeId: 'edge-a',
        source: 'leaf1',
        sourceEndpoint: 'ethernet-1/1',
        target: 'leaf2',
        targetEndpoint: 'ethernet-1/2',
        operstateCellId: 'leaf1:ethernet-1/1',
        targetOperstateCellId: 'leaf2:ethernet-1/2',
        trafficCellId: 'link_id:leaf1:ethernet-1/1:leaf2:ethernet-1/2',
        reverseTrafficCellId: 'link_id:leaf2:ethernet-1/2:leaf1:ethernet-1/1'
      }
    ];

    const yamlWithTags = buildGrafanaPanelYaml(mappings, {
      trafficThresholds: {
        green: 100,
        yellow: 200,
        orange: 300,
        red: 400
      },
      includeHideRatesLegendToggle: true
    });

    expect(yamlWithTags).to.contain('tagConfig:');
    expect(yamlWithTags).to.contain('tags: ["hide-rates"]');
    expect(yamlWithTags).to.contain('level: 100');
    expect(yamlWithTags).to.contain('level: 400');

    const yamlNoTags = buildGrafanaPanelYaml(mappings, {
      trafficThresholds: DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS,
      includeHideRatesLegendToggle: false
    });

    expect(yamlNoTags).to.not.contain('tagConfig:');
    expect(yamlNoTags).to.not.contain('tags: ["hide-rates"]');
  });

  it('builds dashboard json with embedded panel yaml and svg', () => {
    const panelConfig = 'cells:\n  {}\n';
    const svg = '<svg><g id="cell-test"></g></svg>';

    const json = buildGrafanaDashboardJson(panelConfig, svg, 'Lab A');
    const parsed = JSON.parse(json) as {
      title: string;
      panels: Array<{ options: { panelConfig: string; svg: string } }>;
    };

    expect(parsed.title).to.equal('Lab A');
    expect(parsed.panels[0].options.panelConfig).to.equal(panelConfig);
    expect(parsed.panels[0].options.svg).to.equal(svg);
  });

  it('sanitizes text-shadow filter usage and removes unlinked nodes', () => {
    const withFilter =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="text-shadow"><feGaussianBlur stdDeviation="1.5"/></filter></defs><text filter="url(#text-shadow)">n1</text></svg>';
    const sanitized = sanitizeSvgForGrafana(withFilter);
    expect(sanitized).to.not.contain('filter="url(#text-shadow)"');
    expect(sanitized).to.not.contain('<filter id="text-shadow"');

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<g class="export-node topology-node" data-id="leaf1"></g>'
      + '<g class="export-node topology-node" data-id="orphan"></g>'
      + '</svg>';

    const filtered = removeUnlinkedNodesFromSvg(svg, new Set(['leaf1']));
    expect(filtered).to.contain('data-id="leaf1"');
    expect(filtered).to.not.contain('data-id="orphan"');
  });
});
