import { address, fail } from './policy';
import { solanaAddress } from './solana-address';
import { hasBothWallets, type BridgeConfig, type LocalWalletConfig } from './bridge-types';

export function parseBridgeConfig(value: unknown): BridgeConfig {
  const config = parseLocalWalletConfig(value);
  if (!hasBothWallets(config)) return fail('Connect both Ethereum and Solana wallets to bridge between chains.');
  return config;
}
export function parseLocalWalletConfig(value: unknown): LocalWalletConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Configure at least one wallet and the treasury receiving addresses.');
  const r = value as Record<string, unknown>;
  const keys = ['ethereumWallet', 'solanaWallet', 'ethereumTreasury', 'solanaTreasury', 'ethereumSourceRouter', 'ethereumSupplyRouter', 'solanaLookupTables'];
  if ('ethereumLendingRouter' in r) keys.push('ethereumLendingRouter');
  if (Object.keys(r).sort().join(',') !== keys.sort().join(',')) return fail('The bridge configuration has unexpected fields.');
  const config: LocalWalletConfig = {
    ethereumWallet: r.ethereumWallet === null || r.ethereumWallet === '' ? null : address(r.ethereumWallet),
    solanaWallet: r.solanaWallet === null || r.solanaWallet === '' ? null : solanaAddress(r.solanaWallet),
    ethereumTreasury: address(r.ethereumTreasury), solanaTreasury: solanaAddress(r.solanaTreasury, false),
    ethereumSourceRouter: r.ethereumSourceRouter === null || r.ethereumSourceRouter === '' ? null : address(r.ethereumSourceRouter),
    ethereumSupplyRouter: r.ethereumSupplyRouter === null || r.ethereumSupplyRouter === '' ? null : address(r.ethereumSupplyRouter),
    ...('ethereumLendingRouter' in r ? { ethereumLendingRouter: r.ethereumLendingRouter == null || r.ethereumLendingRouter === '' ? null : address(r.ethereumLendingRouter) } : {}),
    solanaLookupTables: [],
  };
  if (!config.ethereumWallet && !config.solanaWallet) return fail('Connect at least one Ethereum or Solana wallet.');
  if (!Array.isArray(r.solanaLookupTables) || r.solanaLookupTables.length > 4) return fail('Configure up to four Solana lookup tables.');
  config.solanaLookupTables = r.solanaLookupTables.map((key) => solanaAddress(key, false));
  if (new Set(config.solanaLookupTables).size !== config.solanaLookupTables.length || config.ethereumWallet === config.ethereumTreasury ||
    config.solanaWallet === config.solanaTreasury || (config.ethereumSourceRouter && config.ethereumSourceRouter === config.ethereumSupplyRouter)) return fail('Wallets and treasuries must be distinct, and router/table entries must be unique.');
  return config;
}

export interface WalletConfigurationStore { read(): LocalWalletConfig; write(config: LocalWalletConfig): void }
export const missingConfigurationStore: WalletConfigurationStore = { read: () => fail('The wallet workspace is unavailable.'), write: () => fail('The wallet workspace is unavailable.') };
