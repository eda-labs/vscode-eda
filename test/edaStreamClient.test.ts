import { expect } from 'chai';
import sinon from 'sinon';
import undici = require('undici');
import { EdaStreamClient } from '../src/clients/edaStreamClient';
import type { EdaAuthClient } from '../src/clients/edaAuthClient';
import * as extension from '../src/extension';

function mockResponse(status: number, body: any, stream = false) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    body: stream
      ? { getReader: () => ({ read: async () => ({ value: undefined, done: true }) }) }
      : undefined,
  } as any);
}

describe('EdaStreamClient token refresh', () => {
  let fetchStub: sinon.SinonStub;
  let authClient: EdaAuthClient;
  let logStub: sinon.SinonStub;

  beforeEach(() => {
    fetchStub = sinon.stub(undici, 'fetch');
    logStub = sinon.stub(extension, 'log');
    authClient = {
      getBaseUrl: () => 'http://api',
      getHeaders: () => ({ Authorization: 'Bearer token' }),
      getWsHeaders: () => ({ Authorization: 'Bearer token' }),
      getWsOptions: () => ({}),
      getAgent: () => undefined,
      waitForAuth: sinon.stub().resolves(),
      refreshAuth: sinon.stub().resolves(),
      onTokenRefreshed: sinon.stub(),
      offTokenRefreshed: sinon.stub(),
      isTokenExpiredResponse: (status: number, body: string) => status === 401 && body.includes('Access token has expired'),
    } as unknown as EdaAuthClient;
  });

  afterEach(() => {
    fetchStub.restore();
    logStub.restore();
  });

  it('retries the SSE request after refreshing the token', async () => {
    fetchStub
      .onFirstCall()
      .returns(mockResponse(401, { message: 'Access token has expired' }))
      .onSecondCall()
      .returns(mockResponse(200, '', true));

    const client = new EdaStreamClient();
    client.setAuthClient(authClient);

    await (client as any).streamSse('http://api/stream');

    expect((authClient.refreshAuth as sinon.SinonStub).called).to.be.true;
    expect(fetchStub.calledTwice).to.be.true;
  });
});
