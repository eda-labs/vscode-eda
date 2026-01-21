import Module from 'module';

import sinon from 'sinon';
import { createVSCodeMock } from 'jest-mock-vscode';

// Cast to any to satisfy the TestFramework interface expected by
// createVSCodeMock. Sinon stubs provide the spying functionality
// needed for the VS Code mock.
const vscode = createVSCodeMock({ fn: sinon.stub as any }) as any;

const originalLoad = (Module as any)._load;
// Intercept require calls for 'vscode' and return the mock
(Module as any)._load = function (request: string) {
  if (request === 'vscode') {
    return vscode;
  }
  return originalLoad.apply(this, arguments as any);
};

export = vscode;
