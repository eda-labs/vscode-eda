import { expect } from 'chai';
import sinon from 'sinon';
import type * as vscode from 'vscode';

import { EdaYamlCompletionProvider } from '../src/providers/yaml/edaYamlCompletionProvider';
import { collectSuggestibleCompletions, isSuggestTriggerPosition } from '../src/providers/yaml/edaYamlSuggestTrigger';
import type { ResolvedJsonSchema } from '../src/providers/yaml/types';
import { serviceManager } from '../src/services/serviceManager';

function createDocument(text: string): vscode.TextDocument {
  const lines = text.split('\n');

  return {
    languageId: 'yaml',
    lineCount: lines.length,
    lineAt(line: number) {
      return { text: lines[line] };
    },
    getText(range?: { start?: { line?: number }; end?: { line?: number } }) {
      if (!range) {
        return text;
      }
      const startLine = range.start?.line ?? 0;
      const endLine = range.end?.line ?? lines.length;
      return lines.slice(startLine, endLine).join('\n');
    }
  } as unknown as vscode.TextDocument;
}

function getLabels(items: readonly vscode.CompletionItem[] | undefined): string[] {
  return (items ?? []).map(item => {
    if (typeof item.label === 'string') {
      return item.label;
    }
    return item.label.label;
  });
}

function getItemByLabel(
  items: readonly vscode.CompletionItem[] | undefined,
  label: string
): vscode.CompletionItem | undefined {
  return (items ?? []).find(item => (typeof item.label === 'string' ? item.label : item.label.label) === label);
}

function getDocumentationValue(item: vscode.CompletionItem | undefined): string | undefined {
  if (!item || !item.documentation || typeof item.documentation === 'string') {
    return typeof item?.documentation === 'string' ? item.documentation : undefined;
  }
  return item.documentation.value;
}

function getLabelDescription(item: vscode.CompletionItem | undefined): string | undefined {
  if (!item || typeof item.label === 'string') {
    return undefined;
  }
  return item.label.description;
}

function renderCompletionInsertText(item: vscode.CompletionItem): string {
  let rawInsertText: string;
  if (typeof item.insertText === 'string') {
    rawInsertText = item.insertText;
  } else if (typeof item.insertText === 'object' && item.insertText !== null && 'value' in item.insertText) {
    rawInsertText = String((item.insertText as { value: string }).value);
  } else {
    rawInsertText = typeof item.label === 'string' ? item.label : item.label.label;
  }

  return rawInsertText
    .replace(/\$\{(\d+)\|([^}]*)\|\}/g, (_match, _tabstop, choices) => String(choices).split(',')[0] ?? '')
    .replace(/\$\{(\d+):([^}]*)\}/g, '$2')
    .replace(/\$(\d+)/g, '');
}

function offsetAt(text: string, position: { line: number; character: number }): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) {
    offset += lines[line].length + 1;
  }
  return offset + position.character;
}

function applyCompletion(
  text: string,
  position: vscode.Position,
  item: vscode.CompletionItem
): string {
  const range = item.range as vscode.Range | undefined;
  const start = range?.start ?? position;
  const end = range?.end ?? position;
  const insertText = renderCompletionInsertText(item);
  return `${text.slice(0, offsetAt(text, start))}${insertText}${text.slice(offsetAt(text, end))}`;
}

interface CursorScenario {
  name: string;
  text: string;
  position: vscode.Position;
  includeLabels: string[];
  excludeLabels?: string[];
  selectedLabel: string;
  expectedAppliedText: string;
}

