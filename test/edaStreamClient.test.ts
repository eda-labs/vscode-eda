import { expect } from 'chai';
import sinon from 'sinon';

import { EdaStreamClient } from '../src/clients/edaStreamClient';

describe('EdaStreamClient', () => {
  const originalInterval = process.env.EDA_STREAM_NEXT_INTERVAL_MS;
  const NODEGROUP_PATH = '/apps/x/v1/namespaces/{namespace}/nodegroups';
  const NODEGROUP_STREAM = 'nodegroups';
  const CORE_NAMESPACE = 'eda-system';

  afterEach(() => {
    sinon.restore();
    if (originalInterval === undefined) {
      delete process.env.EDA_STREAM_NEXT_INTERVAL_MS;
    } else {
      process.env.EDA_STREAM_NEXT_INTERVAL_MS = originalInterval;
    }
  });

  it('uses a fast default next-message interval', () => {
    delete process.env.EDA_STREAM_NEXT_INTERVAL_MS;

    const client = new EdaStreamClient();

    expect((client as any).messageIntervalMs).to.equal(25);
    client.dispose();
  });

  it('honors EDA_STREAM_NEXT_INTERVAL_MS when set', () => {
    process.env.EDA_STREAM_NEXT_INTERVAL_MS = '0';

    const client = new EdaStreamClient();

    expect((client as any).messageIntervalMs).to.equal(0);
    client.dispose();
  });

  it('sends next immediately when interval is zero', () => {
    const client = new EdaStreamClient() as any;
    client.messageIntervalMs = 0;

    const activeStub = sinon.stub(client, 'isLogicalStreamActive').returns(true);
    const sendStub = sinon.stub(client, 'sendNextMessage');

    client.scheduleNextMessage('toponodes');

    expect(sendStub.calledOnceWithExactly('toponodes')).to.equal(true);
    activeStub.restore();
    sendStub.restore();
    client.dispose();
  });

  it('does not restart namespaced streams when namespace set is unchanged', () => {
    const client = new EdaStreamClient() as any;
    client.eventSocket = { readyState: 1, close: () => undefined };
    client.eventClient = 'event-client';
    client.activeStreams = new Set([NODEGROUP_STREAM]);
    client.namespaces = new Set([CORE_NAMESPACE]);
    client.streamEndpoints = [
      { stream: NODEGROUP_STREAM, path: NODEGROUP_PATH, namespaced: true, namespaceParam: 'namespace' }
    ];

    const startNamespacedStub = sinon.stub(client, 'startNamespacedEndpointStreams');
    const sendNextStub = sinon.stub(client, 'sendNextForLogicalStream');

    client.setNamespaces([CORE_NAMESPACE]);

    expect(startNamespacedStub.called).to.equal(false);
    expect(sendNextStub.called).to.equal(false);
    startNamespacedStub.restore();
    sendNextStub.restore();
    client.dispose();
  });

  it('starts namespaced streams only for newly added namespaces', () => {
    const client = new EdaStreamClient() as any;
    client.eventSocket = { readyState: 1, close: () => undefined };
    client.eventClient = 'event-client';
    client.activeStreams = new Set([NODEGROUP_STREAM]);
    client.namespaces = new Set([CORE_NAMESPACE]);
    client.streamEndpoints = [
      { stream: NODEGROUP_STREAM, path: NODEGROUP_PATH, namespaced: true, namespaceParam: 'namespace' }
    ];

    const startNamespacedStub = sinon.stub(client, 'startNamespacedEndpointStreams');
    const sendNextStub = sinon.stub(client, 'sendNextForLogicalStream');

    client.setNamespaces([CORE_NAMESPACE, 'eda']);

    expect(startNamespacedStub.calledOnce).to.equal(true);
    expect(startNamespacedStub.firstCall.args[2]).to.deep.equal(['eda']);
    expect(sendNextStub.calledOnceWithExactly(NODEGROUP_STREAM)).to.equal(true);
    startNamespacedStub.restore();
    sendNextStub.restore();
    client.dispose();
  });
});
