jest.mock('rpc-websockets', () => ({ CommonClient: class {}, WebSocket: jest.fn() }));

import {
  ComputeBudgetProgram,
  Keypair,
  SystemInstruction,
  Transaction,
  type PublicKey,
} from '@solana/web3.js';

import { parseAccountId } from '../accounts/domain/account-profile';
import type { JobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import type { LocalDemoAllocationService } from '../local-demo/local-demo-allocation.service';
import {
  PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM,
  PUBLIC_TESTNET_CHAIN_ID,
  PUBLIC_TESTNET_COLLATERAL_MINT,
  PUBLIC_TESTNET_GENESIS_HASH,
  PUBLIC_TESTNET_LENDING_MARKET,
  PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY,
  PUBLIC_TESTNET_LENDING_PROGRAM,
  PUBLIC_TESTNET_MEMO_PREFIX,
  PUBLIC_TESTNET_MEMO_PROGRAM,
  PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC,
  PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY,
  PUBLIC_TESTNET_RPC_ENDPOINT,
  PUBLIC_TESTNET_SOL_RESERVE,
  PUBLIC_TESTNET_TOKEN_PROGRAM,
  PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT,
  PUBLIC_TESTNET_WRAPPED_SOL_MINT,
  derivePublicTestnetAssociatedTokenAddress,
} from './public-testnet-execution.constants';
import type { PublicTestnetExecutionConfig } from './public-testnet-execution.config';
import {
  PublicTestnetBroadcastAmbiguousError,
  PublicTestnetBroadcastRejectedError,
  PublicTestnetEvidenceMismatchError,
  type PublicTestnetExecutionRpc,
  type PublicTestnetPositionObservation,
  type PublicTestnetPreflightObservation,
  type PublicTestnetTransactionObservation,
  type PublicTestnetVerificationExpectation,
  type PublicTestnetSignedTransactionSubmission,
} from './public-testnet-execution.rpc';
import {
  PublicTestnetExecutionService,
  PublicTestnetIntentCapacityError,
  PublicTestnetIntentConflictError,
  PublicTestnetIntentExpiredError,
  PublicTestnetIntentNotFoundError,
  type PublicTestnetIntentRequest,
  type PublicTestnetIntentResponse,
} from './public-testnet-execution.service';

const ACCOUNT_ID = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const OTHER_ACCOUNT_ID = parseAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const SIGNER = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const WALLET = SIGNER.publicKey;
const SNAPSHOT = 'local-demo-portfolio:0123456789abcdef0123456789abcdef';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const CONFIG = Object.freeze({
  mode: 'enabled' as const,
  rpcEndpoint: PUBLIC_TESTNET_RPC_ENDPOINT,
  genesisHash: PUBLIC_TESTNET_GENESIS_HASH,
  requestTimeoutMilliseconds: 7_000 as const,
  responseMaximumBytes: 262_144 as const,
}) satisfies PublicTestnetExecutionConfig;
const CORRELATION: JobCorrelationContext = Object.freeze({
  correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  initiatorActorId: ACCOUNT_ID,
});

function base58(bytes: Uint8Array): string {
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
      .map((digit) => BASE58_ALPHABET[digit] ?? '')
      .join('')
  );
}

function signatureForIntent(intent: PublicTestnetIntentResponse): string {
  const transaction = Transaction.from(
    Buffer.from(intent.transaction.serializedTransactionBase64, 'base64'),
  );
  transaction.sign(SIGNER);
  const signature = transaction.signatures[0]?.signature;
  if (signature === null || signature === undefined) throw new Error('Test signature is missing');
  return base58(signature);
}

function walletModifiedSignatureForIntent(
  intent: PublicTestnetIntentResponse,
  microLamports = 375_000,
): string {
  const transaction = Transaction.from(
    Buffer.from(intent.transaction.serializedTransactionBase64, 'base64'),
  );
  transaction.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT }),
  );
  transaction.sign(SIGNER);
  const signature = transaction.signatures[0]?.signature;
  if (signature === null || signature === undefined) throw new Error('Test signature is missing');
  return base58(signature);
}