describe('EdaYamlCompletionProvider', () => {
  const bannerSchema: ResolvedJsonSchema = {
    type: 'object',
    properties: {
      spec: {
        type: 'object',
        properties: {
          nodes: {
            type: 'array',
            items: { type: 'string' },
            'x-eda-nokia-com': {
              'ui-auto-completes': [
                {
                  type: 'gvr',
                  group: 'core.eda.nokia.com',
                  version: 'v1',
                  resource: 'toponodes'
                }
              ]
            }
          },
          nodeSelector: {
            type: 'array',
            format: 'labelselector',
            items: { type: 'string' },
            title: 'Node Selector',
            description: 'Select nodes by label.'
          }
        }
      }
    }
  };

  const fabricSchema: ResolvedJsonSchema = {
    type: 'object',
    properties: {
      spec: {
        type: 'object',
        properties: {
          leafs: {
            type: 'object',
            properties: {
              leafNodeSelector: {
                type: 'array',
                format: 'labelselector',
                items: { type: 'string' },
                title: 'Leaf Node Selector',
                description: 'Label selector used to select Toponodes to configure as Leaf nodes.'
              }
            }
          }
        }
      }
    }
  };

  const interfaceSchema: ResolvedJsonSchema = {
    type: 'object',
    properties: {
      spec: {
        type: 'object',
        properties: {
          ethernet: {
            type: 'object',
            properties: {
              transparentL2CPProtocols: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['LLDP', 'LACP', 'xSTP']
                }
              }
            }
          }
        }
      }
    }
  };

  beforeEach(() => {
    const schemaService = {
      getResolvedSchemaForKindSync(kind: string) {
        if (kind === 'Banner') {
          return bannerSchema;
        }
        if (kind === 'Fabric') {
          return fabricSchema;
        }
        if (kind === 'Interface') {
          return interfaceSchema;
        }
        return null;
      },
      getCustomResourceDefinitions: sinon.stub().resolves([
        { kind: 'TopoNode', group: 'core.eda.nokia.com', version: 'v1', plural: 'toponodes', namespaced: true }
      ])
    };

    sinon.stub(serviceManager, 'getService').returns(schemaService as any);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('suggests dynamic values for scalar array items such as Banner spec.nodes', async () => {
    const provider = new EdaYamlCompletionProvider();
    const getValuesStub = sinon.stub((provider as any).dynamicProvider, 'getValuesForHint').resolves(['leaf1', 'spine1']);
    const document = createDocument([
      'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
      'kind: Banner',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  nodes:',
      '    - '
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 6, character: 6 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    expect(getLabels(items)).to.include.members(['leaf1', 'spine1']);
    expect(getValuesStub.calledOnce).to.equal(true);
    expect(getValuesStub.firstCall.args[0]).to.deep.include({
      group: 'core.eda.nokia.com',
      version: 'v1',
      resource: 'toponodes'
    });
  });

  it('suggests scalar array values on a blank indented line before typing a dash', async () => {
    const provider = new EdaYamlCompletionProvider();
    sinon.stub((provider as any).dynamicProvider, 'getValuesForHint').resolves(['leaf1']);
    const document = createDocument([
      'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
      'kind: Banner',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  nodes:',
      '    '
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 6, character: 4 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    expect(getLabels(items)).to.include('leaf1');
    expect(getItemByLabel(items, 'leaf1')?.insertText).to.equal('- leaf1');
  });

  it('suggests scalar array values on a dash-only line', async () => {
    const provider = new EdaYamlCompletionProvider();
    sinon.stub((provider as any).dynamicProvider, 'getValuesForHint').resolves(['leaf1']);
    const document = createDocument([
      'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
      'kind: Banner',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  nodes:',
      '    -'
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 6, character: 5 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    expect(getLabels(items)).to.include('leaf1');
    expect(getItemByLabel(items, 'leaf1')?.insertText).to.equal('- leaf1');
  });

  it('suggests label selector pairs for Banner spec.nodeSelector array items', async () => {
    const provider = new EdaYamlCompletionProvider();
    const selectorStub = sinon.stub((provider as any).dynamicProvider, 'getLabelSelectorValuesForHint')
      .resolves(['eda.nokia.com/role=leaf', 'containerlab=managedSrl']);
    const document = createDocument([
      'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
      'kind: Banner',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  nodeSelector:',
      '    - '
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 6, character: 6 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    expect(getLabels(items)).to.include.members(['eda.nokia.com/role=leaf', 'containerlab=managedSrl']);
    expect(selectorStub.calledOnce).to.equal(true);
    expect(selectorStub.firstCall.args[0]).to.deep.include({
      group: 'core.eda.nokia.com',
      version: 'v1',
      resource: 'toponodes'
    });
  });

  it('replaces the already typed scalar array-item prefix instead of appending to it', async () => {
    const provider = new EdaYamlCompletionProvider();
    sinon.stub((provider as any).dynamicProvider, 'getValuesForHint').resolves(['leaf1']);
    const document = createDocument([
      'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
      'kind: Banner',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  nodes:',
      '    - l'
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 6, character: 7 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    const leafItem = getItemByLabel(items, 'leaf1');
    expect(leafItem).to.not.equal(undefined);
    const range = leafItem?.range as vscode.Range | undefined;
    expect(range).to.not.equal(undefined);
    expect(range?.start.line).to.equal(6);
    expect(range?.start.character).to.equal(6);
    expect(range?.end.line).to.equal(6);
    expect(range?.end.character).to.equal(7);
  });

  it('does not suggest array values already present in the same Banner spec.nodes list', async () => {
    const provider = new EdaYamlCompletionProvider();
    sinon.stub((provider as any).dynamicProvider, 'getValuesForHint').resolves(['leaf1', 'spine1']);
    const document = createDocument([
      'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
      'kind: Banner',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  nodes:',
      '    - leaf1',
      '    - '
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 7, character: 6 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    expect(getLabels(items)).to.not.include('leaf1');
    expect(getLabels(items)).to.include('spine1');
  });

  it('keeps Banner spec.nodes suggestions stable on a blank continuation line after comments and existing items', async () => {
    const provider = new EdaYamlCompletionProvider();
    sinon.stub((provider as any).dynamicProvider, 'getValuesForHint').resolves(['leaf1', 'spine1', 'spine2']);
    const document = createDocument([
      'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
      'kind: Banner',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  nodes:',
      '    - leaf1',
      '    # keep suggesting valid next values here',
      '    '
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 8, character: 4 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    expect(getLabels(items)).to.not.include('leaf1');
    expect(getLabels(items)).to.include.members(['spine1', 'spine2']);
    expect(getItemByLabel(items, 'spine1')?.insertText).to.equal('- spine1');
  });

  it('keeps Banner spec.nodeSelector suggestions stable on a blank continuation line and filters duplicates', async () => {
    const provider = new EdaYamlCompletionProvider();
    sinon.stub((provider as any).dynamicProvider, 'getLabelSelectorValuesForHint').resolves([
      'eda.nokia.com/role=leaf',
      'containerlab=managedSrl'
    ]);
    const document = createDocument([
      'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
      'kind: Banner',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  nodeSelector:',
      '    - eda.nokia.com/role=leaf',
      '    '
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 7, character: 4 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    expect(getLabels(items)).to.not.include('eda.nokia.com/role=leaf');
    expect(getLabels(items)).to.include('containerlab=managedSrl');
    expect(getItemByLabel(items, 'containerlab=managedSrl')?.insertText).to.equal('- containerlab=managedSrl');
  });

  it('keeps Banner spec.nodeSelector suggestions visible and normalizes replacement after extra whitespace', async () => {
    const provider = new EdaYamlCompletionProvider();
    sinon.stub((provider as any).dynamicProvider, 'getLabelSelectorValuesForHint').resolves([
      'eda.nokia.com/role=leaf',
      'containerlab=managedSrl'
    ]);
    const document = createDocument([
      'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
      'kind: Banner',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  nodeSelector:',
      '    -  I'
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 6, character: 8 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    const selectorItem = getItemByLabel(items, 'containerlab=managedSrl');
    expect(selectorItem).to.not.equal(undefined);
    expect(selectorItem?.filterText).to.equal('I containerlab=managedSrl');
    const range = selectorItem?.range as vscode.Range | undefined;
    expect(range).to.not.equal(undefined);
    expect(range?.start.line).to.equal(6);
    expect(range?.start.character).to.equal(6);
    expect(range?.end.line).to.equal(6);
    expect(range?.end.character).to.equal(8);
  });

  it('keeps Banner key suggestions clean and renders rich markdown in documentation', async () => {
    const provider = new EdaYamlCompletionProvider();
    const document = createDocument([
      'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
      'kind: Banner',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  '
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 5, character: 2 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    const nodeSelector = getItemByLabel(items, 'nodeSelector');
    expect(getLabelDescription(nodeSelector)).to.equal('Add node selector list');
    expect(nodeSelector?.detail).to.equal('array · labelselector');
    expect(getDocumentationValue(getItemByLabel(items, 'nodeSelector'))).to.equal(
      '### Node Selector\n\n**Description**\n\nSelect nodes by label.\n\n**Details**\n\n- Type: `array`\n- Format: `labelselector`\n\n**Insert**\n\n```yaml\nnodeSelector:\n  - key=value\n```\n'
    );
  });

  it('shows markdown documentation for Banner node suggestions from cluster data', async () => {
    const provider = new EdaYamlCompletionProvider();
    sinon.stub((provider as any).dynamicProvider, 'getValuesForHint').resolves(['leaf1']);
    const document = createDocument([
      'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
      'kind: Banner',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  nodes:',
      '    - '
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 6, character: 6 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    expect(getItemByLabel(items, 'leaf1')?.detail).to.equal('Suggested from toponodes');
    expect(getDocumentationValue(getItemByLabel(items, 'leaf1'))).to.equal(
      '### leaf1\n\n**Details**\n\n- from toponodes\n\n**Insert**\n\n```yaml\nleaf1\n```\n'
    );
  });

  it('logs a Banner cursor-completion matrix and applies completions exactly at valid insertion points', async () => {
    const provider = new EdaYamlCompletionProvider();
    sinon.stub((provider as any).dynamicProvider, 'getValuesForHint').resolves(['leaf1', 'spine1']);
    sinon.stub((provider as any).dynamicProvider, 'getLabelSelectorValuesForHint').resolves([
      'eda.nokia.com/role=leaf',
      'containerlab=managedSrl'
    ]);

    const scenarios: CursorScenario[] = [
      {
        name: 'spec one-space blank line suggests child keys without typing',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          ' '
        ].join('\n'),
        position: { line: 5, character: 1 } as vscode.Position,
        includeLabels: ['nodes', 'nodeSelector'],
        selectedLabel: 'nodeSelector',
        expectedAppliedText: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          ' nodeSelector:',
          '   - '
        ].join('\n')
      },
      {
        name: 'spec blank line suggests child keys without typing',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  '
        ].join('\n'),
        position: { line: 5, character: 2 } as vscode.Position,
        includeLabels: ['nodes', 'nodeSelector'],
        selectedLabel: 'nodeSelector',
        expectedAppliedText: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodeSelector:',
          '    - '
        ].join('\n')
      },
      {
        name: 'spec typed key prefix replaces instead of duplicating',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  n'
        ].join('\n'),
        position: { line: 5, character: 3 } as vscode.Position,
        includeLabels: ['nodes', 'nodeSelector'],
        selectedLabel: 'nodeSelector',
        expectedAppliedText: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodeSelector:',
          '    - '
        ].join('\n')
      },
      {
        name: 'spec blank line filters existing sibling keys',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodes:',
          '    - leaf1',
          '  '
        ].join('\n'),
        position: { line: 7, character: 2 } as vscode.Position,
        includeLabels: ['nodeSelector'],
        excludeLabels: ['nodes'],
        selectedLabel: 'nodeSelector',
        expectedAppliedText: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodes:',
          '    - leaf1',
          '  nodeSelector:',
          '    - '
        ].join('\n')
      },
      {
        name: 'nodes blank line suggests scalar values without typing',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodes:',
          '    '
        ].join('\n'),
        position: { line: 6, character: 4 } as vscode.Position,
        includeLabels: ['leaf1', 'spine1'],
        selectedLabel: 'leaf1',
        expectedAppliedText: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodes:',
          '    - leaf1'
        ].join('\n')
      },
      {
        name: 'nodes dash-only line suggests scalar values',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodes:',
          '    -'
        ].join('\n'),
        position: { line: 6, character: 5 } as vscode.Position,
        includeLabels: ['leaf1', 'spine1'],
        selectedLabel: 'leaf1',
        expectedAppliedText: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodes:',
          '    - leaf1'
        ].join('\n')
      },
      {
        name: 'nodes typed prefix replaces cleanly',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodes:',
          '    - l'
        ].join('\n'),
        position: { line: 6, character: 7 } as vscode.Position,
        includeLabels: ['leaf1'],
        selectedLabel: 'leaf1',
        expectedAppliedText: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodes:',
          '    - leaf1'
        ].join('\n')
      },
      {
        name: 'nodeSelector blank line suggests selector values without typing',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodeSelector:',
          '    '
        ].join('\n'),
        position: { line: 6, character: 4 } as vscode.Position,
        includeLabels: ['eda.nokia.com/role=leaf', 'containerlab=managedSrl'],
        selectedLabel: 'containerlab=managedSrl',
        expectedAppliedText: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodeSelector:',
          '    - containerlab=managedSrl'
        ].join('\n')
      },
      {
        name: 'nodeSelector dash-only line suggests selector values',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodeSelector:',
          '    -'
        ].join('\n'),
        position: { line: 6, character: 5 } as vscode.Position,
        includeLabels: ['eda.nokia.com/role=leaf', 'containerlab=managedSrl'],
        selectedLabel: 'containerlab=managedSrl',
        expectedAppliedText: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodeSelector:',
          '    - containerlab=managedSrl'
        ].join('\n')
      },
      {
        name: 'nodeSelector extra whitespace still suggests and normalizes',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodeSelector:',
          '    -  I'
        ].join('\n'),
        position: { line: 6, character: 8 } as vscode.Position,
        includeLabels: ['containerlab=managedSrl'],
        selectedLabel: 'containerlab=managedSrl',
        expectedAppliedText: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  nodeSelector:',
          '    - containerlab=managedSrl'
        ].join('\n')
      }
    ];

    const logLines = ['Banner completion trace'];
    for (const scenario of scenarios) {
      const document = createDocument(scenario.text);
      const items = await provider.provideCompletionItems(
        document,
        scenario.position,
        {} as vscode.CancellationToken,
        {} as vscode.CompletionContext
      );

      const labels = getLabels(items);
      for (const label of scenario.includeLabels) {
        expect(labels, `${scenario.name} should suggest ${label}`).to.include(label);
      }
      for (const label of scenario.excludeLabels ?? []) {
        expect(labels, `${scenario.name} should not suggest ${label}`).to.not.include(label);
      }

      const item = getItemByLabel(items, scenario.selectedLabel);
      expect(item, `${scenario.name} should provide ${scenario.selectedLabel}`).to.not.equal(undefined);

      const appliedText = applyCompletion(scenario.text, scenario.position, item!);
      expect(
        appliedText,
        `${scenario.name} should apply ${scenario.selectedLabel} at the cursor without corrupting YAML`
      ).to.equal(scenario.expectedAppliedText);

      logLines.push(`SCENARIO: ${scenario.name}`);
      logLines.push(`cursor: ${scenario.position.line}:${scenario.position.character}`);
      logLines.push(`suggested: ${labels.join(', ')}`);
      logLines.push('applied:');
      logLines.push(appliedText);
      logLines.push('---');
    }

    console.log(logLines.join('\n'));
  });

  it('logs Banner no-typing auto-trigger positions, including one-space indentation under spec', async () => {
    const provider = new EdaYamlCompletionProvider();
    sinon.stub((provider as any).dynamicProvider, 'getValuesForHint').resolves(['leaf1', 'spine1']);
    sinon.stub((provider as any).dynamicProvider, 'getLabelSelectorValuesForHint').resolves([
      'eda.nokia.com/role=leaf',
      'containerlab=managedSrl'
    ]);

    const scenarios = [
      {
        name: 'spec one-space blank line',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          ' '
        ].join('\n'),
        position: { line: 5, character: 1 } as vscode.Position,
        includeLabels: ['nodes', 'nodeSelector']
      },
      {
        name: 'spec two-space blank line',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          '  '
        ].join('\n'),
        position: { line: 5, character: 2 } as vscode.Position,
        includeLabels: ['nodes', 'nodeSelector']
      },
      {
        name: 'nodes blank line',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          ' nodes:',
          '    '
        ].join('\n'),
        position: { line: 6, character: 4 } as vscode.Position,
        includeLabels: ['leaf1', 'spine1']
      },
      {
        name: 'nodeSelector blank line',
        text: [
          'apiVersion: siteinfo.eda.nokia.com/v1alpha1',
          'kind: Banner',
          'metadata:',
          '  namespace: eda',
          'spec:',
          ' nodeSelector:',
          '    '
        ].join('\n'),
        position: { line: 6, character: 4 } as vscode.Position,
        includeLabels: ['eda.nokia.com/role=leaf', 'containerlab=managedSrl']
      }
    ];

    const logLines = ['Banner auto-trigger trace'];
    for (const scenario of scenarios) {
      const document = createDocument(scenario.text);
      expect(
        isSuggestTriggerPosition(document, scenario.position),
        `${scenario.name} should be treated as an auto-trigger cursor position`
      ).to.equal(true);

      const result = await collectSuggestibleCompletions(provider, document, scenario.position);
      expect(result.shouldTrigger, `${scenario.name} should auto-trigger suggestions`).to.equal(true);
      for (const label of scenario.includeLabels) {
        expect(result.labels, `${scenario.name} should suggest ${label}`).to.include(label);
      }

      logLines.push(`SCENARIO: ${scenario.name}`);
      logLines.push(`cursor: ${scenario.position.line}:${scenario.position.character}`);
      logLines.push(`suggested: ${result.labels.join(', ')}`);
      logLines.push('---');
    }

    console.log(logLines.join('\n'));
  });

  it('suggests enum values for scalar array items such as Interface transparentL2CPProtocols', async () => {
    const provider = new EdaYamlCompletionProvider();
    const document = createDocument([
      'apiVersion: interfaces.eda.nokia.com/v1alpha1',
      'kind: Interface',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  ethernet:',
      '    transparentL2CPProtocols:',
      '      - '
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 7, character: 8 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    expect(getLabels(items)).to.include.members(['LLDP', 'LACP', 'xSTP']);
  });

  it('infers nested selector targets such as Fabric spec.leafs.leafNodeSelector', async () => {
    const provider = new EdaYamlCompletionProvider();
    const selectorStub = sinon.stub((provider as any).dynamicProvider, 'getLabelSelectorValuesForHint')
      .resolves(['eda.nokia.com/role=leaf']);
    const document = createDocument([
      'apiVersion: fabrics.eda.nokia.com/v1alpha1',
      'kind: Fabric',
      'metadata:',
      '  namespace: eda',
      'spec:',
      '  leafs:',
      '    leafNodeSelector:',
      '      - '
    ].join('\n'));

    const items = await provider.provideCompletionItems(
      document,
      { line: 7, character: 8 } as vscode.Position,
      {} as vscode.CancellationToken,
      {} as vscode.CompletionContext
    );

    expect(getLabels(items)).to.include('eda.nokia.com/role=leaf');
    expect(selectorStub.calledOnce).to.equal(true);
    expect(selectorStub.firstCall.args[0]).to.deep.include({
      group: 'core.eda.nokia.com',
      version: 'v1',
      resource: 'toponodes',
      kind: 'TopoNode'
    });
  });
});
