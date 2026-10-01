import type { Address, Hex } from 'viem';
import type { LendingProvider } from '../lending/markets';

export const BRIDGE_ETHEREUM = 'eip155:1' as const;
export const BRIDGE_SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
export type BridgeNetwork = typeof BRIDGE_ETHEREUM | typeof BRIDGE_SOLANA;
export const CIRCLE_ETHEREUM_MESSENGER = '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d' as Address;
export const CIRCLE_ETHEREUM_TRANSMITTER = '0x81d40f21f12a8f0e3252bccb954d722d4c464b64' as Address;
export interface BridgeConfig {
  ethereumWallet: Address;
  solanaWallet: string;
  ethereumTreasury: Address;
  solanaTreasury: string;
  ethereumSourceRouter: Address | null;
  ethereumSupplyRouter: Address | null;
  ethereumLendingRouter?: Address | null;
  solanaLookupTables: string[];
}
export interface LocalWalletConfig extends Omit<BridgeConfig, 'ethereumWallet' | 'solanaWallet'> {
  ethereumWallet: Address | null;
  solanaWallet: string | null;
}
export function hasBothWallets(config: LocalWalletConfig): config is BridgeConfig {
  return Boolean(config.ethereumWallet && config.solanaWallet);
}
export type BridgeStatus =
  | 'CREATED'
  | 'SOURCE_PENDING'
  | 'SOURCE_FAILED'
  | 'AWAITING_ATTESTATION'
  | 'READY_TO_MINT'
  | 'DESTINATION_PENDING'
  | 'MINTED'
  | 'LENT'
  | 'CANCELLED';
export interface BridgeRecord {
  id: Hex;
  config: BridgeConfig;
  plan: Record<string, string | number>;
  createdAt: number;
  status: BridgeStatus;
  revision: number;
  sourceTransactionId: string | null;
  emittedMessage: Hex | null;
  attestation: { message: Hex; signature: Hex } | null;
  received: string | null;
  smartQuoteId?: string;
  destinationProvider?: LendingProvider;
}
export type BridgeStepKind =
  | 'SOURCE_APPROVAL'
  | 'SOURCE_REVOKE'
  | 'SOURCE_BURN'
  | 'DESTINATION_APPROVAL'
  | 'DESTINATION_REVOKE'
  | 'DESTINATION_MINT_SUPPLY'
  | 'DESTINATION_MINT'
  | 'DESTINATION_SUPPLY'
  | 'DEPLOY_SOURCE'
  | 'DEPLOY_SUPPLY'
  | 'DEPLOY_LENDING'
  | 'CREATE_LOOKUP_TABLE'
  | 'EXTEND_LOOKUP_TABLE'
  | 'LENDING_APPROVAL'
  | 'LENDING_REVOKE'
  | 'LENDING_SUPPLY'
  | 'LENDING_WITHDRAW';
export function isDirectLendingStep(step: BridgeStep) {
  return (
    step.bridgeId === null &&
    [
      'DEPLOY_LENDING',
      'LENDING_APPROVAL',
      'LENDING_REVOKE',
      'LENDING_SUPPLY',
      'LENDING_WITHDRAW',
    ].includes(step.kind)
  );
}
export type BridgeStepState =
  | 'PREPARED'
  | 'RESERVED'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FINALIZED'
  | 'FAILED'
  | 'REJECTED'
  | 'CANCELLED';
export interface BridgeStep {
  id: string;
  bridgeId: Hex | null;
  kind: BridgeStepKind;
  network: BridgeNetwork;
  wallet: string;
  state: BridgeStepState;
  createdAt: number;
  expiresAt: number;
  fingerprint: string;
  transactionId: string | null;
  ethereum: {
    from: Address;
    to?: Address;
    data: Hex;
    value: '0x0';
    chainId: '0x1';
    type: '0x2';
    gas: Hex;
    nonce: Hex;
    maxFeePerGas: Hex;
    maxPriorityFeePerGas: Hex;
  } | null;
  solana: {
    serialized: string;
    version: 'legacy' | 0;
    message: string;
    lastValidBlockHeight: number;
    contextSlot: number;
  } | null;
  maxNetworkCost: string;
  sourcePrincipal: string;
  // Public, immutable context required to verify events or recover after restart.
  evidence: Record<string, string>;
  // Observed finalized effects, separate from the immutable transaction review.
  outcome?: { usdcAmount: string; receiptTokens?: string };
  walletError?: string;
}
export interface BridgeUiState {
  configured: boolean;
  config: LocalWalletConfig | null;
  setupError: string | null;
  authenticated: boolean;
  localAccess?: boolean;
  paused: boolean;
  bridges: BridgeRecord[];
  steps: BridgeStep[];
  lendingSteps?: BridgeStep[];
}
export function completedStep(state: BridgeStepState) {
  return ['FINALIZED', 'FAILED', 'REJECTED', 'CANCELLED'].includes(state);
}
