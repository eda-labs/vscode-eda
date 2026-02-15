import { expect } from 'chai';
import sinon from 'sinon';
// Use CommonJS require to obtain a mutable module object for stubbing
import undici = require('undici');

import { EdaApiClient } from '../src/clients/edaApiClient';
import type { EdaAuthClient } from '../src/clients/edaAuthClient';
import * as extension from '../src/extension';

const CORE_EDA_GROUP = 'core.eda.nokia.com';
const CORE_NAMESPACE = 'eda-system';

/** Helper to create a mock fetch response */
function mockResponse(status: number, body: any) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as any);
}

describe('EdaApiClient token refresh', () => {
  let fetchStub: sinon.SinonStub;
  let authClient: EdaAuthClient;
  let logStub: sinon.SinonStub;

  beforeEach(() => {
    fetchStub = sinon.stub(undici, 'fetch');
    logStub = sinon.stub(extension, 'log');
    authClient = {
      getBaseUrl: () => 'https://api',
      getHeaders: () => ({ Authorization: 'Bearer token' }),
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

  it('retries the request after refreshing the token', async () => {
    fetchStub
      .onFirstCall()
      .returns(mockResponse(401, { message: 'Access token has expired' }))
      .onSecondCall()
      .returns(mockResponse(200, { foo: 'bar' }));

    const client = new EdaApiClient(authClient);
    const result = await client.requestJSON('GET', '/foo');

    expect(result).to.deep.equal({ foo: 'bar' });
    expect((authClient.refreshAuth as sinon.SinonStub).called).to.be.true;
    expect(fetchStub.calledTwice).to.be.true;
  });

  it('fetches EQL autocomplete results', async () => {
    fetchStub.returns(
      mockResponse(200, { completions: [{ token: 'foo', completion: 'oo' }] })
    );

    const client = new EdaApiClient(authClient);
    const result = await client.autocompleteEql('f', 20);

    expect(result).to.deep.equal(['foo']);
    expect(fetchStub.calledOnce).to.be.true;
  });

  it('fetches transaction details using v2 endpoints', async () => {
    const specManager = {
      getPathByOperationId: sinon.stub()
    } as any;
    specManager.getPathByOperationId.withArgs('transGetSummaryResult').resolves('/core/transaction/v2/result/summary/{transactionId}');
    specManager.getPathByOperationId.withArgs('transGetResultExecution').resolves('/core/transaction/v2/result/execution/{transactionId}');
    specManager.getPathByOperationId.withArgs('transGetResultInputResources').resolves('/core/transaction/v2/result/inputresources/{transactionId}');

    fetchStub
      .onCall(0)
      .returns(mockResponse(200, { id: 1, state: 'complete' }))
      .onCall(1)
      .returns(mockResponse(200, { changedCrs: [] }))
      .onCall(2)
      .returns(mockResponse(200, { inputCrs: [] }));

    const client = new EdaApiClient(authClient);
    client.setSpecManager(specManager);
    const result = await client.getTransactionDetails(1);

    expect(fetchStub.callCount).to.equal(3);
    expect(result).to.deep.equal({ id: 1, state: 'complete', changedCrs: [], inputCrs: [] });
  });

  it('lists workflows using namespaced workflow operationId', async () => {
    const specManager = {
      getPathByOperationId: sinon.stub()
    } as any;
    specManager.getPathByOperationId
      .withArgs('listCoreEdaNokiaComV1NamespacedWorkflow')
      .resolves('/apis/core.eda.nokia.com/v1/namespaces/{namespace}/workflows');

    fetchStub.returns(mockResponse(200, { items: [{ metadata: { name: 'wf-a' } }] }));

    const client = new EdaApiClient(authClient);
    client.setSpecManager(specManager);

    const workflows = await client.listResources(CORE_EDA_GROUP, 'v1', 'Workflow', 'fabric-a');

    expect(workflows).to.have.length(1);
    expect(fetchStub.firstCall.args[0]).to.equal('https://api/apis/core.eda.nokia.com/v1/namespaces/fabric-a/workflows');
  });

  it('lists workflow definitions across namespaces using operationId', async () => {
    const specManager = {
      getPathByOperationId: sinon.stub(),
      getCoreNamespace: () => CORE_NAMESPACE,
      getCachedNamespaces: () => []
    } as any;
    specManager.getPathByOperationId
      .withArgs('listCoreEdaNokiaComV1WorkflowDefinitionForAllNamespaces')
      .resolves('/apis/core.eda.nokia.com/v1/workflowdefinitions');

    fetchStub.returns(mockResponse(200, { items: [{ metadata: { name: 'oam-ping-gvk' } }] }));

    const client = new EdaApiClient(authClient);
    client.setSpecManager(specManager);

    const definitions = await client.listResources(CORE_EDA_GROUP, 'v1', 'WorkflowDefinition');

    expect(definitions).to.have.length(1);
    expect(fetchStub.firstCall.args[0]).to.equal('https://api/apis/core.eda.nokia.com/v1/workflowdefinitions');
  });

  it('creates a workflow using namespaced workflow operationId', async () => {
    const specManager = {
      getPathByOperationId: sinon.stub()
    } as any;
    specManager.getPathByOperationId
      .withArgs('createCoreEdaNokiaComV1NamespacedWorkflow')
      .resolves('/apis/core.eda.nokia.com/v1/namespaces/{namespace}/workflows');

    const workflow = {
      apiVersion: 'core.eda.nokia.com/v1',
      kind: 'Workflow',
      metadata: {
        name: 'wf-create',
        namespace: 'fabric-a'
      },
      spec: {
        type: 'oam-ping-gvk'
      }
    };

    fetchStub.returns(mockResponse(200, workflow));

    const client = new EdaApiClient(authClient);
    client.setSpecManager(specManager);

    const result = await client.createResource(CORE_EDA_GROUP, 'v1', 'Workflow', workflow, 'fabric-a');
    const requestInit = fetchStub.firstCall.args[1] as { method?: string; body?: string };

    expect(result).to.deep.equal(workflow);
    expect(fetchStub.firstCall.args[0]).to.equal('https://api/apis/core.eda.nokia.com/v1/namespaces/fabric-a/workflows');
    expect(requestInit.method).to.equal('POST');
    expect(JSON.parse(requestInit.body ?? '{}')).to.deep.equal(workflow);
  });

  it('lists workflow-backed resources using standard namespaced operationId', async () => {
    const specManager = {
      getPathByOperationId: sinon.stub()
    } as any;
    specManager.getPathByOperationId
      .withArgs('listAppstoreEdaNokiaComV1NamespacedAppInstaller')
      .resolves('/apis/appstore.eda.nokia.com/v1/namespaces/{namespace}/appinstallers');

    fetchStub.returns(mockResponse(200, { items: [{ metadata: { name: 'dryrun-netbox' } }] }));

    const client = new EdaApiClient(authClient);
    client.setSpecManager(specManager);

    const resources = await client.listResources(
      'appstore.eda.nokia.com',
      'v1',
      'AppInstaller',
      CORE_NAMESPACE
    );

    expect(resources).to.have.length(1);
    expect(fetchStub.firstCall.args[0]).to.equal(
      'https://api/apis/appstore.eda.nokia.com/v1/namespaces/eda-system/appinstallers'
    );
  });

  it('falls back to apps path when all-namespace operationId is unavailable', async () => {
    const specManager = {
      getPathByOperationId: sinon.stub().rejects(new Error('not found')),
      getCoreNamespace: () => CORE_NAMESPACE,
      getCachedNamespaces: () => []
    } as any;

    fetchStub.returns(mockResponse(200, { items: [] }));

    const client = new EdaApiClient(authClient);
    client.setSpecManager(specManager);

    const resources = await client.listResources(
      'topologies.eda.nokia.com',
      'v1alpha1',
      'NetworkTopology'
    );

    expect(resources).to.deep.equal([]);
    expect(fetchStub.firstCall.args[0]).to.equal(
      'https://api/apps/topologies.eda.nokia.com/v1alpha1/networktopologies'
    );
  });
});
