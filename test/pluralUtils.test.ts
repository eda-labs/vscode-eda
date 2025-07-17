import { expect } from 'chai';
import { kindToPlural } from '../src/utils/pluralUtils';

describe('kindToPlural', () => {
  it('pluralizes words ending in y', () => {
    expect(kindToPlural('Topology')).to.equal('topologies');
    expect(kindToPlural('policy')).to.equal('policies');
  });

  it('pluralizes simple words', () => {
    expect(kindToPlural('Node')).to.equal('nodes');
  });

  it('handles irregular plurals', () => {
    expect(kindToPlural('Chassis')).to.equal('chassis');
    expect(kindToPlural('status')).to.equal('statuses');
  });
});
