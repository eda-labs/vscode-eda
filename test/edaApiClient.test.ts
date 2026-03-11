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

  it('bootstraps names-only resources from DB snapshot', async () => {
    const endpointPath = '/apps/core.eda.nokia.com/v1/namespaces/{namespace}/toponodes';
    const specManager = {
      getStreamEndpoints: () => [
        { path: endpointPath, stream: 'toponodes', namespaced: true, namespaceParam: 'namespace' }
      ],
      getCoreNamespace: () => CORE_NAMESPACE
    } as any;

    const calls: string[] = [];
    fetchStub.callsFake((url: string) => {
      const urlText = String(url);
      calls.push(urlText);
      if (urlText.startsWith('https://api/core/db/v2/data?')) {
        return mockResponse(200, {
          '.namespace{.name=="eda"}.resources.cr.core_eda_nokia_com.v1.toponode{.name=="leaf1"}': {
            apiVersion: 'core.eda.nokia.com/v1',
            kind: 'TopoNode',
            metadata: {
              name: 'leaf1',
              namespace: 'eda'
            }
          }
        });
      }
      return mockResponse(404, { message: 'unexpected path' });
    });

    const client = new EdaApiClient(authClient);
    client.setSpecManager(specManager);
    const namesOnlyStreams = new Set<string>();
    const snapshot = await client.bootstrapStreamItems(['eda'], {
      namesOnly: true,
      namesOnlyStreams
    });

    expect(namesOnlyStreams.has('toponodes')).to.equal(true);
    expect(calls.some((url) => url.includes('/apps/core.eda.nokia.com/v1/namespaces/eda/toponodes'))).to.equal(false);

    const dbCall = new URL(calls[0]);
    expect(dbCall.pathname).to.equal('/core/db/v2/data');
    expect(dbCall.searchParams.get('fields')).to.equal('apiVersion,kind,metadata.name,metadata.namespace');
    expect(dbCall.searchParams.get('jsPath')).to.equal('.namespace.resources.cr.core_eda_nokia_com.v1.toponode');

    const bucket = snapshot.get('toponodes:eda');
    expect(bucket).to.not.equal(undefined);
    const resource = bucket?.get('leaf1');
    expect(resource?.apiVersion).to.equal('core.eda.nokia.com/v1');
    expect(resource?.kind).to.equal('TopoNode');
    expect(resource?.metadata?.name).to.equal('leaf1');
  });

  it('includes DB names-only resources across namespaces during bootstrap', async () => {
    const endpointPath = '/apps/core.eda.nokia.com/v1/namespaces/{namespace}/toponodes';
    const specManager = {
      getStreamEndpoints: () => [
        { path: endpointPath, stream: 'toponodes', namespaced: true, namespaceParam: 'namespace' }
      ],
      getCoreNamespace: () => CORE_NAMESPACE
    } as any;

    fetchStub.callsFake((url: string) => {
      const urlText = String(url);
      if (urlText.startsWith('https://api/core/db/v2/data?')) {
        return mockResponse(200, {
          '.namespace{.name=="fabric-a"}.resources.cr.core_eda_nokia_com.v1.toponode{.name=="leaf-a"}': {
            apiVersion: 'core.eda.nokia.com/v1',
            kind: 'TopoNode',
            metadata: {
              name: 'leaf-a',
              namespace: 'fabric-a'
            }
          },
          '.namespace{.name=="eda-system"}.resources.cr.core_eda_nokia_com.v1.toponode{.name=="controller"}': {
            apiVersion: 'core.eda.nokia.com/v1',
            kind: 'TopoNode',
            metadata: {
              name: 'controller',
              namespace: 'eda-system'
            }
          }
        });
      }
      return mockResponse(404, { message: 'unexpected path' });
    });

    const client = new EdaApiClient(authClient);
    client.setSpecManager(specManager);
    const snapshot = await client.bootstrapStreamItems(['eda-system'], {
      namesOnly: true
    });

    expect(snapshot.get('toponodes:fabric-a')?.has('leaf-a')).to.equal(true);
    expect(snapshot.get('toponodes:eda-system')?.has('controller')).to.equal(true);
  });

  it('falls back to stream endpoint when names-only DB bootstrap fails', async () => {
    const endpointPath = '/apps/core.eda.nokia.com/v1/namespaces/{namespace}/toponodes';
    const specManager = {
      getStreamEndpoints: () => [
        { path: endpointPath, stream: 'toponodes', namespaced: true, namespaceParam: 'namespace' }
      ],
      getCoreNamespace: () => CORE_NAMESPACE
    } as any;

    const calls: string[] = [];
    fetchStub.callsFake((url: string) => {
      const urlText = String(url);
      calls.push(urlText);
      if (urlText.startsWith('https://api/core/db/v2/data?')) {
        return mockResponse(500, { message: 'db unavailable' });
      }
      if (urlText === 'https://api/apps/core.eda.nokia.com/v1/namespaces/eda/toponodes') {
        return mockResponse(200, {
          items: [
            {
              apiVersion: 'core.eda.nokia.com/v1',
              kind: 'TopoNode',
              metadata: {
                name: 'leaf1',
                namespace: 'eda'
              },
              spec: {
                full: true
              }
            }
          ]
        });
      }
      return mockResponse(404, { message: 'unexpected path' });
    });

    const client = new EdaApiClient(authClient);
    client.setSpecManager(specManager);
    const namesOnlyStreams = new Set<string>();
    const snapshot = await client.bootstrapStreamItems(['eda'], {
      namesOnly: true,
      namesOnlyStreams
    });

    expect(namesOnlyStreams.size).to.equal(0);
    expect(calls.some((url) => url.startsWith('https://api/core/db/v2/data?'))).to.equal(true);
    expect(calls.includes('https://api/apps/core.eda.nokia.com/v1/namespaces/eda/toponodes')).to.equal(true);

    const bucket = snapshot.get('toponodes:eda');
    const resource = bucket?.get('leaf1');
    expect(resource?.spec).to.deep.equal({ full: true });
  });
});
