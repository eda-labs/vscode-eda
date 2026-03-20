import { expect } from 'chai';

import { parseLabelLine, parseLabelsText, toLabelText } from '../src/webviews/shared/components/labelUtils';

describe('labelUtils', () => {
  it('parses equals-separated labels', () => {
    const label = parseLabelLine('eda.nokia.com/role=leaf');
    expect(label).to.deep.equal({
      key: 'eda.nokia.com/role',
      value: 'leaf',
      separator: '='
    });
    expect(toLabelText(label)).to.equal('eda.nokia.com/role=leaf');
  });

  it('parses colon-separated labels', () => {
    const label = parseLabelLine('eda.nokia.com/role: leaf');
    expect(label).to.deep.equal({
      key: 'eda.nokia.com/role',
      value: 'leaf',
      separator: ':'
    });
    expect(toLabelText(label)).to.equal('eda.nokia.com/role:leaf');
  });

  it('falls back to default key when separator is missing', () => {
    const label = parseLabelLine('orphan-value');
    expect(label).to.deep.equal({
      key: 'label',
      value: 'orphan-value',
      separator: '='
    });
    expect(toLabelText(label)).to.equal('label=orphan-value');
  });

  it('parses and filters multiline label text', () => {
    const labels = parseLabelsText('\neda.nokia.com/role=leaf\n\neda.nokia.com/site: west\n');
    expect(labels).to.deep.equal([
      { key: 'eda.nokia.com/role', value: 'leaf', separator: '=' },
      { key: 'eda.nokia.com/site', value: 'west', separator: ':' }
    ]);
  });
});
