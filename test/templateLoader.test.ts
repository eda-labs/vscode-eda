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
      resourceYaml: 'kind: Deviation\nmetadata:\n  name: my-dev'
    });

    // Basic expectations showing placeholders are replaced
    expect(result).to.contain('# Deviation Details');
    expect(result).to.contain('`my-dev`');
    expect(result).to.contain('```yaml');
    expect(result).to.contain('kind: Deviation');
  });

  it('returns an error message when the template file does not exist', () => {
    const output = loadTemplate('does-not-exist', testContext, {});
    expect(output).to.match(/Error loading template does-not-exist/);
    expect(consoleStub.called).to.be.true;
  });
});
