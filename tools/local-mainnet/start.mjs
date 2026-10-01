import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (
  process.argv.length !== 2 ||
  process.env.NODE_ENV === 'production' ||
  process.env.LOCAL_DEMO_MODE === 'enabled' ||
  process.env.DEPLOYMENT_TARGET
) {
  console.error(
    'Run npm run dev:mainnet in development. Configure public wallet and treasury addresses on the local setup page.',
  );
  process.exit(1);
}
const directory = resolve(root, '.local-mainnet');
mkdirSync(directory, { recursive: true, mode: 0o700 });
if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
  throw new Error('The local journal directory must be a regular directory.');
const config = resolve(directory, 'config.json');
if (!existsSync(config))
  writeFileSync(
    config,
    JSON.stringify(
      {
        ethereumWallet: '',
        solanaWallet: '',
        ethereumTreasury: '',
        solanaTreasury: '',
        ethereumSourceRouter: null,
        ethereumSupplyRouter: null,
        solanaLookupTables: [],
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
if (!lstatSync(config).isFile() || lstatSync(config).isSymbolicLink())
  throw new Error('The configuration must be a regular file.');
if (!existsSync(resolve(root, 'onchain/node_modules/solc/index.js'))) {
  console.error('Install the contract toolchain first: npm ci --prefix onchain');
  process.exit(1);
}
const build = spawnSync(process.execPath, ['scripts/compile.mjs'], {
  cwd: resolve(root, 'onchain'),
  stdio: 'inherit',
  windowsHide: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);
const child = spawn(
  process.execPath,
  [
    resolve(root, 'node_modules/next/dist/bin/next'),
    'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    '3000',
  ],
  {
    cwd: resolve(root, 'apps/web'),
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      LOCAL_MAINNET_TEST_MODE: 'enabled',
      LOCAL_MAINNET_TEST_LAUNCH_TOKEN: randomBytes(32).toString('hex'),
      LOCAL_MAINNET_TEST_DATA_DIR: directory,
      LOCAL_MAINNET_TEST_CONFIG: config,
      LOCAL_MAINNET_TEST_REPOSITORY: root,
      MAINNET_REPOSITORY_ROOT: root,
      AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
      WEB_API_PROXY_MODE: 'disabled',
      LOCAL_DEMO_MODE: 'disabled',
    },
  },
);
console.log(
  'Open http://127.0.0.1:3000 - Bonsai smart lending with local wallet access and wallet-funded deposit amounts.',
);
console.log(
  'The browser wallet approves every deployment and transaction. Keep .local-mainnet for recovery.',
);
child.once('error', () => {
  console.error('Could not start the local mainnet app.');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
