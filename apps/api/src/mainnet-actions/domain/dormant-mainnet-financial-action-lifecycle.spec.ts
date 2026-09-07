import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  createDormantMainnetFinancialActionLifecycleProtocol,
  DormantMainnetFinancialActionLifecycleError,
  type DormantMainnetFinancialActionLifecycleErrorCode,
  type DormantMainnetFinancialActionLifecycleProtocolV1,
  type DormantMainnetFinancialActionLifecycleSnapshotV1,
  type DormantMainnetReconciliationObservationInputV1,
  type DormantMainnetWalletBroadcastObservationInputV1,
  type DormantMainnetWalletSignedSubmissionInputV1,
} from './dormant-mainnet-financial-action-lifecycle';
import type { DormantMainnetFinancialActionIntentInputV1 } from './dormant-mainnet-financial-action';

const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const ETHEREUM_WALLET = '0x1111111111111111111111111111111111111111';
const SOLANA_WALLET = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ETHEREUM_MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const SOLANA_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
const ETHEREUM_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ETHEREUM_TRANSACTION = `0x${'a1'.repeat(32)}`;
const ETHEREUM_BLOCK = `0x${'b2'.repeat(32)}`;
const ETHEREUM_FINALIZED_BLOCK = `0x${'c3'.repeat(32)}`;
const ETHEREUM_NEXT_FINALIZED_BLOCK = `0x${'d4'.repeat(32)}`;
const NOW = new Date('2026-09-06T12:00:00.000Z');
const SIGNED_AT = '2026-09-06T12:00:10.000Z';
const BROADCAST_AT = '2026-09-06T12:00:20.000Z';
const RECONCILED_AT = '2026-09-06T12:00:30.000Z';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(value: Uint8Array): string {
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
  let zeros = 0;
  while (value[zeros] === 0) zeros += 1;
  const significant = digits.length === 1 && digits[0] === 0 ? [] : digits;
  return (
    '1'.repeat(zeros) +
    significant
      .reverse()
      .map((digit) => BASE58_ALPHABET[digit] ?? '')
      .join('')
  );
}

const SOLANA_TRANSACTION = base58(new Uint8Array(64).fill(7));
const SOLANA_BLOCK = base58(new Uint8Array(32).fill(8));
const SOLANA_FINALIZED_BLOCK = base58(new Uint8Array(32).fill(9));

function intent(
  overrides: Partial<DormantMainnetFinancialActionIntentInputV1> = {},
): DormantMainnetFinancialActionIntentInputV1 {
  const networkId = overrides.networkId ?? ETHEREUM;
  const solana = networkId === SOLANA;
  return {
    schemaVersion: 1,
    intentId: '11111111-1111-4111-8111-111111111111',
    accountId: ACCOUNT_ID,
    walletRegistrationId: '33333333-3333-4333-8333-333333333333',
    replayProtectionId: '44444444-4444-4444-8444-444444444444',
    idempotencyKeyDigestSha256: '11'.repeat(32),
    networkId,
    walletAddress: solana ? SOLANA_WALLET : ETHEREUM_WALLET,
    providerId: solana ? 'kamino' : 'aave',
    protocolId: solana ? 'kamino-lend' : 'aave-v3',
    marketId: solana ? SOLANA_MARKET : ETHEREUM_MARKET,
    assetRegistryVersion: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version,
    assetRegistryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    assetSymbol: 'USDC',
    assetIdentity: solana ? SOLANA_USDC : ETHEREUM_USDC,
    action: 'SUPPLY',
    amountAtomic: '1000000',
    requestedValueUsdMicros: '1000000',
    maximumNetworkFeeAtomic: '50000',
    maximumNetworkFeeBasisPoints: 100,
    minimumPostActionNativeBalanceAtomic: '10000',
    allowanceMode: 'EXACT',
    allowanceAmountAtomic: '1000000',
    issuedAt: '2026-09-06T11:59:00.000Z',
    expiresAt: '2026-09-06T12:04:00.000Z',
    ...overrides,
  };
}

