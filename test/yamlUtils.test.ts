import { expect } from 'chai';

import { sanitizeResourceForEdit } from '../src/utils/yamlUtils';

describe('sanitizeResourceForEdit', () => {
  it('removes edit-only metadata fields', () => {
    const resource = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: 'demo',
        namespace: 'default',
        annotations: { a: 'b' },
        creationTimestamp: '123',
        generation: 2,
        resourceVersion: '5',
        uid: 'abc',
      },
      spec: {}
    };

    const result = sanitizeResourceForEdit(resource as any);
    expect(result).to.deep.equal({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: 'demo',
        namespace: 'default',
        resourceVersion: '5'
      },
      spec: {}
    });
    // original should remain unchanged
    expect(resource.metadata).to.have.property('annotations');
  });
});
