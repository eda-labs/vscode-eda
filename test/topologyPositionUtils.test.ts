import { expect } from 'chai';

import {
  nodePositionMapsEqual,
  normalizeNodePositionMap,
  parseNodePositionAnnotation,
  serializeNodePositionAnnotation,
  topologyNodeIdToName
} from '../src/webviews/dashboard/topologyFlow/topologyPositionUtils';

describe('topologyPositionUtils', () => {
  it('normalizes and rounds position maps', () => {
    const normalized = normalizeNodePositionMap({
      leaf1: { x: 12.6, y: 48.1 },
      leaf2: { x: Number.NaN, y: 10 },
      leaf3: { x: 22, y: 33, extra: true },
      empty: null
    });

    expect(normalized).to.deep.equal({
      leaf1: { x: 13, y: 48 },
      leaf3: { x: 22, y: 33 }
    });
  });

  it('parses annotation JSON safely', () => {
    const parsed = parseNodePositionAnnotation('{"leaf1":{"x":10.2,"y":20.8}}');
    expect(parsed).to.deep.equal({ leaf1: { x: 10, y: 21 } });
    expect(parseNodePositionAnnotation('not-json')).to.deep.equal({});
  });

  it('serializes in stable key order', () => {
    const serialized = serializeNodePositionAnnotation({
      spine2: { x: 90, y: 30 },
      leaf1: { x: 10.4, y: 20.6 }
    });

    expect(serialized).to.equal('{"leaf1":{"x":10,"y":21},"spine2":{"x":90,"y":30}}');
  });

  it('compares node position maps', () => {
    expect(nodePositionMapsEqual(
      { leaf1: { x: 10, y: 20 } },
      { leaf1: { x: 10, y: 20 } }
    )).to.equal(true);

    expect(nodePositionMapsEqual(
      { leaf1: { x: 10, y: 20 } },
      { leaf1: { x: 11, y: 20 } }
    )).to.equal(false);
  });

  it('extracts node name from topology node id', () => {
    expect(topologyNodeIdToName('eda/leaf1')).to.equal('leaf1');
    expect(topologyNodeIdToName('leaf1')).to.equal('leaf1');
  });
});
