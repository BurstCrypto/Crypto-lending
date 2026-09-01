import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
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
} from '../lib/public-testnet/public-testnet-execution';
import {
  claimPublicTestnetWithdrawal,
  parsePublicTestnetWithdrawalIntent,
  startClaimedPublicTestnetWithdrawal,
  type PublicTestnetWithdrawalApi,
  type PublicTestnetWithdrawalIntent,
} from '../lib/public-testnet/public-testnet-withdrawal';
import {
  clearPublicTestnetWithdrawalRecoveryJournal,
  readPublicTestnetWithdrawalRecoveryJournal,
} from '../lib/public-testnet/public-testnet-withdrawal-recovery-journal';
import type { SolanaPublicTestnetWalletPort } from '../lib/wallets/solana/public-testnet-executor';
import {
  PUBLIC_TESTNET_ACCOUNT,
  PUBLIC_TESTNET_DESTINATION_COLLATERAL_ACCOUNT,
} from './public-testnet.fixtures';

const WALLET = new PublicKey(PUBLIC_TESTNET_ACCOUNT);
const ACCOUNT = WALLET.toBase58();
const INTENT_ID = '12345678-1234-4123-8123-123456789abc';
const SEED = 'wdv1:0123456789abcdef0123456789a';
const BLOCKHASH = PUBLIC_TESTNET_SAVE_RESERVE;
const COLLATERAL_AMOUNT = 9_407_374n;
const RENT = 2_039_280;
const SOURCE_COLLATERAL = new PublicKey(PUBLIC_TESTNET_DESTINATION_COLLATERAL_ACCOUNT);

function tokenInstruction(
  keys: TransactionInstruction['keys'],
  data: Uint8Array,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(PUBLIC_TESTNET_TOKEN_PROGRAM),
    keys,
    data: Buffer.from(data),
  });
}

