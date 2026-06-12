// Live integration test for runtime endpoint switching.
//
// Skipped by default; run against a live EDA with:
//   EDA_SWITCH_RUN=true \
//   EDA_SWITCH_URL_A=https://localhost:9443 \
//   EDA_SWITCH_URL_B=https://127.0.0.1:9443 \
//   EDA_SWITCH_CLIENT_SECRET=<secret> \
//   npx mocha -r ts-node/register -r ./test/setup.ts test/endpointSwitch.integration.test.ts
//
// URL A and B may point at the same EDA instance under different hostnames;
// the switch machinery treats them as distinct endpoints either way.
import { expect } from 'chai';
import sinon from 'sinon';

import { EdaClient } from '../src/clients/edaClient';
import * as extension from '../src/extension';

const runSwitch = process.env.EDA_SWITCH_RUN === 'true';
const maybeDescribe = runSwitch ? describe : describe.skip;

const URL_A = process.env.EDA_SWITCH_URL_A || 'https://localhost:9443';
const URL_B = process.env.EDA_SWITCH_URL_B || 'https://127.0.0.1:9443';
const CLIENT_SECRET = process.env.EDA_SWITCH_CLIENT_SECRET || '';
const STREAM = process.env.EDA_SWITCH_STREAM || 'namespaces';

function waitForStreamMessage(client: EdaClient, stream: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error(`No '${stream}' stream message within ${timeoutMs}ms`));
    }, timeoutMs);
    const sub = client.onStreamMessage(name => {
      if (name === stream) {
        clearTimeout(timer);
        sub.dispose();
        resolve();
      }
    });
  });
}

maybeDescribe('runtime endpoint switch (live EDA)', function () {
  this.timeout(120_000);

  let logStub: sinon.SinonStub;
  let client: EdaClient;

  before(function () {
    if (!CLIENT_SECRET) {
      throw new Error('EDA_SWITCH_CLIENT_SECRET is required');
    }
    logStub = sinon.stub(extension, 'log');
    client = new EdaClient(URL_A, {
      clientSecret: CLIENT_SECRET,
      skipTlsVerify: true,
      coreNamespace: 'eda-system'
    });
  });

  after(function () {
    client?.dispose();
    logStub?.restore();
  });

  it('initializes against endpoint A and streams data', async function () {
    await client.waitForInit();
    const streams = await client.getStreamNames();
    expect(streams.length).to.be.greaterThan(0);

    const firstMessage = waitForStreamMessage(client, STREAM, 30_000);
    await client.streamByName(STREAM);
    await firstMessage;
    expect(client.getBaseUrl()).to.equal(URL_A);
  });

  it('switches to endpoint B and re-subscribes active streams', async function () {
    let endpointEvent: string | undefined;
    const sub = client.onEndpointChanged(e => {
      endpointEvent = e.baseUrl;
    });

    const messageAfterSwitch = waitForStreamMessage(client, STREAM, 30_000);
    await client.switchEndpoint(URL_B, {
      clientSecret: CLIENT_SECRET,
      skipTlsVerify: true,
      coreNamespace: 'eda-system'
    });
    sub.dispose();

    expect(client.getBaseUrl()).to.equal(URL_B);
    expect(endpointEvent).to.equal(URL_B);
    // The pre-switch subscription must receive data from the new endpoint
    // without re-subscribing manually.
    await messageAfterSwitch;
  });

  it('keeps the current endpoint working when a switch to a bad target fails', async function () {
    let thrown: unknown;
    try {
      await client.switchEndpoint(URL_A, {
        clientSecret: 'definitely-wrong-secret',
        skipTlsVerify: true,
        coreNamespace: 'eda-system'
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown, 'switch with a bad secret should reject').to.not.equal(undefined);
    expect(client.getBaseUrl()).to.equal(URL_B);

    // The still-active endpoint keeps serving API calls and its WebSocket
    // stays connected (nothing was torn down). The stream itself sends no
    // unsolicited message on an idle system, so don't wait for one.
    const namespaces = await client.listNamespaces();
    expect(namespaces.length).to.be.greaterThan(0);
    expect((client as any).streamClient.isConnected()).to.equal(true);
  });

  it('switches back to endpoint A repeatedly without leaking state', async function () {
    for (const target of [URL_A, URL_B, URL_A]) {
      const message = waitForStreamMessage(client, STREAM, 30_000);
      await client.switchEndpoint(target, {
        clientSecret: CLIENT_SECRET,
        skipTlsVerify: true,
        coreNamespace: 'eda-system'
      });
      expect(client.getBaseUrl()).to.equal(target);
      await message;
    }
  });
});
