import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'node:buffer';

import {
  parsePublicTestnetExecutionIntent,
  parsePublicTestnetSubmissionResult,
  PUBLIC_TESTNET_AMOUNT_ATOMIC,
  PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM,
  PUBLIC_TESTNET_CHAIN_ID,
  PUBLIC_TESTNET_FAUCET_URL,
  PUBLIC_TESTNET_MEMO_PROGRAM,
  PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS,
  PUBLIC_TESTNET_SAVE_COLLATERAL_MINT,
  PUBLIC_TESTNET_SAVE_LIQUIDITY_VAULT,
  PUBLIC_TESTNET_SAVE_MARKET,
  PUBLIC_TESTNET_SAVE_MARKET_AUTHORITY,
  PUBLIC_TESTNET_SAVE_PROGRAM,
  PUBLIC_TESTNET_SAVE_RESERVE,
  PUBLIC_TESTNET_TOKEN_PROGRAM,
  PUBLIC_TESTNET_WRAPPED_SOL_MINT,
  type PublicTestnetExecutionIntent,
  type PublicTestnetExecutionRequest,
  type PublicTestnetSubmissionResult,
} from '../lib/public-testnet/public-testnet-execution';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// jsdom installs a realm-local Uint8Array. web3.js' Node Buffer and noble-hashes otherwise
// disagree on instanceof checks while deriving PDAs in component tests.
Object.defineProperty(globalThis, 'Uint8Array', {
  configurable: true,
  value: Object.getPrototypeOf(Buffer.prototype).constructor,
});

export const PUBLIC_TESTNET_ACCOUNT = new PublicKey(
  Uint8Array.from({ length: 32 }, (_, index) => index + 1),
).toBase58();
export const PUBLIC_TESTNET_BLOCKHASH = new PublicKey(
  Uint8Array.from({ length: 32 }, () => 9),
).toBase58();
export const PUBLIC_TESTNET_INTENT_ID = '11111111-1111-4111-8111-111111111111' as const;
export const PUBLIC_TESTNET_NOW = new Date('2026-08-27T12:00:00.000Z');

function encodeBase58(value: Uint8Array): string {
  const digits = [0];
  for (const byte of value) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = '';
  for (let index = 0; index < value.length - 1 && value[index] === 0; index += 1) result += '1';
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    result += BASE58_ALPHABET[digits[index] ?? 0];
  }
  return result;
}

export const PUBLIC_TESTNET_SIGNATURE = encodeBase58(
  Uint8Array.from({ length: 64 }, (_, index) => index + 1),
);

export function deriveFixtureAta(owner: string, mint: string): string {
  return PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBytes(),
      new PublicKey(PUBLIC_TESTNET_TOKEN_PROGRAM).toBytes(),
      new PublicKey(mint).toBytes(),
    ],
    new PublicKey(PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM),
  )[0].toBase58();
}

export const PUBLIC_TESTNET_SOURCE_LIQUIDITY_ACCOUNT = deriveFixtureAta(
  PUBLIC_TESTNET_ACCOUNT,
  PUBLIC_TESTNET_WRAPPED_SOL_MINT,
);
export const PUBLIC_TESTNET_DESTINATION_COLLATERAL_ACCOUNT = deriveFixtureAta(
  PUBLIC_TESTNET_ACCOUNT,
  PUBLIC_TESTNET_SAVE_COLLATERAL_MINT,
);

function ataInstruction(wallet: string, ata: string, mint: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM),
    keys: [
      { pubkey: new PublicKey(wallet), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(ata), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(wallet), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(mint), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(PUBLIC_TESTNET_TOKEN_PROGRAM), isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function syncNativeInstruction(source: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(PUBLIC_TESTNET_TOKEN_PROGRAM),
    keys: [{ pubkey: new PublicKey(source), isSigner: false, isWritable: true }],
    data: Buffer.from([17]),
  });
}