function submission(
  prepared: DormantMainnetFinancialActionLifecycleSnapshotV1,
  overrides: Partial<DormantMainnetWalletSignedSubmissionInputV1> = {},
): DormantMainnetWalletSignedSubmissionInputV1 {
  const solana = prepared.intent.networkId === SOLANA;
  return {
    schemaVersion: 1,
    intentId: prepared.intent.intentId,
    intentFingerprintSha256: prepared.intentFingerprintSha256,
    networkId: prepared.intent.networkId,
    signerWalletAccountId: `${prepared.intent.networkId}:${prepared.intent.walletAddress}`,
    transactionId: solana ? SOLANA_TRANSACTION : ETHEREUM_TRANSACTION,
    walletSignedPayloadSha256: '22'.repeat(32),
    walletSignatureEvidenceSha256: '33'.repeat(32),
    signedAt: SIGNED_AT,
    ...overrides,
  };
}

function broadcast(
  bound: DormantMainnetFinancialActionLifecycleSnapshotV1,
  overrides: Partial<DormantMainnetWalletBroadcastObservationInputV1> = {},
): DormantMainnetWalletBroadcastObservationInputV1 {
  return {
    schemaVersion: 1,
    observationId: '55555555-5555-4555-8555-555555555555',
    intentId: bound.intent.intentId,
    submissionFingerprintSha256: bound.submission!.submissionFingerprintSha256,
    networkId: bound.intent.networkId,
    transactionId: bound.submission!.transactionId,
    outcome: 'WALLET_REPORTED_SUBMITTED',
    evidenceSha256: '44'.repeat(32),
    observedAt: BROADCAST_AT,
    ...overrides,
  };
}

function reconciliation(
  broadcasted: DormantMainnetFinancialActionLifecycleSnapshotV1,
  overrides: Partial<DormantMainnetReconciliationObservationInputV1> = {},
): DormantMainnetReconciliationObservationInputV1 {
  const solana = broadcasted.intent.networkId === SOLANA;
  return {
    schemaVersion: 1,
    observationId: '66666666-6666-4666-8666-666666666666',
    intentId: broadcasted.intent.intentId,
    submissionFingerprintSha256: broadcasted.submission!.submissionFingerprintSha256,
    networkId: broadcasted.intent.networkId,
    transactionId: broadcasted.submission!.transactionId,
    outcome: 'PENDING',
    transactionPosition: '101',
    transactionBlockId: solana ? SOLANA_BLOCK : ETHEREUM_BLOCK,
    finalizedPosition: '100',
    finalizedBlockId: solana ? SOLANA_FINALIZED_BLOCK : ETHEREUM_FINALIZED_BLOCK,
    effectEvidenceSha256: null,
    failureEvidenceSha256: null,
    sourceEvidenceSha256: '55'.repeat(32),
    observedAt: RECONCILED_AT,
    ...overrides,
  };
}

function expectCode(
  run: () => unknown,
  code: DormantMainnetFinancialActionLifecycleErrorCode,
): void {
  expect(run).toThrow(new DormantMainnetFinancialActionLifecycleError(code));
}

function preparedAndBound(
  protocol: DormantMainnetFinancialActionLifecycleProtocolV1,
  intentInput: DormantMainnetFinancialActionIntentInputV1 = intent(),
): Readonly<{
  prepared: DormantMainnetFinancialActionLifecycleSnapshotV1;
  bound: DormantMainnetFinancialActionLifecycleSnapshotV1;
  submissionInput: DormantMainnetWalletSignedSubmissionInputV1;
}> {
  const prepared = protocol.prepareIntent(intentInput, NOW);
  const submissionInput = submission(prepared);
  const bound = protocol.bindWalletSignedSubmission(
    submissionInput,
    new Date('2026-09-06T12:00:10.000Z'),
  );
  return Object.freeze({ prepared, bound, submissionInput });
}