async function response(
  funding: 'READY' | 'NEEDS_DEVNET_SOL' = 'READY',
): Promise<Record<string, unknown>> {
  const temporary = await PublicKey.createWithSeed(
    WALLET,
    SEED,
    new PublicKey(PUBLIC_TESTNET_TOKEN_PROGRAM),
  );
  const redeem = Buffer.alloc(9);
  redeem[0] = 5;
  redeem.writeBigUInt64LE(COLLATERAL_AMOUNT, 1);
  const transaction = new Transaction({ feePayer: WALLET, recentBlockhash: BLOCKHASH }).add(
    new TransactionInstruction({
      programId: new PublicKey(PUBLIC_TESTNET_MEMO_PROGRAM),
      keys: [],
      data: Buffer.from(`crypto-lending:devnet-withdrawal:v1:${INTENT_ID}`),
    }),
    SystemProgram.createAccountWithSeed({
      fromPubkey: WALLET,
      newAccountPubkey: temporary,
      basePubkey: WALLET,
      seed: SEED,
      lamports: RENT,
      space: 165,
      programId: new PublicKey(PUBLIC_TESTNET_TOKEN_PROGRAM),
    }),
    tokenInstruction(
      [
        { pubkey: temporary, isSigner: false, isWritable: true },
        {
          pubkey: new PublicKey(PUBLIC_TESTNET_WRAPPED_SOL_MINT),
          isSigner: false,
          isWritable: false,
        },
      ],
      Uint8Array.from([18, ...WALLET.toBytes()]),
    ),
    new TransactionInstruction({
      programId: new PublicKey(PUBLIC_TESTNET_SAVE_PROGRAM),
      keys: [
        { pubkey: SOURCE_COLLATERAL, isSigner: false, isWritable: true },
        { pubkey: temporary, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(PUBLIC_TESTNET_SAVE_RESERVE), isSigner: false, isWritable: true },
        {
          pubkey: new PublicKey(PUBLIC_TESTNET_SAVE_COLLATERAL_MINT),
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: new PublicKey(PUBLIC_TESTNET_SAVE_LIQUIDITY_VAULT),
          isSigner: false,
          isWritable: true,
        },
        { pubkey: new PublicKey(PUBLIC_TESTNET_SAVE_MARKET), isSigner: false, isWritable: true },
        {
          pubkey: new PublicKey(PUBLIC_TESTNET_SAVE_MARKET_AUTHORITY),
          isSigner: false,
          isWritable: false,
        },
        { pubkey: WALLET, isSigner: true, isWritable: false },
        { pubkey: new PublicKey(PUBLIC_TESTNET_TOKEN_PROGRAM), isSigner: false, isWritable: false },
      ],
      data: redeem,
    }),
    tokenInstruction(
      [
        { pubkey: temporary, isSigner: false, isWritable: true },
        { pubkey: WALLET, isSigner: false, isWritable: true },
        { pubkey: WALLET, isSigner: true, isWritable: false },
      ],
      Uint8Array.of(9),
    ),
  );
  const serialized = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
  const nativeBalance = funding === 'READY' ? '20000000' : '0';
  return {
    use: 'PUBLIC_TESTNET_FULL_POSITION_WITHDRAWAL_ONLY',
    mayAuthorizeMainnetFinancialAction: false,
    intentId: INTENT_ID,
    expiresAt: '2026-08-27T12:00:50.000Z',
    evidenceExpiresAt: '2026-08-27T12:10:00.000Z',
    chainId: PUBLIC_TESTNET_CHAIN_ID,
    account: ACCOUNT,
    proof: {
      kind: 'FULL_TESTNET_POSITION_WITHDRAWAL',
      collateralAmountAtomic: COLLATERAL_AMOUNT.toString(),
      estimatedLiquidityAtomic: '9999999',
      collateralSymbol: 'cSOL',
      assetSymbol: 'SOL',
      assetDecimals: 9,
    },
    transaction: {
      encoding: 'BASE64',
      messageVersion: 'LEGACY',
      serializedTransactionBase64: serialized,
      recentBlockhash: BLOCKHASH,
      lastValidBlockHeight: '250',
      minContextSlot: '100',
      feePayer: ACCOUNT,
      sourceCollateralAccount: SOURCE_COLLATERAL.toBase58(),
      temporaryLiquidityAccount: temporary.toBase58(),
      temporaryAccountSeed: SEED,
    },
    fundingReadiness: {
      status: funding,
      nativeBalanceLamports: nativeBalance,
      requiredNativeBalanceLamports: PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS,
      temporaryAccountRentLamports: RENT.toString(),
      faucetUrl: PUBLIC_TESTNET_FAUCET_URL,
    },
    liveObservation: {
      confirmation: 'FINALIZED_PREFLIGHT_OBSERVATION',
      slot: '100',
      observedAt: '2026-08-27T12:00:00.000Z',
      collateralBalanceAtomic: COLLATERAL_AMOUNT.toString(),
      estimatedLiquidityAtomic: '9999999',
      reserveAvailableLiquidityAtomic: '1000000000',
    },
    providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER',
  };
}

async function intent(funding: 'READY' | 'NEEDS_DEVNET_SOL' = 'READY') {
  return parsePublicTestnetWithdrawalIntent(
    await response(funding),
    { chainId: PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT },
    new Date('2026-08-27T12:00:00.000Z'),
  );
}

function apiFor(withdrawalIntent: PublicTestnetWithdrawalIntent): PublicTestnetWithdrawalApi {
  return {
    createWithdrawalIntent: vi.fn(async () => withdrawalIntent),
    submitSignedWithdrawal: vi.fn(async (_intentId, signature) => ({
      intentId: INTENT_ID,
      status: 'PENDING' as const,
      confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION' as const,
      transaction: { status: 'PENDING' as const, signature, slot: null },
      position: {
        status: 'PENDING' as const,
        collateralBalanceBeforeAtomic: COLLATERAL_AMOUNT.toString(),
        collateralBalanceAfterAtomic: null,
        decreaseAtomic: null,
        liquidityReceivedAtomic: null,
      },
      consumed: false,
    })),
    verifyWithdrawal: vi.fn(),
  };
}

