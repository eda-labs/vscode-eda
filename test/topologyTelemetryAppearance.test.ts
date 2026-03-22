import { expect } from 'chai';

import {
  clampTelemetryInterfaceScale,
  clampTelemetryNodeSizePx,
  getAutoCompactInterfaceLabel,
  getTelemetryLabelMetrics
} from '../src/webviews/dashboard/topologyFlow/telemetryAppearance';

describe('topology telemetry appearance helpers', () => {
  it('clamps telemetry node and interface sizing ranges', () => {
    expect(clampTelemetryNodeSizePx(8)).to.equal(12);
    expect(clampTelemetryNodeSizePx(300)).to.equal(240);
    expect(clampTelemetryNodeSizePx(Number.NaN)).to.equal(80);

    expect(clampTelemetryInterfaceScale(0.1)).to.equal(0.4);
    expect(clampTelemetryInterfaceScale(8)).to.equal(4);
    expect(clampTelemetryInterfaceScale(Number.NaN)).to.equal(1);
  });

  it('builds compact labels from interface endpoints', () => {
    expect(getAutoCompactInterfaceLabel('ethernet-1/27')).to.equal('27');
    expect(getAutoCompactInterfaceLabel('xe-0/0/0')).to.equal('0');
    expect(getAutoCompactInterfaceLabel('et1')).to.equal('1');
    expect(getAutoCompactInterfaceLabel('no-delimiters')).to.equal('ers');
  });

  it('computes telemetry label metrics based on interface scale', () => {
    const small = getTelemetryLabelMetrics('12', 0.4);
    const regular = getTelemetryLabelMetrics('12', 1);
    const large = getTelemetryLabelMetrics('12', 2);

    expect(small.compact).to.equal('12');
    expect(small.radius).to.be.lessThan(regular.radius);
    expect(large.radius).to.be.greaterThan(regular.radius);
    expect(regular.fontSize).to.equal(9);
  });
});
