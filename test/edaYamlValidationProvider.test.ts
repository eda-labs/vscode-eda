import { expect } from 'chai';
import sinon from 'sinon';
import * as vscode from 'vscode';

import { EdaYamlValidationProvider } from '../src/providers/yaml/edaYamlValidationProvider';
import { serviceManager } from '../src/services/serviceManager';
import type { ResolvedJsonSchema } from '../src/providers/yaml/types';

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

describe('EdaYamlValidationProvider', () => {
  const interfaceSchema: ResolvedJsonSchema = {
    type: 'object',
    properties: {
      apiVersion: {
        type: 'string',
        enum: ['interfaces.eda.nokia.com/v1alpha1']
      },
      kind: {
        type: 'string',
        enum: ['Interface']
      },
      metadata: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          namespace: { type: 'string' }
        }
      },
      spec: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', default: true },
          members: {
            type: 'array',
            items: {
              type: 'object',
              required: ['interface', 'node'],
              properties: {
                interface: { type: 'string' },
                node: { type: 'string' },
                enabled: { type: 'boolean', default: true }
              }
            }
          }
        }
      }
    }
  };

  afterEach(() => {
    sinon.restore();
  });

  it('flags invalid keys and invalid scalar values in Interface YAML', () => {
    sinon.stub(serviceManager, 'getService').returns({
      getResolvedSchemaForKindSync(kind: string) {
        return kind === 'Interface' ? interfaceSchema : null;
      }
    } as any);

    const provider = new EdaYamlValidationProvider();
    const document = createDocument([
      'apiVersion: interfaces.eda.nokia.com/v1alpha1',
      'metadata:',
      '  namespace: eda',
      '  name: test',
      'kind: Interface',
      'deine: mutter',
      'spec:',
      '  deine: mutter',
      '  enabled: 1'
    ].join('\n'));

    const diagnostics = provider.validateDocument(document);
    const messages = diagnostics.map(diagnostic => diagnostic.message);

    expect(messages).to.include('Unknown field "deine"');
    expect(messages).to.include('Expected boolean, got number');
    expect(messages.filter(message => message === 'Unknown field "deine"')).to.have.length(2);
  });

  it('returns no diagnostics for a valid Interface document', () => {
    sinon.stub(serviceManager, 'getService').returns({
      getResolvedSchemaForKindSync(kind: string) {
        return kind === 'Interface' ? interfaceSchema : null;
      }
    } as any);

    const provider = new EdaYamlValidationProvider();
    const document = createDocument([
      'apiVersion: interfaces.eda.nokia.com/v1alpha1',
      'kind: Interface',
      'metadata:',
      '  namespace: eda',
      '  name: test',
      'spec:',
      '  members:',
      '    - interface: ethernet-1/1',
      '      node: leaf1',
      '      enabled: true'
    ].join('\n'));

    expect(provider.validateDocument(document)).to.deep.equal([]);
  });

  it('revalidates open documents after schemas finish loading', () => {
    const document = createDocument([
      'apiVersion: interfaces.eda.nokia.com/v1alpha1',
      'metadata:',
      '  namespace: eda',
      '  name: test',
      'kind: Interface',
      'deine: mutter',
      'spec:',
      '  deine: mutter',
      '  enabled: 1'
    ].join('\n')) as vscode.TextDocument & { uri: { toString(): string } };

    (document as { uri?: { toString(): string } }).uri = { toString: () => 'file:///tmp/interface.yaml' };

    const diagnosticsCollection = {
      set: sinon.stub(),
      delete: sinon.stub(),
      dispose: sinon.stub()
    } as unknown as vscode.DiagnosticCollection;
    (vscode.languages.createDiagnosticCollection as unknown as sinon.SinonStub).returns(diagnosticsCollection);
    (vscode.workspace.onDidOpenTextDocument as unknown as sinon.SinonStub)
      .returns(new vscode.Disposable(() => undefined));
    (vscode.workspace.onDidChangeTextDocument as unknown as sinon.SinonStub)
      .returns(new vscode.Disposable(() => undefined));
    (vscode.workspace.onDidCloseTextDocument as unknown as sinon.SinonStub)
      .returns(new vscode.Disposable(() => undefined));
    sinon.stub(vscode.workspace, 'textDocuments').value([document]);

    let schemaLoaded = false;
    const schemaChangedEmitter = new vscode.EventEmitter<void>();
    sinon.stub(serviceManager, 'getService').returns({
      getResolvedSchemaForKindSync(kind: string) {
        return schemaLoaded && kind === 'Interface' ? interfaceSchema : null;
      },
      onDidSchemasChanged: schemaChangedEmitter.event
    } as any);

    const provider = new EdaYamlValidationProvider();
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    provider.activate(context);

    expect((diagnosticsCollection.set as sinon.SinonStub).calledOnce).to.equal(true);
    expect((diagnosticsCollection.set as sinon.SinonStub).firstCall.args[1]).to.deep.equal([]);

    schemaLoaded = true;
    schemaChangedEmitter.fire();

    expect((diagnosticsCollection.set as sinon.SinonStub).calledTwice).to.equal(true);
    const refreshedDiagnostics = (diagnosticsCollection.set as sinon.SinonStub).secondCall.args[1] as vscode.Diagnostic[];
    const messages = refreshedDiagnostics.map(diagnostic => diagnostic.message);
    expect(messages).to.include('Unknown field "deine"');
    expect(messages).to.include('Expected boolean, got number');
  });
});
