/* eslint-env mocha, node */
import { expect } from 'chai';
import sinon from 'sinon';
import * as path from 'path';
import { loadTemplate } from '../src/utils/templateLoader';
import type * as vscode from 'vscode';

/**
 * Helper context object used by the template loader. Only the
 * `asAbsolutePath` method is required for these tests so other
 * properties are omitted.
 */
const testContext: vscode.ExtensionContext = {
  // Resolve paths relative to the project root so the actual
  // template files in `src/templates` can be used during tests.
  asAbsolutePath: (relativePath: string) => {
    return path.join(__dirname, '..', relativePath);
  }
} as unknown as vscode.ExtensionContext;

describe('loadTemplate utility', () => {
  let consoleStub: sinon.SinonStub;

  beforeEach(() => {
    // Suppress error output from the utility to keep test logs clean
    consoleStub = sinon.stub(console, 'error');
  });

  afterEach(() => {
    consoleStub.restore();
  });
  it('renders the deviation template with provided variables', () => {
    const result = loadTemplate('deviation', testContext, {
      name: 'my-dev',
      kind: 'Deviation',
      apiVersion: 'v1',
      namespace: 'default',
      valueDiff: '@@ -1 +1 @@\n-a: old\n+a: new',
      resourceYaml: 'kind: Deviation\nmetadata:\n  name: my-dev'
    });

    // Basic expectations showing placeholders are replaced
    expect(result).to.contain('# Deviation Details');
    expect(result).to.contain('`my-dev`');
    expect(result).to.contain('```diff');
    expect(result).to.contain('+a: new');
    expect(result).to.contain('```yaml');
    expect(result).to.contain('kind: Deviation');
  });

  it('returns an error message when the template file does not exist', () => {
    const output = loadTemplate('does-not-exist', testContext, {});
    expect(output).to.match(/Error loading template does-not-exist/);
    expect(consoleStub.called).to.be.true;
  });

  it('renders the transaction template with provided variables', () => {
    const result = loadTemplate('transaction', testContext, {
      id: 123,
      state: 'complete',
      username: 'tester',
      description: 'demo',
      dryRun: 'No',
      success: 'Yes',
      successColor: '#2ECC71',
      changedCrs: [],
      inputCrs: [],
      nodesWithConfigChanges: [],
      rawJson: '{}'
    });

    expect(result).to.contain('# Transaction Details');
    expect(result).to.contain('123');
    expect(result).to.contain('Success');
    expect(result).to.contain('```json');
  });
});
