import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { address, fail } from '../mainnet/policy';
import { solanaAddress } from '../mainnet/solana-address';
import { type BridgeConfig, type LocalWalletConfig } from '../mainnet/bridge-types';

export { parseBridgeConfig, parseLocalWalletConfig } from '../mainnet/wallet-config';
import { parseBridgeConfig, parseLocalWalletConfig } from '../mainnet/wallet-config';

/** Prefill saved public fee recipients while transaction-wallet setup is incomplete. */
export function readTreasurySetup(): { ethereumTreasury: string; solanaTreasury: string } {
  const draft = { ethereumTreasury: '', solanaTreasury: '' };
  try {
    const path = process.env.LOCAL_MAINNET_TEST_CONFIG;
    if (!path) return draft;
    const saved: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return draft;
    const fields = saved as Record<string, unknown>;
    try { draft.ethereumTreasury = address(fields.ethereumTreasury); } catch { /* Leave invalid or absent addresses for setup. */ }
    try { draft.solanaTreasury = solanaAddress(fields.solanaTreasury, false); } catch { /* Same for Solana. */ }
  } catch { /* Missing or incomplete local configuration must still show the setup form. */ }
  return draft;
}

export function readBridgeConfig(): BridgeConfig {
  return parseBridgeConfig(readLocalWalletConfig());
}
export function readLocalWalletConfig(): LocalWalletConfig {
  const path = process.env.LOCAL_MAINNET_TEST_CONFIG;
  if (!path) return fail('Start this page with npm run dev:mainnet.');
  try { return parseLocalWalletConfig(JSON.parse(readFileSync(path, 'utf8'))); }
  catch { return fail('Connect at least one wallet and configure the treasury receiving addresses.'); }
}
export function writeBridgeConfig(config: BridgeConfig) {
  writeLocalWalletConfig(parseBridgeConfig(config));
}
export function writeLocalWalletConfig(config: LocalWalletConfig) {
  const path = process.env.LOCAL_MAINNET_TEST_CONFIG;
  if (!path) return fail('The local configuration path is unavailable.');
  const checked = parseLocalWalletConfig(config);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(checked, null, 2)}\n`, { mode: 0o600, flag: 'w' });
  renameSync(temporary, path);
}
export function setupTokenMatches(token: string | null) {
  const expected = process.env.LOCAL_MAINNET_TEST_LAUNCH_TOKEN;
  return Boolean(token && expected && /^[0-9a-f]{64}$/.test(token) && timingSafeEqual(Buffer.from(token), Buffer.from(expected)));
}
