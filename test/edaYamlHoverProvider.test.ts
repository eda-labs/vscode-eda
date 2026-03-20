import { expect } from 'chai';

import { EdaYamlHoverProvider } from '../src/providers/yaml/edaYamlHoverProvider';
import type { ResolvedJsonSchema } from '../src/providers/yaml/types';

describe('EdaYamlHoverProvider', () => {
  it('renders additive hover metadata without repeating schema title or description', () => {
    const provider = new EdaYamlHoverProvider();
    const schema: ResolvedJsonSchema = {
      title: 'Enabled',
      description: 'Enable or disable this member.',
      type: 'boolean',
      default: true
    };

    const markdown = (provider as any).buildHoverContent(schema, ['spec', 'members', 'enabled']);

    expect(markdown.value).to.equal(
      '*Path:* `spec.members.enabled`\n\n**Type:** `boolean`\n\n**Default:** `true`\n\n'
    );
    expect(markdown.value).to.not.include('### Enabled');
    expect(markdown.value).to.not.include('Enable or disable this member.');
  });
});
