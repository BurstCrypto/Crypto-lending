import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function compileContracts(includeTests = false) {
  const sources = Object.fromEntries(
    ['contracts', ...(includeTests ? ['test/contracts'] : [])].flatMap((directory) =>
      readdirSync(resolve(root, directory))
        .filter((name) => name.endsWith('.sol'))
        .map((name) => [
          `${directory}/${name}`,
          { content: readFileSync(resolve(root, directory, name), 'utf8') },
        ]),
    ),
  );
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources,
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: 'cancun',
          outputSelection: {
            '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] },
          },
        },
      }),
      {
        import: (name) => {
          if (!name.startsWith('@openzeppelin/contracts/') || name.includes('..'))
            return { error: 'Unapproved import' };
          return { contents: readFileSync(resolve(root, 'node_modules', name), 'utf8') };
        },
      },
    ),
  );
  const errors = (output.errors ?? []).filter((error) => error.severity === 'error');
  if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join('\n'));
  return output.contracts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contracts = compileContracts();
  mkdirSync(resolve(root, 'build'), { recursive: true });
  for (const [file, entries] of Object.entries(contracts)) {
    if (!file.startsWith('contracts/')) continue;
    for (const [name, contract] of Object.entries(entries)) {
      if (!contract.evm.bytecode.object) continue;
      writeFileSync(
        resolve(root, 'build', `${name}.json`),
        `${JSON.stringify(
          {
            contractName: name,
            compiler: solc.version(),
            abi: contract.abi,
            bytecode: `0x${contract.evm.bytecode.object}`,
            deployedBytecode: `0x${contract.evm.deployedBytecode.object}`,
            immutableReferences: contract.evm.deployedBytecode.immutableReferences,
          },
          null,
          2,
        )}\n`,
      );
      process.stdout.write(`Compiled ${name}\n`);
    }
  }
}
