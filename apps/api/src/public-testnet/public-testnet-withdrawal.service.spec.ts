jest.mock('rpc-websockets', () => ({ CommonClient: class {}, WebSocket: jest.fn() }));

import { Keypair, PublicKey, SystemInstruction, Transaction } from '@solana/web3.js';

import { parseAccountId } from '../accounts/domain/account-profile';
import {
  PUBLIC_TESTNET_CHAIN_ID,
  PUBLIC_TESTNET_COLLATERAL_MINT,
  PUBLIC_TESTNET_GENESIS_HASH,
  PUBLIC_TESTNET_RPC_ENDPOINT,
  PUBLIC_TESTNET_TOKEN_PROGRAM,
  derivePublicTestnetAssociatedTokenAddress,
} from './public-testnet-execution.constants';
import type { PublicTestnetExecutionConfig } from './public-testnet-execution.config';
import type {
  PublicTestnetExecutionRpc,
  PublicTestnetWithdrawalPreflightObservation,
  PublicTestnetWithdrawalTransactionObservation,
} from './public-testnet-execution.rpc';
import {
  PublicTestnetWithdrawalService,
  buildPublicTestnetWithdrawalUnsignedTransaction,
  type PublicTestnetWithdrawalIntentResponse,
} from './public-testnet-withdrawal.service';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const SIGNER = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const WALLET = SIGNER.publicKey;
const SOURCE_COLLATERAL = derivePublicTestnetAssociatedTokenAddress(
  WALLET,
  PUBLIC_TESTNET_COLLATERAL_MINT,
);
const TEMPORARY_SEED = 'wdv1:0123456789abcdef0123456789a';
const BLOCKHASH = '11111111111111111111111111111111';
const CONFIG = Object.freeze({
  mode: 'enabled' as const,
  rpcEndpoint: PUBLIC_TESTNET_RPC_ENDPOINT,
  genesisHash: PUBLIC_TESTNET_GENESIS_HASH,
  requestTimeoutMilliseconds: 7_000 as const,
  responseMaximumBytes: 262_144 as const,
}) satisfies PublicTestnetExecutionConfig;

function base58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (const byte of bytes) {
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
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return (
    '1'.repeat(zeroes) +
    digits
      .reverse()
      .map((digit) => alphabet[digit] ?? '')
      .join('')
  );
}

async function temporaryAccount(seed = TEMPORARY_SEED): Promise<PublicKey> {
  return PublicKey.createWithSeed(WALLET, seed, PUBLIC_TESTNET_TOKEN_PROGRAM);
}

async function preflight(): Promise<PublicTestnetWithdrawalPreflightObservation> {
  return Object.freeze({
    slot: 100n,
    blockhash: BLOCKHASH,
    lastValidBlockHeight: 250n,
    observedAt: '2026-08-27T12:00:00.000Z',
    nativeBalanceLamports: 20_000_000n,
    temporaryAccountRentLamports: 2_039_280n,
    collateralBalanceAtomic: 9_407_374n,
    estimatedLiquidityAtomic: 9_999_999n,
    reserveAvailableLiquidityAtomic: 1_000_000_000n,
    sourceCollateralAccount: SOURCE_COLLATERAL,
    temporaryLiquidityAccount: await temporaryAccount(),
  });
}

function signed(intent: PublicTestnetWithdrawalIntentResponse): {
  signature: string;
  signedTransactionBase64: string;
} {
  const transaction = Transaction.from(
    Buffer.from(intent.transaction.serializedTransactionBase64, 'base64'),
  );
  transaction.sign(SIGNER);
  const signature = transaction.signatures[0]?.signature;
  if (signature === null || signature === undefined) throw new Error('missing signature');
  return Object.freeze({
    signature: base58(signature),
    signedTransactionBase64: transaction.serialize().toString('base64'),
  });
}

describe('PublicTestnetWithdrawalService', () => {
  it('builds one legacy create-with-seed withdrawal requiring only the wallet signature', async () => {
    const temporary = await temporaryAccount();
    const transaction = buildPublicTestnetWithdrawalUnsignedTransaction(
      WALLET,
      SOURCE_COLLATERAL,
      temporary,
      TEMPORARY_SEED,
      2_039_280n,
      9_407_374n,
      BLOCKHASH,
      '12345678-1234-4123-8123-123456789abc',
    );
    const decoded = Transaction.from(
      transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
    );
    expect(decoded.instructions).toHaveLength(5);
    expect(decoded.signatures).toHaveLength(1);
    expect(decoded.signatures[0]?.publicKey.equals(WALLET)).toBe(true);
    expect(decoded.signatures[0]?.signature).toBeNull();
    const created = SystemInstruction.decodeCreateWithSeed(decoded.instructions[1]!);
    expect(created.fromPubkey.equals(WALLET)).toBe(true);
    expect(created.basePubkey.equals(WALLET)).toBe(true);
    expect(created.newAccountPubkey.equals(temporary)).toBe(true);
    expect(created.seed).toBe(TEMPORARY_SEED);
    expect(created.programId.equals(PUBLIC_TESTNET_TOKEN_PROGRAM)).toBe(true);
    expect(created.space).toBe(165);
    decoded.sign(SIGNER);
    expect(decoded.verifySignatures()).toBe(true);
    expect(decoded.signatures).toHaveLength(1);
  });

  it('broadcasts signed bytes once and uses signature-only recovery without resending', async () => {
    const pending: PublicTestnetWithdrawalTransactionObservation = Object.freeze({
      status: 'PENDING' as const,
    });
    const verified: PublicTestnetWithdrawalTransactionObservation = Object.freeze({
      status: 'VERIFIED' as const,
      slot: 120n,
      collateralBalanceBeforeAtomic: 9_407_374n,
      collateralBalanceAfterAtomic: 0n,
      decreaseAtomic: 9_407_374n,
      liquidityReceivedAtomic: 10_000_001n,
    });
    const verifyFinalizedWithdrawal = jest
      .fn<Promise<PublicTestnetWithdrawalTransactionObservation>, []>()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(verified);
    const broadcastSignedTransaction = jest.fn(async () => 'accepted');
    const rpc = {
      preflight: jest.fn(),
      readPosition: jest.fn(),
      verifyFinalizedDeposit: jest.fn(),
      broadcastSignedTransaction,
      preflightWithdrawal: jest.fn(async (_wallet: PublicKey, temporary: PublicKey) => ({
        ...(await preflight()),
        temporaryLiquidityAccount: temporary,
      })),
      verifyFinalizedWithdrawal,
    } as unknown as PublicTestnetExecutionRpc;
    const service = new PublicTestnetWithdrawalService(rpc, CONFIG);
    const intent = await service.createIntent(ACCOUNT_ID, {
      chainId: PUBLIC_TESTNET_CHAIN_ID,
      account: WALLET.toBase58(),
    });
    const submission = signed(intent);
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, submission),
    ).resolves.toMatchObject({ status: 'PENDING', consumed: false });
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, {
        signature: submission.signature,
      }),
    ).resolves.toMatchObject({ status: 'VERIFIED', consumed: true });
    expect(broadcastSignedTransaction).toHaveBeenCalledTimes(1);
    expect(verifyFinalizedWithdrawal).toHaveBeenCalledTimes(2);
  });
});
