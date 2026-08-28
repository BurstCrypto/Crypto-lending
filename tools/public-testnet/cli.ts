import { assertLocalPublicTestnetOperatorBoundary } from './boundary';
import { PUBLIC_TESTNET_PROFILES, validatePublicTestnetProfiles } from './profiles';
import { runPublicTestnetSmoke } from './smoke';

function usage(): string {
  return [
    'Usage:',
    '  npm run testnet:live:preflight  # offline configuration validation',
    '  npm run testnet:live:smoke      # eight read-only public JSON-RPC calls',
  ].join('\n');
}

function printPreflight(): void {
  validatePublicTestnetProfiles(PUBLIC_TESTNET_PROFILES);
  process.stdout.write('Public testnet configuration preflight passed (no network calls).\n');
  for (const profile of PUBLIC_TESTNET_PROFILES) {
    process.stdout.write(`- ${profile.name}: ${profile.networkId}\n`);
  }
  process.stdout.write(
    'No keys, wallets, faucets, signing, or transaction methods are configured.\n',
  );
}

async function printLiveSmoke(): Promise<void> {
  assertLocalPublicTestnetOperatorBoundary(process.env);
  const results = await runPublicTestnetSmoke(PUBLIC_TESTNET_PROFILES);
  process.stdout.write('Live public testnet read-only smoke passed.\n');
  for (const result of results) {
    process.stdout.write(
      `- ${result.name}: identity ${result.identity}; finalized position ${result.finalizedPosition}\n`,
    );
  }
  process.stdout.write(
    'Exactly eight JSON-RPC reads completed; no key, wallet, faucet, signing, or broadcast path exists.\n',
  );
}

async function main(): Promise<void> {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || (mode !== '--preflight' && mode !== '--live')) {
    throw new Error(usage());
  }

  if (mode === '--preflight') {
    printPreflight();
    return;
  }
  await printLiveSmoke();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'PUBLIC_TESTNET_UNKNOWN_FAILURE';
  process.stderr.write(`Public testnet check failed: ${message}\n`);
  process.exitCode = 1;
});
