import { expect } from 'chai';

import { EdaSpecManager } from '../src/clients/edaSpecManager';

describe('EdaSpecManager resource route metadata', () => {
  it('indexes exact 26.4 resource plurals from OpenAPI paths', async () => {
    const manager = new EdaSpecManager({} as any);

    (manager as any).collectSpecMetadata({
      paths: {
        '/apps/qos.eda.nokia.com/v2/namespaces/{namespace}/egresspolicys': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/com.nokia.eda.qos.v2.EgressPolicyList' }
                  }
                }
              }
            }
          },
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/com.nokia.eda.qos.v2.EgressPolicy' }
                }
              }
            }
          }
        },
        '/apps/qos.eda.nokia.com/v2/namespaces/{namespace}/egresspolicys/{name}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/com.nokia.eda.qos.v2.EgressPolicy' }
                  }
                }
              }
            }
          },
          put: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/com.nokia.eda.qos.v2.EgressPolicy' }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          'com.nokia.eda.qos.v2.EgressPolicyList': {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/com.nokia.eda.qos.v2.EgressPolicy' }
              }
            }
          },
          'com.nokia.eda.qos.v2.EgressPolicy': {
            type: 'object',
            properties: {
              apiVersion: { type: 'string', default: 'qos.eda.nokia.com/v2' },
              kind: { type: 'string', default: 'EgressPolicy' }
            }
          }
        }
      }
    });

    const route = await manager.getResourceRoute('qos.eda.nokia.com', 'v2', 'EgressPolicy');
    expect(route?.plural).to.equal('egresspolicys');
    expect(route?.namespacedCollectionPath).to.equal('/apps/qos.eda.nokia.com/v2/namespaces/{namespace}/egresspolicys');
    expect(route?.namespacedReadPath).to.equal('/apps/qos.eda.nokia.com/v2/namespaces/{namespace}/egresspolicys/{name}');
    expect(route?.namespacedUpdatePath).to.equal('/apps/qos.eda.nokia.com/v2/namespaces/{namespace}/egresspolicys/{name}');
  });

  it('indexes workflow input routes without hard-coded workflow paths', async () => {
    const manager = new EdaSpecManager({} as any);

    (manager as any).collectSpecMetadata({
      paths: {
        '/workflows/v1/topologies.eda.nokia.com/v1/namespaces/{namespace}/networktopologies/{name}/_input': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array' }
                  }
                }
              }
            }
          },
          put: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'array' }
                }
              }
            }
          }
        },
        '/workflows/v1/topologies.eda.nokia.com/v1/namespaces/{namespace}/networktopologies/{name}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/com.nokia.eda.topologies.v1.NetworkTopology' }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          'com.nokia.eda.topologies.v1.NetworkTopology': {
            type: 'object',
            properties: {
              apiVersion: { type: 'string', default: 'topologies.eda.nokia.com/v1' },
              kind: { type: 'string', default: 'NetworkTopology' }
            }
          }
        }
      }
    });

    const route = await manager.getResourceRoute('topologies.eda.nokia.com', 'v1', 'NetworkTopology');
    expect(route?.workflowNamespacedReadPath)
      .to.equal('/workflows/v1/topologies.eda.nokia.com/v1/namespaces/{namespace}/networktopologies/{name}');
    expect(route?.workflowNamespacedInputPath)
      .to.equal('/workflows/v1/topologies.eda.nokia.com/v1/namespaces/{namespace}/networktopologies/{name}/_input');
  });

  it('prefers stable resource versions over older alpha versions for group/kind lookup', async () => {
    const manager = new EdaSpecManager({} as any);

    (manager as any).collectSpecMetadata({
      paths: {
        '/apps/interfaces.eda.nokia.com/v1alpha1/namespaces/{namespace}/interfaces': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/com.nokia.eda.interfaces.v1alpha1.InterfaceList' }
                  }
                }
              }
            }
          }
        },
        '/apps/interfaces.eda.nokia.com/v1/namespaces/{namespace}/interfaces': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/com.nokia.eda.interfaces.v1.InterfaceList' }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          'com.nokia.eda.interfaces.v1alpha1.InterfaceList': {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/com.nokia.eda.interfaces.v1alpha1.Interface' }
              }
            }
          },
          'com.nokia.eda.interfaces.v1alpha1.Interface': {
            type: 'object',
            properties: {
              apiVersion: { type: 'string', default: 'interfaces.eda.nokia.com/v1alpha1' },
              kind: { type: 'string', default: 'Interface' }
            }
          },
          'com.nokia.eda.interfaces.v1.InterfaceList': {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/com.nokia.eda.interfaces.v1.Interface' }
              }
            }
          },
          'com.nokia.eda.interfaces.v1.Interface': {
            type: 'object',
            properties: {
              apiVersion: { type: 'string', default: 'interfaces.eda.nokia.com/v1' },
              kind: { type: 'string', default: 'Interface' }
            }
          }
        }
      }
    });

    const route = await manager.getResourceRouteByGroupKind('interfaces.eda.nokia.com', 'Interface');
    expect(route?.version).to.equal('v1');
    expect(route?.namespacedCollectionPath).to.equal('/apps/interfaces.eda.nokia.com/v1/namespaces/{namespace}/interfaces');
  });
});
