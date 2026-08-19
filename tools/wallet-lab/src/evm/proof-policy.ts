import type { EvmTestnetChainId } from './chains';

export type WalletConnectScopeStatus = 'not-applicable' | 'pending' | 'accepted' | 'blocked';

export function isEvmOwnershipProofReady(
  input: Readonly<{
    connected: boolean;
    currentChainId: number | undefined;
    targetChainId: EvmTestnetChainId;
    walletConnect: boolean;
    walletConnectScope: WalletConnectScopeStatus;
    currentWalletConnectIdentity: string | null;
    guardedWalletConnectIdentity: string | null;
  }>,
): boolean {
  if (!input.connected || input.currentChainId !== input.targetChainId) return false;
  if (!input.walletConnect) return true;
  return (
    input.walletConnectScope === 'accepted' &&
    input.currentWalletConnectIdentity !== null &&
    input.currentWalletConnectIdentity === input.guardedWalletConnectIdentity
  );
}