function saveDepositInstruction(
  wallet: string,
  source: string,
  destination: string,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(PUBLIC_TESTNET_SAVE_PROGRAM),
    keys: [
      { pubkey: new PublicKey(source), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(destination), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(PUBLIC_TESTNET_SAVE_RESERVE), isSigner: false, isWritable: true },
      {
        pubkey: new PublicKey(PUBLIC_TESTNET_SAVE_LIQUIDITY_VAULT),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: new PublicKey(PUBLIC_TESTNET_SAVE_COLLATERAL_MINT),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: new PublicKey(PUBLIC_TESTNET_SAVE_MARKET), isSigner: false, isWritable: false },
      {
        pubkey: new PublicKey(PUBLIC_TESTNET_SAVE_MARKET_AUTHORITY),
        isSigner: false,
        isWritable: false,
      },
      { pubkey: new PublicKey(wallet), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(PUBLIC_TESTNET_TOKEN_PROGRAM), isSigner: false, isWritable: false },
    ],
    data: Buffer.from([4, 128, 150, 152, 0, 0, 0, 0, 0]),
  });
}

export function publicTestnetTransaction(
  mutate?: ((transaction: Transaction) => void) | undefined,
): Transaction {
  const wallet = new PublicKey(PUBLIC_TESTNET_ACCOUNT);
  const transaction = new Transaction({
    feePayer: wallet,
    recentBlockhash: PUBLIC_TESTNET_BLOCKHASH,
  }).add(
    new TransactionInstruction({
      programId: new PublicKey(PUBLIC_TESTNET_MEMO_PROGRAM),
      keys: [],
      data: Buffer.from(`crypto-lending:devnet-proof:v1:${PUBLIC_TESTNET_INTENT_ID}`, 'utf8'),
    }),
    ataInstruction(
      PUBLIC_TESTNET_ACCOUNT,
      PUBLIC_TESTNET_SOURCE_LIQUIDITY_ACCOUNT,
      PUBLIC_TESTNET_WRAPPED_SOL_MINT,
    ),
    SystemProgram.transfer({
      fromPubkey: wallet,
      toPubkey: new PublicKey(PUBLIC_TESTNET_SOURCE_LIQUIDITY_ACCOUNT),
      lamports: 10_000_000,
    }),
    syncNativeInstruction(PUBLIC_TESTNET_SOURCE_LIQUIDITY_ACCOUNT),
    ataInstruction(
      PUBLIC_TESTNET_ACCOUNT,
      PUBLIC_TESTNET_DESTINATION_COLLATERAL_ACCOUNT,
      PUBLIC_TESTNET_SAVE_COLLATERAL_MINT,
    ),
    saveDepositInstruction(
      PUBLIC_TESTNET_ACCOUNT,
      PUBLIC_TESTNET_SOURCE_LIQUIDITY_ACCOUNT,
      PUBLIC_TESTNET_DESTINATION_COLLATERAL_ACCOUNT,
    ),
  );
  mutate?.(transaction);
  return transaction;
}

export function serializePublicTestnetTransaction(
  mutate?: ((transaction: Transaction) => void) | undefined,
): string {
  const serialized = publicTestnetTransaction(mutate).serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  return Buffer.from(serialized).toString('base64');
}

export function publicTestnetRequest(): PublicTestnetExecutionRequest {
  return {
    portfolioSnapshotId: 'local-demo-portfolio:11111111111111111111111111111111',
    selection: {
      kind: 'PRESET',
      presetId: 'BALANCED',
      liquidReserveBasisPoints: 0,
    },
    chainId: PUBLIC_TESTNET_CHAIN_ID,
    account: PUBLIC_TESTNET_ACCOUNT,
  };
}

