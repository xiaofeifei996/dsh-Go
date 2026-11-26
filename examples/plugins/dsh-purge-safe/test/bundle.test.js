import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('bundle manifest includes its activation patch in the package files', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.ok(pkg.files.includes('cordis.patch.yml'));
  const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8').trim();
  assert.equal(patch, '- insert:\n    - id: dsh-purge-safe\n      name: dsh-purge-safe');
});
