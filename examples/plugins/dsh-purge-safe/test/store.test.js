import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SafeStore } from '../lib/store.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-purge-safe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, '.dsh');
  fs.mkdirSync(home);
  return new SafeStore({ env: { DSH_HOME: home } });
}

test('defaults, save, backup and rollback only the plugin config', (t) => {
  const store = fixture(t);
  assert.equal(store.readConfig().enabled, true);
  store.saveConfig({ enabled: false, backupRetention: 4, verbose: true });
  const backup = store.createBackup();
  store.saveConfig({ enabled: true, backupRetention: 8, verbose: false });
  const result = store.rollback(backup.id);
  assert.equal(result.changed, true);
  assert.deepEqual(store.readConfig(), { enabled: false, backupRetention: 4, verbose: true });
  assert.ok(store.listBackups().some(item => item.id === result.safetyBackup));
});

test('rejects invalid settings and symlinked plugin data directory', (t) => {
  const store = fixture(t);
  assert.throws(() => store.saveConfig({ enabled: true, backupRetention: 99, verbose: false }));
  fs.symlinkSync(os.tmpdir(), store.base, 'dir');
  assert.throws(() => store.createBackup());
});

test('self check reports a usable initial state', (t) => {
  const store = fixture(t);
  const result = store.selfCheck();
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.equal(result.ok, major > 22 || (major === 22 && minor >= 19));
});

test('panel registration exposes only the safe manager actions', async (t) => {
  const { apply } = await import('../lib/index.js');
  const store = fixture(t);
  let registered;
  const ctx = {
    inject: (services, callback) => {
      assert.deepEqual(services, ['dshGo']);
      callback({ dshGo: { panel: (id, definition) => { registered = { id, definition }; } } });
    }
  };
  apply(ctx, { store });
  assert.equal(registered.id, 'manager');
  assert.deepEqual(Object.keys(registered.definition.actions).sort(), [
    'create-backup', 'rollback-latest', 'run-check', 'save-config'
  ]);
  const first = registered.definition.data({}, value => { registered.data = value; });
  assert.equal(typeof first, 'function');
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.equal(registered.data.check.summary, major > 22 || (major === 22 && minor >= 19) ? '通过' : '需检查');
  const result = registered.definition.actions['create-backup']();
  assert.match(result.toast, /备份已创建/);
  assert.equal(store.listBackups().length, 1);
  store.saveConfig({ enabled: false, backupRetention: 4, verbose: false });
  assert.equal(registered.definition.actions['create-backup']().toast, '管理操作已停用，请先重新启用');
});

test('view provides a v1 fallback when the host lacks v2 form components', async () => {
  const { managerView } = await import('../lib/view.js');
  assert.equal(managerView({}, { components: ['stack', 'text'] }).v, 1);
  assert.equal(managerView({}, { components: ['stack', 'form', 'toggle', 'number'] }).v, 2);
});