describe('Solana public-testnet withdrawal browser contract', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('accepts only the exact five-instruction reviewed legacy transaction', async () => {
    const parsed = await intent();
    expect(parsed.transaction.messageVersion).toBe('LEGACY');
    expect(
      Transaction.from(Buffer.from(parsed.transaction.serializedTransactionBase64, 'base64'))
        .instructions,
    ).toHaveLength(5);

    const tampered = await response();
    const transactionRecord = tampered.transaction as Record<string, unknown>;
    const transaction = Transaction.from(
      Buffer.from(transactionRecord.serializedTransactionBase64 as string, 'base64'),
    );
    const redeemData = transaction.instructions[3]!.data;
    redeemData[1] = (redeemData[1] ?? 0) ^ 1;
    transactionRecord.serializedTransactionBase64 = transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');
    expect(() =>
      parsePublicTestnetWithdrawalIntent(
        tampered,
        { chainId: PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT },
        new Date('2026-08-27T12:00:00.000Z'),
      ),
    ).toThrow();
  });

  it('refuses wallet signing when finalized funding readiness is not READY', async () => {
    const withdrawalIntent = await intent('NEEDS_DEVNET_SOL');
    const api = apiFor(withdrawalIntent);
    const claim = await claimPublicTestnetWithdrawal(api, {
      chainId: PUBLIC_TESTNET_CHAIN_ID,
      account: ACCOUNT,
    });
    const signTransaction = vi.fn();
    const wallet = { signTransaction } as unknown as SolanaPublicTestnetWalletPort;
    await expect(startClaimedPublicTestnetWithdrawal(api, wallet, claim)).resolves.toMatchObject({
      status: 'FAILED',
    });
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('journals the one wallet signature before one submission and retains pending recovery', async () => {
    const withdrawalIntent = await intent();
    const api = apiFor(withdrawalIntent);
    const claim = await claimPublicTestnetWithdrawal(api, {
      chainId: PUBLIC_TESTNET_CHAIN_ID,
      account: ACCOUNT,
    });
    const signature = '1'.repeat(64);
    const signTransaction = vi.fn(async () => ({
      signature,
      serializedTransaction: claim.transactionRequest.serializedTransaction,
    }));
    const wallet = { signTransaction } as unknown as SolanaPublicTestnetWalletPort;
    await expect(
      startClaimedPublicTestnetWithdrawal(api, wallet, claim, undefined, {
        maximumWaitMilliseconds: 0,
      }),
    ).resolves.toMatchObject({ status: 'RECOVERY_REQUIRED', signature });
    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(api.submitSignedWithdrawal).toHaveBeenCalledTimes(1);
    const journal = readPublicTestnetWithdrawalRecoveryJournal();
    expect(journal).toMatchObject({ intentId: INTENT_ID, account: ACCOUNT, signature });
    clearPublicTestnetWithdrawalRecoveryJournal(journal!);
  });

  it('polls with signature-only reads and clears the lock after finalization', async () => {
    const withdrawalIntent = await intent();
    const api = apiFor(withdrawalIntent);
    const claim = await claimPublicTestnetWithdrawal(api, {
      chainId: PUBLIC_TESTNET_CHAIN_ID,
      account: ACCOUNT,
    });
    const signature = '1'.repeat(64);
    const wallet = {
      signTransaction: vi.fn(async () => ({
        signature,
        serializedTransaction: claim.transactionRequest.serializedTransaction,
      })),
    } as unknown as SolanaPublicTestnetWalletPort;
    vi.mocked(api.verifyWithdrawal).mockResolvedValue({
      intentId: INTENT_ID,
      status: 'VERIFIED',
      confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION',
      transaction: { status: 'VERIFIED', signature, slot: '120' },
      position: {
        status: 'VERIFIED',
        collateralBalanceBeforeAtomic: COLLATERAL_AMOUNT.toString(),
        collateralBalanceAfterAtomic: '0',
        decreaseAtomic: COLLATERAL_AMOUNT.toString(),
        liquidityReceivedAtomic: '10000001',
      },
      consumed: true,
    });
    let now = 0;
    await expect(
      startClaimedPublicTestnetWithdrawal(api, wallet, claim, undefined, {
        intervalMilliseconds: 100,
        maximumWaitMilliseconds: 500,
        now: () => now,
        wait: async (milliseconds) => {
          now += milliseconds;
        },
      }),
    ).resolves.toMatchObject({ status: 'COMPLETE', signature });
    expect(api.submitSignedWithdrawal).toHaveBeenCalledTimes(1);
    expect(api.verifyWithdrawal).toHaveBeenCalledTimes(1);
    expect(readPublicTestnetWithdrawalRecoveryJournal()).toBeNull();
  });
});
