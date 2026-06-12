import * as os from 'os';

import { expect } from 'chai';
// Use CommonJS require so we mutate the SAME vscode mock instance the
// hostScope module imports. `import * as vscode` would go through
// `__importStar` and give us a snapshot copy.
import vscode = require('vscode');

import {
  LOCAL_SCOPE,
  getCurrentScope,
  getNonEmptyOtherScopes,
  getScopeLabel,
  getSelectedTargetIndex,
  getVisibleEntries,
  isScopedTargetsShape,
  normalizeTargetsShape,
  setSelectedTargetIndex
} from '../src/utils/hostScope';

describe('hostScope.getCurrentScope', () => {
  // jest-mock-vscode doesn't ship an `env` namespace, so we plant a writable
  // one and restore it between cases. This is the same pattern other tests
  // use to poke at the mock.
  const mock = vscode as unknown as { env?: { remoteName?: string } };
  let originalEnv: typeof mock.env;

  beforeEach(() => {
    originalEnv = mock.env;
    mock.env = {};
  });

  afterEach(() => {
    mock.env = originalEnv;
  });

  it('returns "local" when there is no remote', () => {
    mock.env = { remoteName: undefined };
    expect(getCurrentScope()).to.equal(LOCAL_SCOPE);
  });

  it('uses remoteName + hostname when attached to a remote', () => {
    mock.env = { remoteName: 'ssh-remote' };
    const expected = `ssh-remote+${os.hostname().replace(/[^a-zA-Z0-9._-]+/g, '_')}`;
    expect(getCurrentScope()).to.equal(expected);
  });
});

describe('hostScope.getScopeLabel', () => {
  it('labels local plainly', () => {
    expect(getScopeLabel('local')).to.equal('Local');
  });
  it('formats SSH scopes', () => {
    expect(getScopeLabel('ssh-remote+jump')).to.equal('SSH: jump');
  });
  it('formats WSL scopes', () => {
    expect(getScopeLabel('wsl+Ubuntu-22.04')).to.equal('WSL: Ubuntu-22.04');
  });
  it('formats unknown remote kinds', () => {
    expect(getScopeLabel('weird-kind+abc')).to.equal('weird-kind: abc');
  });
});

describe('hostScope.isScopedTargetsShape / normalizeTargetsShape', () => {
  it('recognises new scoped shape', () => {
    const raw = {
      local: { 'https://eda.local': { context: 'kind' } },
      'ssh-remote+foo': {}
    };
    expect(isScopedTargetsShape(raw)).to.equal(true);
  });

  it('rejects legacy flat shape with URL keys', () => {
    const raw = { 'https://eda.local': { context: 'kind' } };
    expect(isScopedTargetsShape(raw)).to.equal(false);
  });

  it('rejects legacy flat shape with string values', () => {
    const raw = { 'https://eda.local': 'kind' };
    expect(isScopedTargetsShape(raw)).to.equal(false);
  });

  it('migrates legacy entries into the current scope', () => {
    const raw = {
      'https://eda.local': { context: 'kind', skipTlsVerify: true },
      'https://eda.prod': 'prod-ctx'
    };
    const { scoped, migrated } = normalizeTargetsShape(raw, 'ssh-remote+jump');
    expect(migrated).to.equal(true);
    expect(scoped['ssh-remote+jump']['https://eda.local']).to.deep.equal({ context: 'kind', skipTlsVerify: true });
    expect(scoped['ssh-remote+jump']['https://eda.prod']).to.equal('prod-ctx');
  });

  it('treats an empty object as already-scoped', () => {
    const { scoped, migrated } = normalizeTargetsShape({}, 'local');
    expect(migrated).to.equal(false);
    expect(scoped).to.deep.equal({});
  });

  it('treats undefined as legacy (empty current-scope bucket)', () => {
    const { scoped, migrated } = normalizeTargetsShape(undefined, 'local');
    expect(migrated).to.equal(true);
    expect(scoped.local).to.deep.equal({});
  });

  it('leaves already-scoped objects untouched', () => {
    const raw = {
      local: { 'https://eda.local': { context: 'kind' } },
      'ssh-remote+jump': { 'https://internal': { context: 'prod' } }
    };
    const { scoped, migrated } = normalizeTargetsShape(raw, 'local');
    expect(migrated).to.equal(false);
    expect(scoped).to.deep.equal(raw);
  });
});

describe('hostScope.getVisibleEntries', () => {
  it('returns only entries from the current scope', () => {
    const scoped = {
      local: { 'https://eda.local': { context: 'kind' } },
      'ssh-remote+jump': { 'https://eda.prod': { context: 'prod' } }
    };
    const entries = getVisibleEntries(scoped, 'ssh-remote+jump');
    expect(entries).to.have.length(1);
    expect(entries[0].url).to.equal('https://eda.prod');
    expect(entries[0].scope).to.equal('ssh-remote+jump');
  });

  it('returns nothing when the current scope bucket is empty', () => {
    const scoped = {
      local: { 'https://eda.local': { context: 'kind' } }
    };
    const entries = getVisibleEntries(scoped, 'ssh-remote+new');
    expect(entries).to.deep.equal([]);
  });

  it('returns nothing when there are no entries anywhere', () => {
    const entries = getVisibleEntries({}, 'local');
    expect(entries).to.deep.equal([]);
  });
});

describe('hostScope.getNonEmptyOtherScopes', () => {
  it('lists scopes other than current that have entries', () => {
    const scoped = {
      local: { 'https://eda.local': { context: 'kind' } },
      'ssh-remote+jump': { 'https://eda.prod': { context: 'prod' } },
      'ssh-remote+empty': {}
    };
    const others = getNonEmptyOtherScopes(scoped, 'local');
    expect(others).to.have.members(['ssh-remote+jump']);
  });

  it('returns empty when no other scope has entries', () => {
    const scoped = {
      local: { 'https://eda.local': { context: 'kind' } }
    };
    expect(getNonEmptyOtherScopes(scoped, 'local')).to.deep.equal([]);
  });
});

describe('hostScope selection memento', () => {
  function makeContext(): vscode.ExtensionContext {
    const store = new Map<string, unknown>();
    return {
      globalState: {
        get: (key: string, fallback?: unknown) => (store.has(key) ? store.get(key) : fallback),
        update: async (key: string, value: unknown) => { store.set(key, value); }
      }
    } as unknown as vscode.ExtensionContext;
  }

  it('round-trips per-scope indices', async () => {
    const ctx = makeContext();
    await setSelectedTargetIndex(ctx, 'local', 2);
    await setSelectedTargetIndex(ctx, 'ssh-remote+jump', 4);
    expect(getSelectedTargetIndex(ctx, 'local')).to.equal(2);
    expect(getSelectedTargetIndex(ctx, 'ssh-remote+jump')).to.equal(4);
  });

  it('falls back to legacy selectedEdaTarget for the current scope', () => {
    const ctx = makeContext();
    void ctx.globalState.update('selectedEdaTarget', 7);
    // The legacy fallback only applies for the current scope. Use the value
    // returned by getCurrentScope() so we don't depend on the test runner's
    // remote configuration.
    const currentScope = getCurrentScope();
    expect(getSelectedTargetIndex(ctx, currentScope)).to.equal(7);
    expect(getSelectedTargetIndex(ctx, 'some-other-scope')).to.equal(0);
  });
});
