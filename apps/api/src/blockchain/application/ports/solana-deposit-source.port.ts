import type { SolanaTokenProgramId } from '../../domain/solana-token-account';

export type SolanaDepositCommitment = 'processed' | 'confirmed';

export interface SolanaDepositSourceRequestContext {
  readonly signal?: AbortSignal;
}

export interface SolanaTokenAccountsByOwnerRequest extends SolanaDepositSourceRequestContext {
  readonly ownerAddress: string;
  readonly tokenProgramId: SolanaTokenProgramId;
  readonly commitment: SolanaDepositCommitment;
  readonly minContextSlot?: bigint;
}

export interface NormalizedSolanaTokenAccountSourceValue {
  readonly address: string;
  readonly programId: string;
  /** Null is an explicit closed-account observation, never a zero balance. */
  readonly data: Uint8Array | null;
}

export interface NormalizedSolanaTokenAccountsByOwnerSourceResult {
  readonly contextSlot: bigint;
  readonly accounts: readonly NormalizedSolanaTokenAccountSourceValue[];
}

/**
 * Provider-neutral, read-only boundary for a future approved Solana adapter.
 * Implementations normalize wire data to the exported shapes but return it as `unknown` so the
 * indexer cannot accidentally trust an adapter or provider without runtime validation.
 */
export interface SolanaDepositSourcePort {
  /** Returns the full genesis hash string, not the shortened CAIP-2 reference. */
  getGenesisHash(context: SolanaDepositSourceRequestContext): Promise<unknown>;
  /** Returns a NormalizedSolanaTokenAccountsByOwnerSourceResult as an untrusted value. */
  getTokenAccountsByOwner(request: SolanaTokenAccountsByOwnerRequest): Promise<unknown>;
}