export function publicTestnetIntentResponse(
  fundingStatus: 'READY' | 'NEEDS_DEVNET_SOL' = 'READY',
): Record<string, unknown> {
  return {
    use: 'PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY',
    mayAuthorizeMainnetFinancialAction: false,
    intentId: PUBLIC_TESTNET_INTENT_ID,
    expiresAt: '2026-08-27T12:01:00.000Z',
    evidenceExpiresAt: '2026-08-27T12:10:00.000Z',
    chainId: PUBLIC_TESTNET_CHAIN_ID,
    account: PUBLIC_TESTNET_ACCOUNT,
    portfolioBinding: {
      portfolioSnapshotId: publicTestnetRequest().portfolioSnapshotId,
      selection: publicTestnetRequest().selection,
    },
    proof: {
      kind: 'SINGLE_TESTNET_PROOF_POSITION',
      amountAtomic: PUBLIC_TESTNET_AMOUNT_ATOMIC,
      assetSymbol: 'SOL',
      assetDecimals: 9,
      notFullBlend: true,
    },
    transaction: {
      encoding: 'BASE64',
      messageVersion: 'LEGACY',
      serializedTransactionBase64: serializePublicTestnetTransaction(),
      recentBlockhash: PUBLIC_TESTNET_BLOCKHASH,
      lastValidBlockHeight: '500000000',
      minContextSlot: '400000000',
      feePayer: PUBLIC_TESTNET_ACCOUNT,
      sourceLiquidityAccount: PUBLIC_TESTNET_SOURCE_LIQUIDITY_ACCOUNT,
      destinationCollateralAccount: PUBLIC_TESTNET_DESTINATION_COLLATERAL_ACCOUNT,
    },
    fundingReadiness: {
      status: fundingStatus,
      nativeBalanceLamports:
        fundingStatus === 'READY' ? PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS : '19999999',
      requiredNativeBalanceLamports: PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS,
      faucetUrl: PUBLIC_TESTNET_FAUCET_URL,
    },
    liveObservation: {
      confirmation: 'FINALIZED_PREFLIGHT_OBSERVATION',
      slot: '400000000',
      observedAt: '2026-08-27T11:59:45.000Z',
      reserveLiquidityAtomic: '999999999999',
    },
    providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER',
  };
}

export function publicTestnetIntent(
  fundingStatus: 'READY' | 'NEEDS_DEVNET_SOL' = 'READY',
): PublicTestnetExecutionIntent {
  return parsePublicTestnetExecutionIntent(
    publicTestnetIntentResponse(fundingStatus),
    publicTestnetRequest(),
    PUBLIC_TESTNET_NOW,
  );
}

export function publicTestnetSubmissionResponse(
  status: 'PENDING' | 'VERIFIED' = 'VERIFIED',
): Record<string, unknown> {
  if (status === 'PENDING') {
    return {
      intentId: PUBLIC_TESTNET_INTENT_ID,
      status,
      confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION',
      transaction: { status: 'PENDING', signature: PUBLIC_TESTNET_SIGNATURE, slot: null },
      position: {
        status: 'PENDING',
        collateralBalanceBeforeAtomic: '25',
        collateralBalanceAfterAtomic: null,
        increaseAtomic: null,
      },
      consumed: false,
    };
  }
  return {
    intentId: PUBLIC_TESTNET_INTENT_ID,
    status,
    confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION',
    transaction: {
      status: 'VERIFIED',
      signature: PUBLIC_TESTNET_SIGNATURE,
      slot: '400000010',
    },
    position: {
      status: 'VERIFIED',
      collateralBalanceBeforeAtomic: '25',
      collateralBalanceAfterAtomic: '10000025',
      increaseAtomic: '10000000',
    },
    consumed: true,
  };
}

export function publicTestnetSubmission(
  status: 'PENDING' | 'VERIFIED' = 'VERIFIED',
): PublicTestnetSubmissionResult {
  return parsePublicTestnetSubmissionResult(publicTestnetSubmissionResponse(status), {
    intentId: PUBLIC_TESTNET_INTENT_ID,
    signature: PUBLIC_TESTNET_SIGNATURE,
  });
}