function signedSubmissionForIntent(
  intent: PublicTestnetIntentResponse,
  walletComputeBudget = false,
): PublicTestnetSignedTransactionSubmission {
  const transaction = Transaction.from(
    Buffer.from(intent.transaction.serializedTransactionBase64, 'base64'),
  );
  if (walletComputeBudget) {
    transaction.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 375_000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT }),
    );
  }
  transaction.sign(SIGNER);
  const signature = transaction.signatures[0]?.signature;
  if (signature === null || signature === undefined) throw new Error('Test signature is missing');
  return Object.freeze({
    signature: base58(signature),
    signedTransactionBase64: transaction.serialize().toString('base64'),
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function request(): PublicTestnetIntentRequest {
  return Object.freeze({
    portfolioSnapshotId: SNAPSHOT,
    selection: Object.freeze({
      kind: 'PRESET' as const,
      presetId: 'BALANCED' as const,
      liquidReserveBasisPoints: 0,
    }),
    chainId: PUBLIC_TESTNET_CHAIN_ID,
    account: WALLET.toBase58(),
  });
}

function preflight(nativeBalanceLamports = 20_000_000n): PublicTestnetPreflightObservation {
  return Object.freeze({
    slot: 100n,
    blockhash: '11111111111111111111111111111111',
    lastValidBlockHeight: 250n,
    observedAt: '2026-08-27T12:00:00.000Z',
    reserveLiquidityAtomic: 19_000_000_000_000n,
    nativeBalanceLamports,
    collateralBalanceBeforeAtomic: 7n,
    sourceLiquidityAccount: derivePublicTestnetAssociatedTokenAddress(
      WALLET,
      PUBLIC_TESTNET_WRAPPED_SOL_MINT,
    ),
    destinationCollateralAccount: derivePublicTestnetAssociatedTokenAddress(
      WALLET,
      PUBLIC_TESTNET_COLLATERAL_MINT,
    ),
  });
}

function position(): PublicTestnetPositionObservation {
  return Object.freeze({
    slot: 100n,
    observedAt: '2026-08-27T12:00:00.000Z',
    collateralBalanceAtomic: 9_407_374n,
    suppliedLiquidityAtomic: 9_999_999n,
    supplyApyBasisPoints: 125,
    utilizationBasisPoints: 3_228,
    reserveLastUpdatedSlot: 95n,
    reserveMarkedStale: false,
  });
}

function fixture(nativeBalanceLamports = 20_000_000n): {
  service: PublicTestnetExecutionService;
  rpc: jest.Mocked<PublicTestnetExecutionRpc>;
  allocations: { preview: jest.Mock };
} {
  const allocations = {
    preview: jest.fn(async () => ({
      portfolioSnapshotId: SNAPSHOT,
      selection: request().selection,
    })),
  };
  const preflightMock = jest.fn<Promise<PublicTestnetPreflightObservation>, [PublicKey]>(async () =>
    preflight(nativeBalanceLamports),
  );
  const verificationMock = jest.fn<
    Promise<PublicTestnetTransactionObservation>,
    [string, PublicTestnetVerificationExpectation]
  >(async () => ({ status: 'PENDING' as const }));
  const positionMock = jest.fn<Promise<PublicTestnetPositionObservation>, [PublicKey]>(async () =>
    position(),
  );
  const broadcastMock = jest.fn<
    Promise<string>,
    [PublicTestnetSignedTransactionSubmission, PublicTestnetVerificationExpectation]
  >(async (submission) => submission.signature);
  const rpc: jest.Mocked<PublicTestnetExecutionRpc> = {
    preflight: preflightMock,
    readPosition: positionMock,
    broadcastSignedTransaction: broadcastMock,
    verifyFinalizedDeposit: verificationMock,
  };
  return {
    allocations,
    rpc,
    service: new PublicTestnetExecutionService(
      allocations as unknown as LocalDemoAllocationService,
      rpc,
      CONFIG,
    ),
  };
}

describe('PublicTestnetExecutionService', () => {
  it('maps a finalized RPC observation to a deeply frozen read-only position', async () => {
    const { service, rpc } = fixture();
    const result = await service.readPosition(ACCOUNT_ID, {
      chainId: PUBLIC_TESTNET_CHAIN_ID,
      account: WALLET.toBase58(),
    });

    expect(rpc.readPosition).toHaveBeenCalledWith(WALLET);
    expect(result).toEqual({
      use: 'PUBLIC_TESTNET_READ_ONLY_POSITION',
      mayAuthorizeFinancialAction: false,
      chainId: PUBLIC_TESTNET_CHAIN_ID,
      account: WALLET.toBase58(),
      provider: {
        name: 'Save / Solend',
        program: PUBLIC_TESTNET_LENDING_PROGRAM.toBase58(),
        market: PUBLIC_TESTNET_LENDING_MARKET.toBase58(),
        reserve: PUBLIC_TESTNET_SOL_RESERVE.toBase58(),
      },
      position: {
        status: 'OPEN',
        assetSymbol: 'SOL',
        assetDecimals: 9,
        suppliedLiquidityAtomic: '9999999',
        collateralTokenSymbol: 'cSOL',
        collateralTokenAtomic: '9407374',
        collateralTokenDecimals: 9,
      },
      rate: {
        kind: 'ONCHAIN_INDICATIVE_BASE_SUPPLY_APY',
        supplyApyBasisPoints: 125,
        utilizationBasisPoints: 3228,
        variable: true,
        rewardsIncluded: false,
        riskAssessed: false,
        historyAvailable: false,
        reserveLastUpdatedSlot: '95',
        reserveMarkedStale: false,
      },
      liveObservation: {
        confirmation: 'FINALIZED_POSITION_OBSERVATION',
        slot: '100',
        observedAt: '2026-08-27T12:00:00.000Z',
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.provider)).toBe(true);
    expect(Object.isFrozen(result.position)).toBe(true);
    expect(Object.isFrozen(result.rate)).toBe(true);
    expect(Object.isFrozen(result.liveObservation)).toBe(true);
  });

  it('reports an empty position without suppressing the current reserve rate', async () => {
    const { service, rpc } = fixture();
    rpc.readPosition.mockResolvedValueOnce({
      ...position(),
      collateralBalanceAtomic: 0n,
      suppliedLiquidityAtomic: 0n,
    });

    await expect(
      service.readPosition(ACCOUNT_ID, {
        chainId: PUBLIC_TESTNET_CHAIN_ID,
        account: WALLET.toBase58(),
      }),
    ).resolves.toMatchObject({
      position: { status: 'EMPTY', suppliedLiquidityAtomic: '0', collateralTokenAtomic: '0' },
      rate: { supplyApyBasisPoints: 125, historyAvailable: false },
    });
  });

  it('builds the exact intent-bound unsigned six-instruction legacy SOL deposit', async () => {
    const { service, rpc } = fixture();
    const result = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    expect(rpc.preflight).toHaveBeenCalledWith(expect.objectContaining({}));
    expect(result.proof).toEqual({
      kind: 'SINGLE_TESTNET_PROOF_POSITION',
      amountAtomic: '10000000',
      assetSymbol: 'SOL',
      assetDecimals: 9,
      notFullBlend: true,
    });
    expect(result.fundingReadiness).toEqual({
      status: 'READY',
      nativeBalanceLamports: '20000000',
      requiredNativeBalanceLamports: '20000000',
      faucetUrl: 'https://faucet.solana.com/',
    });
    const transaction = Transaction.from(
      Buffer.from(result.transaction.serializedTransactionBase64, 'base64'),
    );
    expect(transaction.feePayer?.equals(WALLET)).toBe(true);
    expect(transaction.signatures).toHaveLength(1);
    expect(transaction.signatures[0]?.signature).toBeNull();
    expect(transaction.instructions).toHaveLength(6);
    expect(transaction.instructions.map((instruction) => instruction.programId.toBase58())).toEqual(
      [
        PUBLIC_TESTNET_MEMO_PROGRAM.toBase58(),
        PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM.toBase58(),
        '11111111111111111111111111111111',
        PUBLIC_TESTNET_TOKEN_PROGRAM.toBase58(),
        PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM.toBase58(),
        PUBLIC_TESTNET_LENDING_PROGRAM.toBase58(),
      ],
    );
    expect(transaction.instructions[0]!.keys).toEqual([]);
    expect(transaction.instructions[0]!.data.toString('utf8')).toBe(
      `${PUBLIC_TESTNET_MEMO_PREFIX}${result.intentId}`,
    );
    expect([...transaction.instructions[1]!.data]).toEqual([1]);
    expect(SystemInstruction.decodeTransfer(transaction.instructions[2]!).lamports).toBe(
      PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC,
    );
    expect([...transaction.instructions[3]!.data]).toEqual([17]);
    expect([...transaction.instructions[4]!.data]).toEqual([1]);
    expect(transaction.instructions[5]!.data.toString('hex')).toBe('048096980000000000');
    expect(transaction.instructions[5]!.keys.map((key) => key.pubkey.toBase58())).toEqual([
      result.transaction.sourceLiquidityAccount,
      result.transaction.destinationCollateralAccount,
      PUBLIC_TESTNET_SOL_RESERVE.toBase58(),
      PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY.toBase58(),
      PUBLIC_TESTNET_COLLATERAL_MINT.toBase58(),
      PUBLIC_TESTNET_LENDING_MARKET.toBase58(),
      PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY.toBase58(),
      WALLET.toBase58(),
      PUBLIC_TESTNET_TOKEN_PROGRAM.toBase58(),
    ]);
    expect(Date.parse(result.evidenceExpiresAt) - Date.parse(result.expiresAt)).toBe(540_000);
    expect(JSON.stringify(result)).not.toMatch(/private.?key|mnemonic|seed phrase/iu);
  });

  it('reports conservative Devnet SOL funding readiness', async () => {
    const { service } = fixture(19_999_999n);
    const result = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    expect(result.fundingReadiness.status).toBe('NEEDS_DEVNET_SOL');
  });

  it('binds exact signed bytes, broadcasts once, then makes signature-only recovery read-only', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const submission = signedSubmissionForIntent(intent, true);

    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, submission),
    ).resolves.toMatchObject({
      status: 'PENDING',
      transaction: { signature: submission.signature },
    });
    expect(rpc.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.broadcastSignedTransaction).toHaveBeenCalledWith(
      submission,
      expect.objectContaining({
        wallet: WALLET,
        expectedMessageBase64: expect.any(String),
        preflightSlot: 100n,
        lastValidBlockHeight: 250n,
      }),
    );

    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, {
        signature: submission.signature,
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, submission),
    ).resolves.toMatchObject({ status: 'PENDING' });
    expect(rpc.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.verifyFinalizedDeposit).toHaveBeenCalledTimes(3);
  });

  it('coalesces concurrent first submissions of the same signed bytes into one broadcast', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const submission = signedSubmissionForIntent(intent);
    const broadcast = deferred<string>();
    rpc.broadcastSignedTransaction.mockReturnValueOnce(broadcast.promise);

    const first = service.verifySubmission(ACCOUNT_ID, intent.intentId, submission);
    const second = service.verifySubmission(ACCOUNT_ID, intent.intentId, submission);
    expect(rpc.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.verifyFinalizedDeposit).not.toHaveBeenCalled();

    broadcast.resolve(submission.signature);
    await expect(first).resolves.toMatchObject({ status: 'PENDING' });
    await expect(second).resolves.toMatchObject({ status: 'PENDING' });
    expect(rpc.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.verifyFinalizedDeposit).toHaveBeenCalledTimes(1);
  });

  it('keeps an ambiguously broadcast transaction bound and never sends it again', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const submission = signedSubmissionForIntent(intent);
    rpc.broadcastSignedTransaction.mockRejectedValueOnce(
      new PublicTestnetBroadcastAmbiguousError(),
    );

    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, submission),
    ).rejects.toBeInstanceOf(PublicTestnetBroadcastAmbiguousError);
    expect(rpc.verifyFinalizedDeposit).not.toHaveBeenCalled();

    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, {
        signature: submission.signature,
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    expect(rpc.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.verifyFinalizedDeposit).toHaveBeenCalledTimes(1);
  });

  it('keeps a definitely rejected transaction bound and never sends it again', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const submission = signedSubmissionForIntent(intent);
    rpc.broadcastSignedTransaction.mockRejectedValueOnce(new PublicTestnetBroadcastRejectedError());

    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, submission),
    ).rejects.toBeInstanceOf(PublicTestnetBroadcastRejectedError);
    expect(rpc.verifyFinalizedDeposit).not.toHaveBeenCalled();

    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, {
        signature: submission.signature,
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    expect(rpc.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
    expect(rpc.verifyFinalizedDeposit).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid signed bytes before binding and permits a corrected first send', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const submission = signedSubmissionForIntent(intent);
    const corrupted = Buffer.from(submission.signedTransactionBase64, 'base64');
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] ?? 0) ^ 1;

    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, {
        signature: submission.signature,
        signedTransactionBase64: corrupted.toString('base64'),
      }),
    ).rejects.toBeInstanceOf(PublicTestnetEvidenceMismatchError);
    expect(rpc.broadcastSignedTransaction).not.toHaveBeenCalled();

    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, submission),
    ).resolves.toMatchObject({ status: 'PENDING' });
    expect(rpc.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
  });

  it('permits signed bytes only before intent expiry while retaining signature-only recovery', async () => {
    const now = 1_800_000_000_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const { service, rpc } = fixture();
      const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
      const submission = signedSubmissionForIntent(intent);
      clock.mockReturnValue(now + 60_000);

      await expect(
        service.verifySubmission(ACCOUNT_ID, intent.intentId, submission),
      ).rejects.toBeInstanceOf(PublicTestnetIntentExpiredError);
      expect(rpc.broadcastSignedTransaction).not.toHaveBeenCalled();
      await expect(
        service.verifySubmission(ACCOUNT_ID, intent.intentId, {
          signature: submission.signature,
        }),
      ).resolves.toMatchObject({ status: 'PENDING' });
    } finally {
      clock.mockRestore();
    }
  });

  it('polls one bound signature until its finalized collateral delta verifies', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const signature = signatureForIntent(intent);
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature }),
    ).resolves.toMatchObject({
      status: 'PENDING',
      confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION',
      transaction: { status: 'PENDING', signature, slot: null },
      position: {
        status: 'PENDING',
        collateralBalanceBeforeAtomic: '7',
        collateralBalanceAfterAtomic: null,
        increaseAtomic: null,
      },
      consumed: false,
    });
    rpc.verifyFinalizedDeposit.mockResolvedValueOnce({
      status: 'VERIFIED',
      slot: 101n,
      collateralBalanceBeforeAtomic: 7n,
      collateralBalanceAfterAtomic: 9_000_007n,
      increaseAtomic: 9_000_000n,
    });
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature }),
    ).resolves.toMatchObject({
      status: 'VERIFIED',
      confirmation: 'LATEST_SIGNATURE_STATUS_OBSERVATION',
      transaction: { status: 'VERIFIED', signature, slot: '101' },
      position: {
        status: 'VERIFIED',
        collateralBalanceBeforeAtomic: '7',
        collateralBalanceAfterAtomic: '9000007',
        increaseAtomic: '9000000',
      },
      consumed: true,
    });
  });

  it('leaves a wallet-modified pending signature unbound so it cannot squat the intent', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const walletModifiedSignature = walletModifiedSignatureForIntent(intent);
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, {
        signature: walletModifiedSignature,
      }),
    ).resolves.toMatchObject({
      status: 'PENDING',
      transaction: { signature: walletModifiedSignature },
      consumed: false,
    });

    const exactSignature = signatureForIntent(intent);
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature: exactSignature }),
    ).resolves.toMatchObject({ status: 'PENDING', transaction: { signature: exactSignature } });
    expect(rpc.verifyFinalizedDeposit).toHaveBeenCalledTimes(2);
  });

  it('binds a wallet-modified signature only after finalized evidence verifies', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const signature = walletModifiedSignatureForIntent(intent);
    rpc.verifyFinalizedDeposit.mockResolvedValueOnce({
      status: 'VERIFIED',
      slot: 101n,
      collateralBalanceBeforeAtomic: 7n,
      collateralBalanceAfterAtomic: 9_000_007n,
      increaseAtomic: 9_000_000n,
    });

    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature }),
    ).resolves.toMatchObject({
      status: 'VERIFIED',
      transaction: { status: 'VERIFIED', signature, slot: '101' },
      consumed: true,
    });
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, {
        signature: signatureForIntent(intent),
      }),
    ).rejects.toBeInstanceOf(PublicTestnetIntentConflictError);
  });

  it('coalesces concurrent checks of the same unbound wallet-modified signature', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const signature = walletModifiedSignatureForIntent(intent);
    const observation = deferred<PublicTestnetTransactionObservation>();
    rpc.verifyFinalizedDeposit.mockReturnValue(observation.promise);

    const firstVerification = service.verifySubmission(ACCOUNT_ID, intent.intentId, {
      signature,
    });
    const secondVerification = service.verifySubmission(ACCOUNT_ID, intent.intentId, {
      signature,
    });
    expect(rpc.verifyFinalizedDeposit).toHaveBeenCalledTimes(1);
    observation.resolve({ status: 'PENDING' });
    await expect(firstVerification).resolves.toMatchObject({ status: 'PENDING' });
    await expect(secondVerification).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('caps unbound candidates and rejects one that loses a race to the exact signature', async () => {
    const { service, rpc } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const firstSignature = walletModifiedSignatureForIntent(intent, 375_000);
    const secondSignature = walletModifiedSignatureForIntent(intent, 300_000);
    const exactSignature = signatureForIntent(intent);
    const first = deferred<PublicTestnetTransactionObservation>();
    rpc.verifyFinalizedDeposit.mockImplementation((signature) => {
      if (signature === firstSignature) return first.promise;
      if (signature === exactSignature) return Promise.resolve({ status: 'PENDING' });
      throw new Error('Unexpected signature');
    });

    const firstVerification = service.verifySubmission(ACCOUNT_ID, intent.intentId, {
      signature: firstSignature,
    });
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature: secondSignature }),
    ).rejects.toBeInstanceOf(PublicTestnetIntentConflictError);
    expect(rpc.verifyFinalizedDeposit).toHaveBeenCalledTimes(1);
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature: exactSignature }),
    ).resolves.toMatchObject({ status: 'PENDING' });

    const verifiedObservation = {
      status: 'VERIFIED' as const,
      slot: 101n,
      collateralBalanceBeforeAtomic: 7n,
      collateralBalanceAfterAtomic: 9_000_007n,
      increaseAtomic: 9_000_000n,
    };
    first.resolve(verifiedObservation);
    await expect(firstVerification).rejects.toBeInstanceOf(PublicTestnetIntentConflictError);
  });

  it('preserves authenticated ownership and single-signature conflict binding', async () => {
    const { service } = fixture();
    const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const signature = signatureForIntent(intent);
    await expect(
      service.verifySubmission(OTHER_ACCOUNT_ID, intent.intentId, { signature }),
    ).rejects.toBeInstanceOf(PublicTestnetIntentNotFoundError);
    await service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature });
    await expect(
      service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature: '2'.repeat(64) }),
    ).rejects.toBeInstanceOf(PublicTestnetIntentConflictError);
  });

  it('globally rejects reuse of an accepted signature by another intent', async () => {
    const { service } = fixture();
    const first = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const second = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const signature = signatureForIntent(first);
    await service.verifySubmission(ACCOUNT_ID, first.intentId, { signature });
    await expect(
      service.verifySubmission(ACCOUNT_ID, second.intentId, { signature }),
    ).rejects.toBeInstanceOf(PublicTestnetIntentConflictError);
  });

  it('rejects a signature for another memo without squatting its valid intent binding', async () => {
    const { service, rpc } = fixture();
    const first = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    const second = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
    expect(first.transaction.serializedTransactionBase64).not.toBe(
      second.transaction.serializedTransactionBase64,
    );
    const signature = signatureForIntent(first);
    rpc.verifyFinalizedDeposit.mockRejectedValueOnce(new PublicTestnetEvidenceMismatchError());
    await expect(
      service.verifySubmission(ACCOUNT_ID, second.intentId, { signature }),
    ).rejects.toBeInstanceOf(PublicTestnetEvidenceMismatchError);
    expect(rpc.verifyFinalizedDeposit).toHaveBeenCalledTimes(1);
    await expect(
      service.verifySubmission(ACCOUNT_ID, first.intentId, { signature }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    expect(rpc.verifyFinalizedDeposit).toHaveBeenCalledWith(signature, expect.any(Object));
  });

  it('accepts first evidence after signing expiry, polls it for ten minutes, then prunes', async () => {
    const now = 1_800_000_000_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const { service } = fixture();
      const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
      const signature = signatureForIntent(intent);
      clock.mockReturnValue(now + 61_000);
      await expect(
        service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature }),
      ).resolves.toMatchObject({ status: 'PENDING' });
      clock.mockReturnValue(now + 599_999);
      await expect(
        service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature }),
      ).resolves.toMatchObject({ status: 'PENDING' });
      clock.mockReturnValue(now + 600_000);
      await expect(
        service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature }),
      ).rejects.toBeInstanceOf(PublicTestnetIntentNotFoundError);
    } finally {
      clock.mockRestore();
    }
  });

  it('does not return exact-signature evidence if the intent expires during the RPC read', async () => {
    const now = 1_800_000_000_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const { service, rpc } = fixture();
      const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
      const signature = signatureForIntent(intent);
      const observation = deferred<PublicTestnetTransactionObservation>();
      rpc.verifyFinalizedDeposit.mockReturnValueOnce(observation.promise);
      const verification = service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature });
      clock.mockReturnValue(now + 600_000);
      observation.resolve({ status: 'PENDING' });
      await expect(verification).rejects.toBeInstanceOf(PublicTestnetIntentNotFoundError);
    } finally {
      clock.mockRestore();
    }
  });

  it('expires an unbound intent only at the evidence-retention deadline', async () => {
    const now = 1_800_000_000_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const { service } = fixture();
      const intent = await service.createIntent(ACCOUNT_ID, CORRELATION, request());
      const signature = signatureForIntent(intent);
      clock.mockReturnValue(now + 600_000);
      await expect(
        service.verifySubmission(ACCOUNT_ID, intent.intentId, { signature }),
      ).rejects.toBeInstanceOf(PublicTestnetIntentExpiredError);
    } finally {
      clock.mockRestore();
    }
  });

  it('rechecks per-account capacity after concurrent asynchronous intent builds', async () => {
    const { service } = fixture();
    const results = await Promise.allSettled(
      Array.from({ length: 9 }, () => service.createIntent(ACCOUNT_ID, CORRELATION, request())),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(8);
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(PublicTestnetIntentCapacityError);
  });
});
