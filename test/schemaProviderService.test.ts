import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

  it('selects the highest semantic version spec directory', async () => {
    const selected = (SchemaProviderService as any).selectSpecDirName([
      'schemas',
      'v25.8.2',
      'v25.12.1',
      'v25.4.3'
    ]);

    expect(selected).to.equal('v25.12.1');
  });

  it('prefers the connected target version when available locally', async () => {
    const selected = (SchemaProviderService as any).selectSpecDirName(
      [
        'schemas',
        'v25.8.2',
        'v25.12.1',
        'v25.4.3'
      ],
      'v25.8.2'
    );

    expect(selected).to.equal('v25.8.2');
  });

  it('keeps CRD schema for kind collisions and resolves apiVersion+kind lookups', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-provider-'));
    const specPath = path.join(tempDir, 'topologies.json');

    const collidingSpec = {
      components: {
        schemas: {
          // Real CRD schema first
          'com.nokia.eda.topologies.v1alpha1.Topology': {
            type: 'object',
            required: ['apiVersion', 'kind', 'metadata', 'spec'],
            properties: {
              apiVersion: {
                type: 'string',
                default: 'topologies.eda.nokia.com/v1alpha1'
              },
              kind: {
                type: 'string',
                default: 'Topology'
              },
              metadata: {
                type: 'object'
              },
              spec: {
                type: 'object'
              }
            }
          },
          // Generic model with same name later in the same file
          Topology: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: {
                type: 'string'
              }
            }
          }
        }
      }
    };

    fs.writeFileSync(specPath, JSON.stringify(collidingSpec), 'utf8');
    sinon.stub(service as any, 'cacheSchema').resolves();

    try {
      await (service as any).processSpecFile(specPath);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    const kindSchema = service.getResolvedSchemaForKindSync('Topology');
    expect(kindSchema?.properties).to.have.property('apiVersion');

    const resourceSchema = service.getResolvedSchemaForResourceSync(
      'Topology',
      'topologies.eda.nokia.com/v1alpha1'
    );
    expect(resourceSchema?.properties).to.have.property('apiVersion');
  });
});
