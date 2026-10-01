import { cpSync, lstatSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGES = Object.freeze({
  '@0dotxyz/p0-ts-sdk': '2.8.3',
  '@coral-xyz/anchor': '0.30.1',
  '@jup-ag/lend': '0.3.0-beta.1',
  '@solendprotocol/solend-sdk': '0.14.27',
});

/** Turbopack external aliases can point back outside its standalone output.
 * Materialize only the four known SDK aliases from their already traced copies.
 * Never follow those alias targets or copy the developer's node_modules tree. */
export function assembleMainnetWeb(rootInput) {
  const root = resolve(rootInput);
  const contained = (path) => {
    const rel = relative(root, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
      throw new Error('Invalid standalone assembly path.');
    return path;
  };
  const directory = (path) => {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('Invalid standalone assembly directory.');
    return path;
  };
  directory(root);
  let aliasRoot = root;
  for (const part of ['apps', 'web', '.next', 'node_modules'])
    aliasRoot = directory(join(aliasRoot, part));
  const tracedRoot = directory(join(root, 'node_modules'));
  const checkTree = (path) => {
    const stat = lstatSync(contained(path));
    if (stat.isSymbolicLink()) throw new Error('A traced provider copy must not contain links.');
    if (stat.isDirectory()) for (const name of readdirSync(path)) checkTree(join(path, name));
    else if (!stat.isFile() || stat.nlink !== 1) throw new Error('Invalid traced provider file.');
  };
  const assembled = [];
  for (const [name, version] of Object.entries(PACKAGES)) {
    const [scope, packageName] = name.split('/');
    const aliases = directory(join(aliasRoot, scope));
    const source = directory(join(directory(join(tracedRoot, scope)), packageName));
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    if (manifest.name !== name || manifest.version !== version)
      throw new Error('Unexpected traced provider version.');
    checkTree(source);
    const names = readdirSync(aliases).filter((entry) => entry.startsWith(packageName + '-'));
    if (names.length !== 1 || !/^[0-9a-f]{16}$/.test(names[0].slice(packageName.length + 1)))
      throw new Error('Unexpected provider alias.');
    const target = contained(join(aliases, names[0]));
    if (!lstatSync(target).isSymbolicLink()) {
      checkTree(target);
      continue;
    }
    // This unlinks only the checked alias itself; its external target is untouched.
    unlinkSync(target);
    cpSync(source, target, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    assembled.push(name);
  }
  return { assembled };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3)
    throw new Error('Usage: node assemble-mainnet-web.mjs <standalone-root>');
  process.stdout.write(JSON.stringify(assembleMainnetWeb(process.argv[2])) + '\n');
}
