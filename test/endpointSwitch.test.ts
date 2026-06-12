import * as os from 'os';
import * as path from 'path';

import { expect } from 'chai';
import sinon from 'sinon';
// Use CommonJS require to obtain a mutable module object for stubbing
import undici = require('undici');

import { EdaClient } from '../src/clients/edaClient';
import { EdaStreamClient } from '../src/clients/edaStreamClient';
import { EdaSpecManager, specCacheBaseDirForUrl } from '../src/clients/edaSpecManager';
import * as extension from '../src/extension';

/** Helper to create a mock fetch response */
function mockResponse(status: number, body: any) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as any);
}

describe('specCacheBaseDirForUrl', () => {
  const root = path.join(os.homedir(), '.eda', 'vscode');

  it('keys the cache dir by endpoint host including port', () => {
    expect(specCacheBaseDirForUrl('https://my-eda.example.com')).to.equal(
      path.join(root, 'my-eda.example.com')
    );
    expect(specCacheBaseDirForUrl('https://localhost:9443')).to.equal(
      path.join(root, 'localhost_9443')
    );
  });

  it('produces distinct dirs for distinct hosts of the same EDA version', () => {
    const a = specCacheBaseDirForUrl('https://localhost:9443');
    const b = specCacheBaseDirForUrl('https://127.0.0.1:9443');
    expect(a).to.not.equal(b);
  });

  it('falls back to the legacy shared dir for missing or invalid URLs', () => {
    expect(specCacheBaseDirForUrl(undefined)).to.equal(root);
    expect(specCacheBaseDirForUrl('not a url')).to.equal(root);
  });

  it('is used by EdaSpecManager when a base URL is provided', () => {
    const manager = new EdaSpecManager({} as any, 'eda-system', 'https://localhost:9443');
    expect((manager as any).cacheBaseDir).to.equal(path.join(root, 'localhost_9443'));
  });
});

describe('EdaStreamClient.resetForEndpointSwitch', () => {
  it('preserves regular streams but drops endpoint-specific state', () => {
    const client = new EdaStreamClient() as any;
    client.activeStreams = new Set(['toponodes', 'interfaces', 'my-eql', 'my-nql', 'file']);
    client.eqlStreams = new Map([['my-eql', { query: '.namespace' }]]);
    client.nqlStreams = new Map([['my-nql', { query: '.namespace' }]]);
    client.streamAliases = new Map([['interfaces__ns__fabric', 'interfaces']]);
    client.namespaces = new Set(['fabric', 'eda-system']);
    client.userStorageFiles = new Set(['layouts/topo.json']);
    client.eventClient = 'old-event-client';

    client.resetForEndpointSwitch();

    expect(Array.from(client.activeStreams)).to.have.members(['toponodes', 'interfaces']);
    expect(client.eqlStreams.size).to.equal(0);
    expect(client.nqlStreams.size).to.equal(0);
    expect(client.streamAliases.size).to.equal(0);
    expect(client.namespaces.size).to.equal(0);
    expect(client.userStorageFiles.size).to.equal(0);
    expect(client.eventClient).to.equal(undefined);
    // The instance must stay usable: providers keep their event subscriptions.
    expect(client.disposed).to.equal(false);

    client.dispose();
  });
});

describe('EdaClient.switchEndpoint', () => {
  let fetchStub: sinon.SinonStub;
  let logStub: sinon.SinonStub;

  beforeEach(() => {
    logStub = sinon.stub(extension, 'log');
    fetchStub = sinon.stub(undici, 'fetch').callsFake((url: any) => {
      const u = String(url);
      if (u.includes('new-host')) {
        return mockResponse(401, 'unauthorized');
      }
      if (u.includes('openid-connect/token')) {
        return mockResponse(200, { access_token: 'tok' });
      }
      return mockResponse(500, 'not available');
    });
  });

  afterEach(() => {
    fetchStub.restore();
    logStub.restore();
  });

  it('keeps the old endpoint fully intact when auth against the new one fails', async () => {
    const client = new EdaClient('https://old-host', {
      clientSecret: 'secret',
      coreNamespace: 'eda-system'
    });
    await client.waitForInit();

    const internals = client as any;
    const oldAuth = internals.authClient;
    const oldSpecManager = internals.specManager;
    internals.streamRefCounts.set('toponodes', 2);

    let thrown: unknown;
    try {
      await client.switchEndpoint('https://new-host', {
        clientSecret: 'secret',
        coreNamespace: 'eda-system'
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown, 'switchEndpoint should reject on auth failure').to.not.equal(undefined);
    expect(String(thrown)).to.include('new-host');
    // Nothing was torn down: same auth client, same spec manager, ref counts
    // preserved, API gate released.
    expect(internals.authClient).to.equal(oldAuth);
    expect(internals.specManager).to.equal(oldSpecManager);
    expect(internals.streamRefCounts.get('toponodes')).to.equal(2);
    expect(internals.switchInProgress).to.equal(false);
    await client.waitForInit();

    client.dispose();
  });
});