describe('dormant mainnet financial-action lifecycle protocol', () => {
  it('records the full Ethereum lifecycle without gaining execution or durability authority', () => {
    const protocol = createDormantMainnetFinancialActionLifecycleProtocol();
    const prepared = protocol.prepareIntent(intent(), NOW);
    expect(prepared).toMatchObject({
      stage: 'PREPARED',
      revision: 1,
      previousSnapshotSha256: null,
      terminal: false,
      authority: {
        operationalMode: 'DORMANT',
        mayAuthorizeFinancialAction: false,
        mayBuildTransaction: false,
        maySignTransaction: false,
        mayBroadcastTransaction: false,
        mayAutomaticallyResubmit: false,
        mayEscalateNetworkFee: false,
        signingResponsibility: 'USER_WALLET_ONLY',
        broadcastResponsibility: 'USER_WALLET_ONLY',
      },
      durability: {
        kind: 'VOLATILE_IN_PROCESS_ONLY',
        durable: false,
        mayClaimReplayProtectionAfterRestart: false,
        persistenceAuthority: false,
      },
      identities: {
        walletAccountId: `${ETHEREUM}:${ETHEREUM_WALLET}`,
        providerMarketId: `${ETHEREUM}:aave:aave-v3:${ETHEREUM_MARKET}`,
        assetId: `${ETHEREUM}:${ETHEREUM_USDC}`,
      },
    });

    const submissionInput = submission(prepared);
    const bound = protocol.bindWalletSignedSubmission(
      submissionInput,
      new Date('2026-09-06T12:00:10.000Z'),
    );
    expect(bound).toMatchObject({
      stage: 'WALLET_SIGNED_SUBMISSION_BOUND',
      revision: 2,
      previousSnapshotSha256: prepared.snapshotSha256,
      submission: {
        source: 'USER_WALLET_REPORT_ONLY',
        chainQualifiedTransactionId: `${ETHEREUM}:${ETHEREUM_TRANSACTION}`,
        cryptographicSignatureVerifiedByThisProtocol: false,
        signedPayloadMatchesIntentVerifiedByThisProtocol: false,
      },
    });

    const broadcastInput = broadcast(bound, { outcome: 'WALLET_REPORTED_REJECTED' });
    const broadcasted = protocol.recordWalletBroadcastObservation(
      broadcastInput,
      new Date(BROADCAST_AT),
    );
    expect(broadcasted).toMatchObject({
      stage: 'BROADCAST_OUTCOME_AMBIGUOUS',
      revision: 3,
      previousSnapshotSha256: bound.snapshotSha256,
      terminal: false,
      broadcastObservation: {
        outcome: 'WALLET_REPORTED_REJECTED',
        broadcastAttemptConsumed: true,
        onchainAcceptanceVerifiedByThisProtocol: false,
      },
    });

    const pendingInput = reconciliation(broadcasted);
    const pending = protocol.recordReconciliationObservation(pendingInput, new Date(RECONCILED_AT));
    const unknown = protocol.recordReconciliationObservation(
      reconciliation(broadcasted, {
        observationId: '77777777-7777-4777-8777-777777777777',
        outcome: 'UNKNOWN',
        transactionPosition: null,
        transactionBlockId: null,
        sourceEvidenceSha256: '66'.repeat(32),
        observedAt: '2026-09-06T12:00:40.000Z',
      }),
      new Date('2026-09-06T12:00:40.000Z'),
    );
    const finalized = protocol.recordReconciliationObservation(
      reconciliation(broadcasted, {
        observationId: '88888888-8888-4888-8888-888888888888',
        outcome: 'FINALIZED_SUCCESS',
        finalizedPosition: '101',
        finalizedBlockId: ETHEREUM_NEXT_FINALIZED_BLOCK,
        effectEvidenceSha256: '77'.repeat(32),
        sourceEvidenceSha256: '88'.repeat(32),
        observedAt: '2026-09-06T12:00:50.000Z',
      }),
      new Date('2026-09-06T12:00:50.000Z'),
    );

    expect(pending.stage).toBe('RECONCILIATION_AMBIGUOUS');
    expect(unknown).toMatchObject({
      stage: 'RECONCILIATION_AMBIGUOUS',
      revision: 5,
      previousSnapshotSha256: pending.snapshotSha256,
    });
    expect(finalized).toMatchObject({
      stage: 'FINALIZED_SUCCESS',
      revision: 6,
      previousSnapshotSha256: unknown.snapshotSha256,
      terminal: true,
      requiresManualReconciliation: false,
      reconciliation: {
        source: 'CALLER_SUPPLIED_READ_ONLY_CHAIN_EVIDENCE',
        independentlyReadByThisProtocol: false,
        effectEvidenceSha256: '77'.repeat(32),
      },
    });
    expect(protocol.readSnapshot(prepared.intent.intentId)).toBe(finalized);
    expect(protocol.prepareIntent(intent(), NOW)).toBe(finalized);
    expect(
      protocol.bindWalletSignedSubmission(
        { ...submissionInput },
        new Date('2026-09-06T12:10:00.000Z'),
      ),
    ).toBe(finalized);
    expect(
      protocol.recordWalletBroadcastObservation(
        { ...broadcastInput },
        new Date('2026-09-06T12:10:00.000Z'),
      ),
    ).toBe(finalized);
    expect(
      protocol.recordReconciliationObservation(
        { ...pendingInput },
        new Date('2026-09-06T12:10:00.000Z'),
      ),
    ).toBe(finalized);
    for (const snapshot of [prepared, bound, broadcasted, pending, unknown, finalized]) {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.authority)).toBe(true);
      expect(snapshot.snapshotSha256).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('requires canonical Solana-mainnet identities and a 64-byte transaction signature', () => {
    const protocol = createDormantMainnetFinancialActionLifecycleProtocol();
    const prepared = protocol.prepareIntent(intent({ networkId: SOLANA }), NOW);
    const validSubmission = submission(prepared);
    const bound = protocol.bindWalletSignedSubmission(
      validSubmission,
      new Date('2026-09-06T12:00:10.000Z'),
    );
    expect(bound).toMatchObject({
      identities: {
        walletAccountId: `${SOLANA}:${SOLANA_WALLET}`,
        providerMarketId: `${SOLANA}:kamino:kamino-lend:${SOLANA_MARKET}`,
        assetId: `${SOLANA}:${SOLANA_USDC}`,
      },
      submission: {
        transactionId: SOLANA_TRANSACTION,
        chainQualifiedTransactionId: `${SOLANA}:${SOLANA_TRANSACTION}`,
      },
    });

    const broadcasted = protocol.recordWalletBroadcastObservation(
      broadcast(bound),
      new Date(BROADCAST_AT),
    );
    const finalized = protocol.recordReconciliationObservation(
      reconciliation(broadcasted, {
        outcome: 'FINALIZED_SUCCESS',
        finalizedPosition: '101',
        effectEvidenceSha256: '66'.repeat(32),
      }),
      new Date(RECONCILED_AT),
    );
    expect(finalized.stage).toBe('FINALIZED_SUCCESS');

    const second = createDormantMainnetFinancialActionLifecycleProtocol();
    const secondPrepared = second.prepareIntent(intent({ networkId: SOLANA }), NOW);
    expectCode(
      () =>
        second.bindWalletSignedSubmission(
          submission(secondPrepared, { transactionId: base58(new Uint8Array(32).fill(7)) }),
          new Date(SIGNED_AT),
        ),
      'INVALID_SUBMISSION_INPUT',
    );
    expectCode(
      () =>
        second.bindWalletSignedSubmission(
          submission(secondPrepared, { networkId: ETHEREUM, transactionId: ETHEREUM_TRANSACTION }),
          new Date(SIGNED_AT),
        ),
      'INVALID_SUBMISSION_INPUT',
    );
  });

  it('enforces intent idempotency, request fingerprints, and transaction ownership', () => {
    const protocol = createDormantMainnetFinancialActionLifecycleProtocol();
    const original = intent();
    const prepared = protocol.prepareIntent(original, NOW);
    expect(protocol.prepareIntent({ ...original }, NOW)).toBe(prepared);

    expectCode(
      () =>
        protocol.prepareIntent(
          { ...original, amountAtomic: '2000000', allowanceAmountAtomic: '2000000' },
          NOW,
        ),
      'INTENT_CONFLICT',
    );
    expectCode(
      () =>
        protocol.prepareIntent(
          intent({
            intentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            walletRegistrationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            replayProtectionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            amountAtomic: '2000000',
            allowanceAmountAtomic: '2000000',
          }),
          NOW,
        ),
      'IDEMPOTENCY_REPLAY_CONFLICT',
    );

    expectCode(
      () =>
        protocol.prepareIntent(
          intent({
            intentId: '55555555-5555-4555-8555-555555555555',
            walletRegistrationId: '66666666-6666-4666-8666-666666666666',
            replayProtectionId: original.replayProtectionId,
            idempotencyKeyDigestSha256: 'bb'.repeat(32),
          }),
          NOW,
        ),
      'REPLAY_PROTECTION_CONFLICT',
    );
    expect(
      protocol.prepareIntent(
        intent({
          intentId: '77777777-7777-4777-8777-777777777777',
          accountId: '88888888-8888-4888-8888-888888888888',
          walletRegistrationId: '99999999-9999-4999-8999-999999999999',
          replayProtectionId: original.replayProtectionId,
          idempotencyKeyDigestSha256: 'cc'.repeat(32),
        }),
        NOW,
      ).stage,
    ).toBe('PREPARED');

    const firstSubmission = submission(prepared);
    const bound = protocol.bindWalletSignedSubmission(firstSubmission, new Date(SIGNED_AT));
    const broadcastInput = broadcast(bound);
    const broadcasted = protocol.recordWalletBroadcastObservation(
      broadcastInput,
      new Date(BROADCAST_AT),
    );
    expect(
      protocol.bindWalletSignedSubmission(
        { ...firstSubmission },
        new Date('2026-09-06T12:10:00.000Z'),
      ),
    ).toBe(broadcasted);
    expectCode(
      () =>
        protocol.bindWalletSignedSubmission(
          { ...firstSubmission, walletSignedPayloadSha256: '99'.repeat(32) },
          new Date(SIGNED_AT),
        ),
      'IDEMPOTENCY_REPLAY_CONFLICT',
    );

    const secondIntent = intent({
      intentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      walletRegistrationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      replayProtectionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      idempotencyKeyDigestSha256: 'aa'.repeat(32),
    });
    const secondPrepared = protocol.prepareIntent(secondIntent, NOW);
    expectCode(
      () =>
        protocol.bindWalletSignedSubmission(
          submission(secondPrepared, { transactionId: ETHEREUM_TRANSACTION }),
          new Date(SIGNED_AT),
        ),
      'TRANSACTION_IDENTITY_CONFLICT',
    );
  });

  it('consumes exactly one wallet broadcast report and replays only its exact value', () => {
    const protocol = createDormantMainnetFinancialActionLifecycleProtocol();
    const { bound } = preparedAndBound(protocol);
    const first = broadcast(bound);
    const observed = protocol.recordWalletBroadcastObservation(first, new Date(BROADCAST_AT));
    expect(
      protocol.recordWalletBroadcastObservation({ ...first }, new Date('2026-09-06T12:10:00.000Z')),
    ).toBe(observed);
    expectCode(
      () =>
        protocol.recordWalletBroadcastObservation(
          {
            ...first,
            observationId: '99999999-9999-4999-8999-999999999999',
            outcome: 'WALLET_REPORTED_AMBIGUOUS',
          },
          new Date(BROADCAST_AT),
        ),
      'ONE_SHOT_BROADCAST_ALREADY_RECORDED',
    );
    expect(observed.authority.mayAutomaticallyResubmit).toBe(false);
    expect(observed.broadcastObservation?.broadcastAttemptConsumed).toBe(true);
  });

  it('rejects signing or first broadcast at exclusive intent expiry', () => {
    const protocol = createDormantMainnetFinancialActionLifecycleProtocol();
    const prepared = protocol.prepareIntent(intent(), NOW);
    let dateProxyTrapInvoked = false;
    const hostileDateProxy = new Proxy(NOW, {
      getPrototypeOf: () => {
        dateProxyTrapInvoked = true;
        throw new Error('hostile date proxy');
      },
    });
    expectCode(
      () => protocol.bindWalletSignedSubmission(submission(prepared), hostileDateProxy),
      'INVALID_SERVER_TIME',
    );
    expect(dateProxyTrapInvoked).toBe(false);
    expectCode(
      () =>
        protocol.bindWalletSignedSubmission(
          submission(prepared, { signedAt: prepared.intent.expiresAt }),
          new Date(prepared.intent.expiresAt),
        ),
      'INTENT_EXPIRED',
    );

    const second = createDormantMainnetFinancialActionLifecycleProtocol();
    const { bound } = preparedAndBound(second);
    expectCode(
      () =>
        second.recordWalletBroadcastObservation(
          broadcast(bound, { observedAt: bound.intent.expiresAt }),
          new Date(bound.intent.expiresAt),
        ),
      'INVALID_BROADCAST_OBSERVATION_INPUT',
    );
  });

  it('quarantines a matching reorg and rejects anchor regression, substitution, and post-terminal change', () => {
    const protocol = createDormantMainnetFinancialActionLifecycleProtocol();
    const { bound } = preparedAndBound(protocol);
    const broadcasted = protocol.recordWalletBroadcastObservation(
      broadcast(bound),
      new Date(BROADCAST_AT),
    );
    protocol.recordReconciliationObservation(reconciliation(broadcasted), new Date(RECONCILED_AT));
    expectCode(
      () =>
        protocol.recordReconciliationObservation(
          reconciliation(broadcasted, {
            observationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            sourceEvidenceSha256: 'ab'.repeat(32),
            observedAt: '2026-09-06T12:00:29.999Z',
          }),
          new Date('2026-09-06T12:00:40.000Z'),
        ),
      'NON_MONOTONIC_RECONCILIATION',
    );
    expectCode(
      () =>
        protocol.recordReconciliationObservation(
          reconciliation(broadcasted, {
            observationId: '77777777-7777-4777-8777-777777777777',
            finalizedPosition: '99',
            sourceEvidenceSha256: '66'.repeat(32),
          }),
          new Date(RECONCILED_AT),
        ),
      'NON_MONOTONIC_RECONCILIATION',
    );
    expectCode(
      () =>
        protocol.recordReconciliationObservation(
          reconciliation(broadcasted, {
            observationId: '77777777-7777-4777-8777-777777777777',
            transactionBlockId: `0x${'ef'.repeat(32)}`,
            sourceEvidenceSha256: '66'.repeat(32),
          }),
          new Date(RECONCILED_AT),
        ),
      'NON_MONOTONIC_RECONCILIATION',
    );

    const reorgInput = reconciliation(broadcasted, {
      observationId: '88888888-8888-4888-8888-888888888888',
      outcome: 'REORGED_OUT',
      finalizedPosition: '101',
      finalizedBlockId: ETHEREUM_NEXT_FINALIZED_BLOCK,
      sourceEvidenceSha256: '77'.repeat(32),
      observedAt: '2026-09-06T12:00:40.000Z',
    });
    const quarantined = protocol.recordReconciliationObservation(
      reorgInput,
      new Date('2026-09-06T12:00:40.000Z'),
    );
    expect(quarantined).toMatchObject({
      stage: 'REORG_QUARANTINED',
      terminal: true,
      requiresManualReconciliation: true,
      authority: { mayAutomaticallyResubmit: false },
    });
    expect(
      protocol.recordReconciliationObservation(
        { ...reorgInput },
        new Date('2026-09-06T12:00:40.000Z'),
      ),
    ).toBe(quarantined);
    expectCode(
      () =>
        protocol.recordReconciliationObservation(
          reconciliation(broadcasted, {
            observationId: '99999999-9999-4999-8999-999999999999',
            outcome: 'UNKNOWN',
            transactionPosition: null,
            transactionBlockId: null,
            finalizedPosition: '102',
            finalizedBlockId: `0x${'ef'.repeat(32)}`,
            sourceEvidenceSha256: '88'.repeat(32),
          }),
          new Date(RECONCILED_AT),
        ),
      'TERMINAL_RECONCILIATION',
    );
  });

  it('requires outcome-shaped finality evidence and treats finalized failure as terminal', () => {
    const protocol = createDormantMainnetFinancialActionLifecycleProtocol();
    const { bound } = preparedAndBound(protocol);
    const broadcasted = protocol.recordWalletBroadcastObservation(
      broadcast(bound),
      new Date(BROADCAST_AT),
    );
    expectCode(
      () =>
        protocol.recordReconciliationObservation(
          reconciliation(broadcasted, {
            outcome: 'FINALIZED_SUCCESS',
            finalizedPosition: '101',
            effectEvidenceSha256: null,
          }),
          new Date(RECONCILED_AT),
        ),
      'INVALID_RECONCILIATION_OBSERVATION_INPUT',
    );
    expectCode(
      () =>
        protocol.recordReconciliationObservation(
          reconciliation(broadcasted, {
            outcome: 'PENDING',
            finalizedPosition: '101',
          }),
          new Date(RECONCILED_AT),
        ),
      'INVALID_RECONCILIATION_OBSERVATION_INPUT',
    );
    const failed = protocol.recordReconciliationObservation(
      reconciliation(broadcasted, {
        outcome: 'FINALIZED_FAILURE',
        finalizedPosition: '101',
        failureEvidenceSha256: '66'.repeat(32),
      }),
      new Date(RECONCILED_AT),
    );
    expect(failed).toMatchObject({
      stage: 'FINALIZED_FAILURE',
      terminal: true,
      reconciliation: { failureEvidenceSha256: '66'.repeat(32) },
    });
  });

  it('rejects forged shape, accessors, proxies, wrong context, and reused evidence roles', () => {
    const protocol = createDormantMainnetFinancialActionLifecycleProtocol();
    const { prepared, bound } = preparedAndBound(protocol);
    expectCode(
      () =>
        protocol.bindWalletSignedSubmission(
          { ...submission(prepared), extra: true },
          new Date(SIGNED_AT),
        ),
      'INVALID_SUBMISSION_INPUT',
    );

    let getterInvoked = false;
    const accessor = { ...broadcast(bound) } as Record<string, unknown>;
    Object.defineProperty(accessor, 'outcome', {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return 'WALLET_REPORTED_SUBMITTED';
      },
    });
    expectCode(
      () => protocol.recordWalletBroadcastObservation(accessor, new Date(BROADCAST_AT)),
      'INVALID_BROADCAST_OBSERVATION_INPUT',
    );
    expect(getterInvoked).toBe(false);
    expectCode(
      () =>
        protocol.recordWalletBroadcastObservation(
          new Proxy(broadcast(bound), {}),
          new Date(BROADCAST_AT),
        ),
      'INVALID_BROADCAST_OBSERVATION_INPUT',
    );
    expectCode(
      () =>
        protocol.recordWalletBroadcastObservation(
          broadcast(bound, { networkId: SOLANA, transactionId: SOLANA_TRANSACTION }),
          new Date(BROADCAST_AT),
        ),
      'INVALID_BROADCAST_OBSERVATION_INPUT',
    );
    expectCode(
      () =>
        protocol.recordWalletBroadcastObservation(
          broadcast(bound, { evidenceSha256: bound.submission!.walletSignedPayloadSha256 }),
          new Date(BROADCAST_AT),
        ),
      'INVALID_BROADCAST_OBSERVATION_INPUT',
    );
  });

  it('claims evidence digests globally by role and exact observation fingerprint', () => {
    const protocol = createDormantMainnetFinancialActionLifecycleProtocol();
    const { bound } = preparedAndBound(protocol);
    const broadcasted = protocol.recordWalletBroadcastObservation(
      broadcast(bound),
      new Date(BROADCAST_AT),
    );

    for (const sourceEvidenceSha256 of [
      bound.submission!.walletSignedPayloadSha256,
      bound.submission!.walletSignatureEvidenceSha256,
      broadcasted.broadcastObservation!.evidenceSha256,
    ]) {
      expectCode(
        () =>
          protocol.recordReconciliationObservation(
            reconciliation(broadcasted, { sourceEvidenceSha256 }),
            new Date(RECONCILED_AT),
          ),
        'EVIDENCE_DIGEST_CONFLICT',
      );
    }

    const pendingInput = reconciliation(broadcasted);
    const pending = protocol.recordReconciliationObservation(pendingInput, new Date(RECONCILED_AT));
    expect(
      protocol.recordReconciliationObservation(
        { ...pendingInput },
        new Date('2026-09-06T12:00:40.000Z'),
      ),
    ).toBe(pending);
    expectCode(
      () =>
        protocol.recordReconciliationObservation(
          reconciliation(broadcasted, {
            observationId: '77777777-7777-4777-8777-777777777777',
            outcome: 'UNKNOWN',
            transactionPosition: null,
            transactionBlockId: null,
            sourceEvidenceSha256: pendingInput.sourceEvidenceSha256,
            observedAt: '2026-09-06T12:00:40.000Z',
          }),
          new Date('2026-09-06T12:00:40.000Z'),
        ),
      'EVIDENCE_DIGEST_CONFLICT',
    );
    expectCode(
      () =>
        protocol.recordReconciliationObservation(
          reconciliation(broadcasted, {
            observationId: '88888888-8888-4888-8888-888888888888',
            outcome: 'FINALIZED_SUCCESS',
            finalizedPosition: '101',
            finalizedBlockId: ETHEREUM_NEXT_FINALIZED_BLOCK,
            effectEvidenceSha256: broadcasted.broadcastObservation!.evidenceSha256,
            sourceEvidenceSha256: '66'.repeat(32),
            observedAt: '2026-09-06T12:00:50.000Z',
          }),
          new Date('2026-09-06T12:00:50.000Z'),
        ),
      'EVIDENCE_DIGEST_CONFLICT',
    );

    const secondPrepared = protocol.prepareIntent(
      intent({
        intentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        walletRegistrationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        replayProtectionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        idempotencyKeyDigestSha256: 'aa'.repeat(32),
      }),
      NOW,
    );
    expectCode(
      () =>
        protocol.bindWalletSignedSubmission(
          submission(secondPrepared, { transactionId: `0x${'ef'.repeat(32)}` }),
          new Date(SIGNED_AT),
        ),
      'EVIDENCE_DIGEST_CONFLICT',
    );
  });

  it('exposes only a dormant recorder and contains no runtime I/O or transaction payload surface', () => {
    const protocol = createDormantMainnetFinancialActionLifecycleProtocol();
    expect(Object.keys(protocol).sort()).toEqual([
      'bindWalletSignedSubmission',
      'executionAuthority',
      'operationalMode',
      'persistenceAuthority',
      'prepareIntent',
      'readSnapshot',
      'recordReconciliationObservation',
      'recordWalletBroadcastObservation',
      'schemaVersion',
    ]);
    expect(protocol).toMatchObject({
      operationalMode: 'DORMANT',
      executionAuthority: false,
      persistenceAuthority: false,
    });
    expect(Object.isFrozen(protocol)).toBe(true);

    const source = readFileSync(
      join(__dirname, 'dormant-mainnet-financial-action-lifecycle.ts'),
      'utf8',
    );
    for (const forbidden of [
      '@Injectable',
      'fetch(',
      '.request(',
      'signedTransactionBase64',
      'serializedTransaction',
      'privateKey',
      'secretKey',
      'async ',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
