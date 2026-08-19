import type { Wallet, WalletAccount } from '@wallet-standard/base';

import { WALLET_LAB_ORIGIN } from '../local-boundary';

export const SOLANA_DEVNET_CHAIN = 'solana:devnet' as const;
export const SOLANA_WALLET_LAB_DOMAIN = '127.0.0.1:4173' as const;
export const SOLANA_WALLET_LAB_ORIGIN = WALLET_LAB_ORIGIN;

export type SolanaOwnershipCapability = 'solana:signIn' | 'solana:signMessage' | null;

export interface SolanaWalletCapabilities {
  readonly connect: boolean;
  readonly disconnect: boolean;
  readonly events: boolean;
  readonly signIn: boolean;
  readonly signMessage: boolean;
  readonly ownership: SolanaOwnershipCapability;
}

export interface DiscoveredSolanaWallet {
  /** In-memory selection handle. It is not a wallet identity or persisted value. */
  readonly id: string;
  /** Wallet Standard presentation metadata; it is self-reported by the extension. */
  readonly name: string;
  readonly chain: typeof SOLANA_DEVNET_CHAIN;
  readonly capabilities: SolanaWalletCapabilities;
}

export interface ConnectedSolanaAccount {
  readonly walletId: string;
  readonly walletName: string;
  readonly chain: typeof SOLANA_DEVNET_CHAIN;
  readonly address: string;
  readonly capabilities: SolanaWalletCapabilities;
}

export type PhantomSolanaAdapterStatus =
  'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'signing' | 'error';

export type PhantomSolanaErrorCode =
  | 'account_selection_required'
  | 'adapter_destroyed'
  | 'already_connected'
  | 'invalid_request'
  | 'invalid_wallet_response'
  | 'request_cancelled'
  | 'request_in_progress'
  | 'unsupported_capability'
  | 'user_rejected'
  | 'wallet_not_connected'
  | 'wallet_not_found'
  | 'wallet_request_failed'
  | 'wallet_unavailable';

