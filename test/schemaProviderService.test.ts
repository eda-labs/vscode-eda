import { expect } from 'chai';
import sinon from 'sinon';

import { SchemaProviderService } from '../src/services/schemaProviderService';
import type { EdaCrd } from '../src/types';

describe('SchemaProviderService', () => {
  let service: SchemaProviderService;

  beforeEach(() => {
    service = new SchemaProviderService();
  });

  afterEach(() => {
    sinon.restore();
    service.dispose();
  });

  it('caches custom resource definitions across repeated calls', async () => {
    const specCrds: EdaCrd[] = [
      { kind: 'Workflow', group: 'core.eda.nokia.com', version: 'v1', plural: 'workflows', namespaced: true }
    ];
    const clusterCrds: EdaCrd[] = [
      { kind: 'CustomThing', group: 'custom.example.com', version: 'v1', plural: 'customthings', namespaced: true }
    ];

    const findStub = sinon.stub(service as any, 'findSpecDir').resolves('/home/clab/spec');
    const fromSpecsStub = sinon.stub(service as any, 'loadCrdsFromSpecs').resolves(specCrds);
    const fromClusterStub = sinon.stub(service as any, 'loadCrdsFromCluster').resolves(clusterCrds);

    const first = await service.getCustomResourceDefinitions();
    const second = await service.getCustomResourceDefinitions();

    expect(findStub.calledOnce).to.equal(true);
    expect(fromSpecsStub.calledOnce).to.equal(true);
    expect(fromClusterStub.calledOnce).to.equal(true);
    expect(first).to.have.length(2);
    expect(second).to.have.length(2);

    first[0].kind = 'MutatedKind';
    const third = await service.getCustomResourceDefinitions();
    expect(third.some(def => def.kind === 'MutatedKind')).to.equal(false);
  });

  it('deduplicates concurrent CRD loads into one in-flight request', async () => {
    const specCrds: EdaCrd[] = [
      { kind: 'Workflow', group: 'core.eda.nokia.com', version: 'v1', plural: 'workflows', namespaced: true }
    ];

    let resolveCluster: ((value: EdaCrd[]) => void) | undefined;
    const clusterPromise = new Promise<EdaCrd[]>(resolve => {
      resolveCluster = resolve;
    });

    const findStub = sinon.stub(service as any, 'findSpecDir').resolves('/home/clab/spec');
    const fromSpecsStub = sinon.stub(service as any, 'loadCrdsFromSpecs').resolves(specCrds);
    const fromClusterStub = sinon.stub(service as any, 'loadCrdsFromCluster').returns(clusterPromise);

    const pendingA = service.getCustomResourceDefinitions();
    const pendingB = service.getCustomResourceDefinitions();

    resolveCluster?.([]);

    const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
    expect(resultA).to.have.length(1);
    expect(resultB).to.have.length(1);
    expect(findStub.calledOnce).to.equal(true);
    expect(fromSpecsStub.calledOnce).to.equal(true);
    expect(fromClusterStub.calledOnce).to.equal(true);
  });

  it('returns in-memory cluster schema before file-backed schema lookup', async () => {
    (service as any).clusterSchemaCache.set('Widget', { description: 'from-cluster' });

    const schema = await service.getSchemaForKind('Widget');

    expect(schema).to.deep.equal({ description: 'from-cluster' });
  });
});
