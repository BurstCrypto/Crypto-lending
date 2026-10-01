import assert from 'node:assert/strict';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { assembleMainnetWeb } from './assemble-mainnet-web.mjs';

test('copies traced provider files without following external build aliases or changing their targets', (t) => {
  const temporary = mkdtempSync(join(tmpdir(), 'mainnet-assembly-'));
  t.after(() => {
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
    rmSync(temporary, { force: true, recursive: true });
  });
  const root = join(temporary, 'standalone'),
    original = join(temporary, 'original');
  mkdirSync(original);
  writeFileSync(join(original, 'index.js'), 'external build content');
  const packages = {
    '@0dotxyz/p0-ts-sdk': '2.8.3',
    '@coral-xyz/anchor': '0.30.1',
    '@jup-ag/lend': '0.3.0-beta.1',
    '@solendprotocol/solend-sdk': '0.14.27',
  };
  const aliases = [];
  for (const [name, version] of Object.entries(packages)) {
    const source = join(root, 'node_modules', name),
      alias = join(root, 'apps/web/.next/node_modules', name + '-1234567890abcdef');
    mkdirSync(source, { recursive: true });
    mkdirSync(dirname(alias), { recursive: true });
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name, version }));
    writeFileSync(join(source, 'index.js'), 'traced runtime content');
    symlinkSync(original, alias, 'junction');
    aliases.push(alias);
  }
  assert.equal(assembleMainnetWeb(root).assembled.length, 4);
  for (const alias of aliases) {
    assert.equal(lstatSync(alias).isSymbolicLink(), false);
    assert.equal(readFileSync(join(alias, 'index.js'), 'utf8'), 'traced runtime content');
  }
  assert.equal(readFileSync(join(original, 'index.js'), 'utf8'), 'external build content');
  assert.deepEqual(assembleMainnetWeb(root).assembled, []);
  symlinkSync(original, join(root, 'node_modules/@0dotxyz/p0-ts-sdk/unsafe'), 'junction');
  assert.throws(() => assembleMainnetWeb(root), /must not contain links/);
});
