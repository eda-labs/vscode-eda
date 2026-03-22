import { expect } from 'chai';

import { buildNamespaceSelectionGroups } from '../src/providers/views/namespaceProvider';

describe('namespaceProvider namespace grouping', () => {
  it('groups namespaces with EDA first and excludes overlap from Kubernetes', () => {
    const groups = buildNamespaceSelectionGroups({
      edaNamespaces: ['fabric-b', 'fabric-a'],
      k8sNamespaces: ['kube-z', 'fabric-a', 'kube-a']
    });

    expect(groups).to.deep.equal({
      edaNamespaces: ['fabric-a', 'fabric-b'],
      k8sNamespaces: ['kube-a', 'kube-z']
    });
  });

  it('excludes core namespace from both groups', () => {
    const groups = buildNamespaceSelectionGroups({
      edaNamespaces: ['eda-system', 'fabric-a'],
      k8sNamespaces: ['eda-system', 'kube-a'],
      coreNamespace: 'eda-system'
    });

    expect(groups).to.deep.equal({
      edaNamespaces: ['fabric-a'],
      k8sNamespaces: ['kube-a']
    });
  });

  it('deduplicates duplicate namespace entries per source', () => {
    const groups = buildNamespaceSelectionGroups({
      edaNamespaces: ['fabric-a', 'fabric-a', 'fabric-b'],
      k8sNamespaces: ['kube-a', 'kube-a', 'kube-b']
    });

    expect(groups).to.deep.equal({
      edaNamespaces: ['fabric-a', 'fabric-b'],
      k8sNamespaces: ['kube-a', 'kube-b']
    });
  });

  it('handles missing Kubernetes namespaces', () => {
    const groups = buildNamespaceSelectionGroups({
      edaNamespaces: ['fabric-b', 'fabric-a'],
      coreNamespace: 'eda-system'
    });

    expect(groups).to.deep.equal({
      edaNamespaces: ['fabric-a', 'fabric-b'],
      k8sNamespaces: []
    });
  });
});
