import { expect } from 'chai';

import type { ExplorerNode } from '../src/webviews/shared/explorer/types';
import { nodeIconName, sectionIconName } from '../src/webviews/explorer/explorerIconMappings';

function node(partial: Partial<ExplorerNode>): ExplorerNode {
  return {
    id: partial.id ?? 'node',
    label: partial.label ?? 'Node',
    contextValue: partial.contextValue,
    resourceType: partial.resourceType,
    streamGroup: partial.streamGroup,
    resourceCategory: partial.resourceCategory,
    commandArg: partial.commandArg,
    actions: [],
    children: []
  };
}

describe('explorerIconMappings', () => {
  it('uses extracted Nokia icons for top-level sections', () => {
    expect(sectionIconName('dashboards')).to.equal('dashboard');
    expect(sectionIconName('resources')).to.equal('keypad');
  });

  it('maps EDA category labels to drawer category icons', () => {
    expect(nodeIconName(node({ label: 'App Management', contextValue: 'resource-category' }))).to.equal('plugin');
    expect(nodeIconName(node({ label: 'User Management', contextValue: 'resource-category' }))).to.equal('adminsettings');
    expect(nodeIconName(node({ label: 'Underlay Routing', contextValue: 'resource-category' }))).to.equal('site');
  });

  it('strips dashboard count suffixes before matching labels', () => {
    expect(nodeIconName(node({ label: 'Alarms (12)', contextValue: 'eda-dashboard' }))).to.equal('alarmclock');
    expect(nodeIconName(node({ label: 'Basket (3)', contextValue: 'eda-dashboard' }))).to.equal('store');
  });

  it('prefers stream resource type metadata over display label', () => {
    expect(nodeIconName(node({
      label: 'Virtual Networks',
      contextValue: 'stream',
      resourceType: 'virtualnetworks',
      streamGroup: 'Virtual Networks'
    }))).to.equal('service');
  });

  it('uses command arguments to map resource leaves to their stream icons', () => {
    expect(nodeIconName(node({
      label: 'leaf-1',
      contextValue: 'stream-item',
      commandArg: {
        resourceType: 'toponodes',
        streamGroup: 'Topology'
      }
    }))).to.equal('backhaulnode');
  });
});