export interface SanitizedSolanaError {
  readonly code: PhantomSolanaErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface PhantomSolanaAdapterState {
  readonly status: PhantomSolanaAdapterStatus;
  readonly chain: typeof SOLANA_DEVNET_CHAIN;
  readonly wallets: readonly DiscoveredSolanaWallet[];
  readonly connection: ConnectedSolanaAccount | null;
  readonly error: SanitizedSolanaError | null;
}

export interface DevnetSignInInput {
  readonly domain: string;
  readonly address: string;
  readonly statement?: string;
  readonly uri: string;
  readonly version: '1';
  readonly chainId: typeof SOLANA_DEVNET_CHAIN;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expirationTime: string;
  readonly notBefore?: string;
  readonly requestId: string;
  readonly resources?: readonly string[];
}

export interface SolanaSignInResult {
  readonly method: 'solana:signIn';
  readonly chain: typeof SOLANA_DEVNET_CHAIN;
  readonly address: string;
  readonly account: {
    readonly address: string;
    readonly publicKey: Uint8Array;
  };
  readonly signedMessage: Uint8Array;
  readonly signature: Uint8Array;
  readonly signatureType: 'ed25519';
}

export interface SolanaSignMessageResult {
  readonly method: 'solana:signMessage';
  readonly chain: typeof SOLANA_DEVNET_CHAIN;
  readonly address: string;
  readonly account: {
    readonly address: string;
    readonly publicKey: Uint8Array;
  };
  readonly signedMessage: Uint8Array;
  readonly signature: Uint8Array;
  readonly signatureType: 'ed25519';
}

export type SolanaOwnershipVerificationFailure =
  | 'account_mismatch'
  | 'crypto_unavailable'
  | 'expired'
  | 'invalid_expected_input'
  | 'invalid_proof'
  | 'invalid_signature'
  | 'invalid_time'
  | 'issued_at_out_of_range'
  | 'message_mismatch'
  | 'not_yet_valid'
  | 'origin_mismatch'
  | 'verification_failed';

export type SolanaOwnershipVerification =
  | {
      readonly status: 'locally-verified';
      readonly reason: null;
      readonly method: Exclude<SolanaOwnershipCapability, null>;
      readonly chain: typeof SOLANA_DEVNET_CHAIN;
      readonly address: string;
    }
  | {
      readonly status: 'blocked';
      readonly reason: SolanaOwnershipVerificationFailure;
      readonly method: Exclude<SolanaOwnershipCapability, null>;
      readonly chain: typeof SOLANA_DEVNET_CHAIN;
    };

export type SolanaOwnershipVerificationRequest =
  | {
      readonly method: 'solana:signIn';
      readonly expectedOrigin: string;
      readonly input: DevnetSignInInput;
      readonly result: SolanaSignInResult;
    }
  | {
      readonly method: 'solana:signMessage';
      readonly expectedAddress: string;
      readonly expectedMessage: Uint8Array;
      readonly result: SolanaSignMessageResult;
    };

export interface SolanaOwnershipVerificationOptions {
  /** Defaults to the current time. Supplying a value makes server-side checks deterministic. */
  readonly now?: number | Date;
  /** Phantom's published default is ten minutes. */
  readonly issuedAtToleranceMs?: number;
  /** Test/server override. The browser default is `globalThis.crypto.subtle`. */
  readonly subtle?: Pick<SubtleCrypto, 'importKey' | 'verify'> | null;
}

export interface WalletStandardRegistry {
  get(): readonly Wallet[];
  on(event: 'register' | 'unregister', listener: (...wallets: Wallet[]) => void): () => void;
}

export interface PhantomSolanaAdapterOptions {
  readonly wallets?: WalletStandardRegistry;
  readonly expectedChain?: typeof SOLANA_DEVNET_CHAIN;
}

export interface PhantomConnectOptions {
  /** Required when the wallet authorizes more than one devnet account. */
  readonly accountAddress?: string;
}

export interface PhantomSolanaAdapter {
  readonly chain: typeof SOLANA_DEVNET_CHAIN;
  /** Non-interactive Wallet Standard discovery; never calls `standard:connect`. */
  discover(): readonly DiscoveredSolanaWallet[];
  /** Interactive only: call from a user gesture after explicit wallet selection. */
  connect(walletId: string, options?: PhantomConnectOptions): Promise<ConnectedSolanaAccount>;
  /** Interactive only: clears in-memory state even if the wallet lacks disconnect. */
  disconnect(): Promise<void>;
  getOwnershipCapability(): SolanaOwnershipCapability;
  /** Interactive SIWS request. The returned bytes still require server verification. */
  signIn(input: DevnetSignInInput): Promise<SolanaSignInResult>;
  /** Interactive canonical-message fallback. The exact returned bytes require verification. */
  signMessage(message: Uint8Array): Promise<SolanaSignMessageResult>;
  getState(): PhantomSolanaAdapterState;
  subscribe(listener: (state: PhantomSolanaAdapterState) => void): () => void;
  destroy(): void;
}

export interface PhantomSolanaAdapterLease {
  readonly adapter: PhantomSolanaAdapter;
  /** Idempotent. Final cleanup is deferred one microtask to survive StrictMode replay. */
  readonly release: () => void;
}

export interface PhantomSolanaAdapterLifecycle {
  acquire(): PhantomSolanaAdapterLease;
  /** Terminal, immediate cleanup for the owner of the lifecycle object. */
  dispose(): void;
}

export interface SelectedWalletAccount {
  readonly wallet: Wallet;
  readonly walletId: string;
  readonly account: WalletAccount;
}

export class PhantomSolanaAdapterError extends Error implements SanitizedSolanaError {
  readonly code: PhantomSolanaErrorCode;
  readonly recoverable: boolean;

  constructor(code: PhantomSolanaErrorCode, message: string, recoverable: boolean) {
    super(message);
    this.name = 'PhantomSolanaAdapterError';
    this.code = code;
    this.recoverable = recoverable;
  }
}
