import { Buffer } from 'node:buffer';

import { parseAccountId } from '../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import type {
  MainnetFinancialActionRecoveryWalletRecord,
  WalletRegistrationRepositoryPort,
} from '../../wallets/application/ports/wallet-registration-repository.port';
import {
  WalletRegistrationService,
  type MainnetFinancialActionRecoveryWallet,
} from '../../wallets/application/wallet-registration.service';
import { parseWalletAddress } from '../../wallets/domain/wallet-identity';
import { parseWalletChallengeId } from '../../wallets/domain/wallet-ownership-proof';
import { loadWalletRegistrationConfig } from '../../wallets/infrastructure/config/wallet-registration.config';
import {
  activeWalletRegistrationKey,
  digestWalletIdentity,
  sealWalletRegistrationValue,
} from '../../wallets/infrastructure/crypto/wallet-registration-crypto';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
  MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE,
  type MainnetFinancialActionFinalityPrerequisiteIssuerClock,
  type ReadMainnetFinancialActionFinalityWalletRequestV2,
} from '../application/ports/mainnet-financial-action-finality-prerequisite-issuer.port';
import {
  DormantMainnetFinancialActionFinalityWalletUnavailableError,
  WalletRegistrationMainnetFinancialActionFinalityWalletReader,
} from './wallet-registration-mainnet-financial-action-finality-wallet.reader';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ACCOUNT_ID = 'abababab-abab-4bab-8bab-abababababab';
const INTENT_ID = 'acacacac-acac-4cac-8cac-acacacacacac';
const WALLET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVM_ADDRESS = parseWalletAddress(ETHEREUM, '0x1111111111111111111111111111111111111111');
const SOLANA_ADDRESS = parseWalletAddress(SOLANA, '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const NOW = '2026-09-07T18:00:00.000Z';
const NOW_MILLISECONDS = Date.parse(NOW);
const DEADLINE = '2026-09-07T18:00:20.000Z';
const SNAPSHOT = '3'.repeat(64);
const DIGEST = '2'.repeat(64);
const MAINNET_REGISTRY = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;

function nullRecord<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function request(
  signal: AbortSignal,
  overrides: Partial<ReadMainnetFinancialActionFinalityWalletRequestV2> = {},
): ReadMainnetFinancialActionFinalityWalletRequestV2 {
  return nullRecord({
    readerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
    use: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_USE,
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    accountId: ACCOUNT_ID,
    intentId: INTENT_ID,
    walletRegistrationId: WALLET_ID,
    networkId: ETHEREUM,
    walletIdentityDigestVersion: 1,
    walletIdentityDigestHex: DIGEST,
    lifecycleRevision: '3',
    lifecycleSnapshotSha256: SNAPSHOT,
    lifecycleStage: 'BROADCAST_OUTCOME_AMBIGUOUS' as const,
    purpose: 'RECONCILIATION_ADMISSION' as const,
    deadlineAt: DEADLINE,
    signal,
    ...overrides,
  });
}

function recoveryWallet(
  overrides: Partial<MainnetFinancialActionRecoveryWallet> = {},
): Readonly<MainnetFinancialActionRecoveryWallet> {
  return Object.freeze({
    mayAuthorizeFinancialAction: false as const,
    mayPersist: false as const,
    accountId: parseAccountId(ACCOUNT_ID),
    intentId: INTENT_ID,
    walletId: WALLET_ID,
    chainId: ETHEREUM,
    address: EVM_ADDRESS,
    lifecycleRevision: '3',
    lifecycleSnapshotSha256: SNAPSHOT,
    lifecycleStage: 'BROADCAST_OUTCOME_AMBIGUOUS' as const,
    walletStatus: 'ACTIVE' as const,
    revokedAt: null,
    verifiedAt: NOW,
    ...overrides,
  });
}

interface Harness {
  readonly reader: WalletRegistrationMainnetFinancialActionFinalityWalletReader;
  readonly readRecoveryWallet: jest.Mock;
}

function harness(
  resolved: unknown = recoveryWallet(),
  now: () => Date = () => new Date(NOW_MILLISECONDS),
): Harness {
  const readRecoveryWallet = jest.fn(async () => resolved);
  const service = Object.freeze({
    readMainnetFinancialActionRecoveryWallet: readRecoveryWallet,
  }) as unknown as WalletRegistrationService;
  const clock = Object.freeze({ now }) as MainnetFinancialActionFinalityPrerequisiteIssuerClock;
  return {
    reader: new WalletRegistrationMainnetFinancialActionFinalityWalletReader(service, clock),
    readRecoveryWallet,
  };
}

async function issued(
  fixture: Harness,
  walletRequest: ReadMainnetFinancialActionFinalityWalletRequestV2,
): Promise<object> {
  const capability = await fixture.reader.readWallet(walletRequest);
  expect(typeof capability).toBe('object');
  expect(capability).not.toBeNull();
  return capability as object;
}

function encodedKey(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

function realMainnetWalletService(): Readonly<{
  service: WalletRegistrationService;
  readRecoveryWallet: jest.MockedFunction<
    WalletRegistrationRepositoryPort['readMainnetFinancialActionRecoveryWallet']
  >;
  addressDigest: MainnetFinancialActionRecoveryWalletRecord['addressDigest'];
}> {
  const loaded = loadWalletRegistrationConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'oidc',
    AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    WALLET_REGISTRATION_MODE: 'enabled',
    WALLET_REGISTRATION_REGISTRY_ENVIRONMENT: 'MAINNET',
    WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS: '300',
    WALLET_IDENTITY_HMAC_KEY_VERSION: '1',
    WALLET_IDENTITY_HMAC_KEY: encodedKey(1),
    WALLET_CHALLENGE_HMAC_KEY_VERSION: '1',
    WALLET_CHALLENGE_HMAC_KEY: encodedKey(2),
    WALLET_METADATA_SEAL_KEY_VERSION: '1',
    WALLET_METADATA_SEAL_KEY: encodedKey(3),
  });
  if (loaded.mode !== 'enabled') throw new Error('enabled wallet fixture expected');
  const accountId = parseAccountId(ACCOUNT_ID);
  const challengeId = parseWalletChallengeId('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  const addressDigest = digestWalletIdentity(
    activeWalletRegistrationKey(loaded.identityHmacKeys),
    ETHEREUM,
    EVM_ADDRESS,
  );
  const record: MainnetFinancialActionRecoveryWalletRecord = {
    accountId,
    intentId: INTENT_ID,
    walletId: WALLET_ID,
    registeredByChallengeId: challengeId,
    chainId: ETHEREUM,
    lifecycleRevision: '2',
    lifecycleSnapshotSha256: SNAPSHOT,
    lifecycleStage: 'WALLET_SIGNED_SUBMISSION_BOUND',
    registry: {
      environment: 'MAINNET',
      version: MAINNET_REGISTRY.version,
      fingerprintSha256: MAINNET_REGISTRY.fingerprintSha256,
    },
    addressDigest,
    verificationAddressDigest: addressDigest,
    encryptedAddress: sealWalletRegistrationValue(
      activeWalletRegistrationKey(loaded.metadataSealKeys),
      {
        field: 'address',
        walletId: WALLET_ID,
        challengeId,
        accountId,
        networkId: ETHEREUM,
        addressDigest,
      },
      EVM_ADDRESS,
    ),
    registeredAt: new Date('2026-09-01T18:00:00.000Z'),
    status: 'REVOKED',
    revokedAt: new Date('2026-09-07T17:59:00.000Z'),
    verifiedAt: new Date(NOW),
  };
  const readRecoveryWallet = jest.fn<
    ReturnType<WalletRegistrationRepositoryPort['readMainnetFinancialActionRecoveryWallet']>,
    Parameters<WalletRegistrationRepositoryPort['readMainnetFinancialActionRecoveryWallet']>
  >(async () => record);
  const repository = {
    readMainnetFinancialActionRecoveryWallet: readRecoveryWallet,
    listActiveWallets: jest.fn(),
    revokeWallet: jest.fn(),
    beginChallenge: jest.fn(),
    prepareChallenge: jest.fn(),
    rejectChallenge: jest.fn(),
    completeRegistration: jest.fn(),
  } as unknown as WalletRegistrationRepositoryPort;
  return Object.freeze({
    service: new WalletRegistrationService(repository, loaded, {
      now: () => new Date(NOW_MILLISECONDS),
    }),
    readRecoveryWallet,
    addressDigest,
  });
}

describe('WalletRegistrationMainnetFinancialActionFinalityWalletReader', () => {
  it('is dormant and makes one exact recovery read with the same signal/deadline', async () => {
    const fixture = harness();
    const controller = new AbortController();
    const walletRequest = request(controller.signal);

    expect(fixture.readRecoveryWallet).not.toHaveBeenCalled();
    const capability = await issued(fixture, walletRequest);

    expect(fixture.readRecoveryWallet).toHaveBeenCalledTimes(1);
    const serviceRequest = fixture.readRecoveryWallet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(serviceRequest).toEqual({
      accountId: ACCOUNT_ID,
      intentId: INTENT_ID,
      lifecycleRevision: '3',
      lifecycleSnapshotSha256: SNAPSHOT,
      purpose: 'RECONCILIATION_ADMISSION',
      deadlineAt: new Date(DEADLINE),
      signal: controller.signal,
    });
    expect(serviceRequest.signal).toBe(controller.signal);
    expect(Object.isFrozen(serviceRequest)).toBe(true);
    expect(fixture.reader.verifyWallet(capability, walletRequest)).toEqual({
      readerVersion: 2,
      use: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      accountId: ACCOUNT_ID,
      intentId: INTENT_ID,
      walletRegistrationId: WALLET_ID,
      networkId: ETHEREUM,
      walletIdentityDigestVersion: 1,
      walletIdentityDigestHex: DIGEST,
      lifecycleRevision: '3',
      lifecycleSnapshotSha256: SNAPSHOT,
      lifecycleStage: 'BROADCAST_OUTCOME_AMBIGUOUS',
      purpose: 'RECONCILIATION_ADMISSION',
      walletStatus: 'ACTIVE',
      revokedAt: null,
      verifiedAt: NOW,
      walletAddress: EVM_ADDRESS,
    });
  });

  it.each([
    [ETHEREUM, EVM_ADDRESS],
    [SOLANA, SOLANA_ADDRESS],
  ] as const)(
    'accepts exact active and revoked %s recovery identities',
    async (networkId, address) => {
      for (const walletStatus of ['ACTIVE', 'REVOKED'] as const) {
        const fixture = harness(
          recoveryWallet({
            chainId: networkId,
            address,
            walletStatus,
            revokedAt: walletStatus === 'REVOKED' ? '2026-09-07T17:59:00.000Z' : null,
          }),
        );
        const walletRequest = request(new AbortController().signal, { networkId });
        const capability = await issued(fixture, walletRequest);
        expect(fixture.reader.verifyWallet(capability, walletRequest)).toMatchObject({
          walletStatus,
          walletAddress: address,
          mayAuthorizeFinancialAction: false,
          mayPersist: false,
        });
      }
    },
  );

  it('composes with the real WalletRegistrationService revoked recovery contract', async () => {
    const composed = realMainnetWalletService();
    const reader = new WalletRegistrationMainnetFinancialActionFinalityWalletReader(
      composed.service,
      Object.freeze({ now: () => new Date(NOW_MILLISECONDS) }),
    );
    const controller = new AbortController();
    const walletRequest = request(controller.signal, {
      lifecycleRevision: '2',
      lifecycleStage: 'WALLET_SIGNED_SUBMISSION_BOUND',
      walletIdentityDigestVersion: composed.addressDigest.version,
      walletIdentityDigestHex: composed.addressDigest.value,
    });

    const capability = await reader.readWallet(walletRequest);
    const result = reader.verifyWallet(capability, walletRequest);

    expect(composed.readRecoveryWallet).toHaveBeenCalledTimes(1);
    expect(composed.readRecoveryWallet.mock.calls[0]?.[0]).toMatchObject({
      accountId: parseAccountId(ACCOUNT_ID),
      intentId: INTENT_ID,
      lifecycleRevision: '2',
      lifecycleSnapshotSha256: SNAPSHOT,
      purpose: 'RECONCILIATION_ADMISSION',
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      accountId: ACCOUNT_ID,
      intentId: INTENT_ID,
      walletRegistrationId: WALLET_ID,
      lifecycleStage: 'WALLET_SIGNED_SUBMISSION_BOUND',
      walletStatus: 'REVOKED',
      revokedAt: '2026-09-07T17:59:00.000Z',
      walletAddress: EVM_ADDRESS,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
    });
  });

  it('keeps plaintext and recovery metadata out of the zero-key opaque capability', async () => {
    const fixture = harness();
    const walletRequest = request(new AbortController().signal);
    const capability = await issued(fixture, walletRequest);

    expect(Object.getPrototypeOf(capability)).toBeNull();
    expect(Object.isFrozen(capability)).toBe(true);
    expect(Reflect.ownKeys(capability)).toEqual([]);
    expect(JSON.stringify(capability)).toBe('{}');
    expect(JSON.stringify(capability)).not.toContain(EVM_ADDRESS);
  });

  it('rejects malformed, cross-bound, mutable, accessor, proxy, and stale recovery results', async () => {
    const base = recoveryWallet();
    const accessor = Object.freeze(
      Object.defineProperty({ ...base }, 'address', {
        enumerable: true,
        configurable: false,
        get: () => EVM_ADDRESS,
      }),
    );
    const invalidResults: unknown[] = [
      { ...base },
      Object.freeze({ ...base, extra: true }),
      accessor,
      new Proxy(base, {}),
      recoveryWallet({ mayAuthorizeFinancialAction: true as never }),
      recoveryWallet({ accountId: parseAccountId(OTHER_ACCOUNT_ID) }),
      recoveryWallet({ intentId: 'adadadad-adad-4dad-8dad-adadadadadad' }),
      recoveryWallet({ walletId: 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc' }),
      recoveryWallet({ chainId: SOLANA, address: SOLANA_ADDRESS }),
      recoveryWallet({ lifecycleRevision: '4' }),
      recoveryWallet({ lifecycleSnapshotSha256: '4'.repeat(64) }),
      recoveryWallet({ lifecycleStage: 'RECONCILIATION_AMBIGUOUS' }),
      recoveryWallet({ walletStatus: 'UNKNOWN' as never, revokedAt: null }),
      recoveryWallet({ walletStatus: 'REVOKED', revokedAt: null }),
      recoveryWallet({
        walletStatus: 'REVOKED',
        revokedAt: '2026-09-07T18:00:01.000Z',
      }),
      recoveryWallet({ verifiedAt: DEADLINE }),
      recoveryWallet({ address: '0x0000000000000000000000000000000000000000' as never }),
    ];

    for (const invalid of invalidResults) {
      const fixture = harness(invalid);
      await expect(
        fixture.reader.readWallet(request(new AbortController().signal)),
      ).rejects.toMatchObject({ code: 'WALLET_UNAVAILABLE' });
      expect(fixture.readRecoveryWallet).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects invalid lifecycle/purpose combinations and non-exact requests before I/O', async () => {
    const fixture = harness();
    const signal = new AbortController().signal;
    const valid = request(signal);
    const accessor = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries(valid)) {
      Object.defineProperty(accessor, key, {
        enumerable: true,
        configurable: false,
        ...(key === 'accountId' ? { get: () => value } : { value, writable: false }),
      });
    }
    Object.freeze(accessor);
    const invalidRequests: unknown[] = [
      { ...valid },
      Object.freeze({ ...valid, extra: true }),
      accessor,
      new Proxy(valid, {}),
      request(signal, { networkId: 'eip155:8453' as never }),
      request(signal, { lifecycleRevision: '1' }),
      request(signal, { lifecycleRevision: '2' }),
      request(signal, { lifecycleStage: 'WALLET_SIGNED_SUBMISSION_BOUND' }),
      request(signal, {
        lifecycleStage: 'FINALIZED_SUCCESS',
        purpose: 'RECONCILIATION_ADMISSION',
      }),
      request(signal, {
        lifecycleStage: 'BROADCAST_OUTCOME_AMBIGUOUS',
        purpose: 'POST_FINALITY_REVIEW',
      }),
      request(signal, { walletIdentityDigestHex: '0'.repeat(64) }),
      request(signal, { deadlineAt: '2026-09-07T18:00:31.000Z' }),
    ];

    for (const invalid of invalidRequests) {
      await expect(
        fixture.reader.readWallet(invalid as ReadMainnetFinancialActionFinalityWalletRequestV2),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(fixture.readRecoveryWallet).not.toHaveBeenCalled();
  });

  it('is one-shot and settles stale after an in-flight cancellation rejection', async () => {
    let rejectRead: ((reason: unknown) => void) | undefined;
    const pending = new Promise<MainnetFinancialActionRecoveryWallet>((_resolve, reject) => {
      rejectRead = reject;
    });
    const readRecoveryWallet = jest.fn(() => pending);
    const service = Object.freeze({
      readMainnetFinancialActionRecoveryWallet: readRecoveryWallet,
    }) as unknown as WalletRegistrationService;
    const reader = new WalletRegistrationMainnetFinancialActionFinalityWalletReader(
      service,
      Object.freeze({ now: () => new Date(NOW_MILLISECONDS) }),
    );
    const controller = new AbortController();
    const walletRequest = request(controller.signal);
    const operation = reader.readWallet(walletRequest);

    controller.abort();
    rejectRead?.(new Error('private cancellation detail'));

    await expect(operation).rejects.toMatchObject({ code: 'STALE_REQUEST' });
    await expect(reader.readWallet(walletRequest)).rejects.toMatchObject({
      code: 'STALE_REQUEST',
    });
    expect(readRecoveryWallet).toHaveBeenCalledTimes(1);
  });

  it('binds capability provenance to the exact instance/request and expires on abort/deadline', async () => {
    const fixture = harness();
    const controller = new AbortController();
    const walletRequest = request(controller.signal);
    const capability = await issued(fixture, walletRequest);
    const clone = nullRecord({ ...walletRequest });
    const other = harness();

    expect(fixture.reader.verifyWallet({ ...capability }, walletRequest)).toBeNull();
    expect(fixture.reader.verifyWallet(new Proxy(capability, {}), walletRequest)).toBeNull();
    expect(fixture.reader.verifyWallet(capability, clone)).toBeNull();
    expect(other.reader.verifyWallet(capability, walletRequest)).toBeNull();
    controller.abort();
    expect(fixture.reader.verifyWallet(capability, walletRequest)).toBeNull();
    expect(fixture.readRecoveryWallet).toHaveBeenCalledTimes(1);

    const times = [NOW_MILLISECONDS, NOW_MILLISECONDS, NOW_MILLISECONDS, Date.parse(DEADLINE)];
    const expiring = harness(
      recoveryWallet(),
      () => new Date(times.shift() ?? Date.parse(DEADLINE)),
    );
    const expiringRequest = request(new AbortController().signal);
    const expiringCapability = await issued(expiring, expiringRequest);
    expect(expiring.reader.verifyWallet(expiringCapability, expiringRequest)).toBeNull();
  });

  it('maps service rejection/non-native promises generically and rejects proxy dependencies', async () => {
    const rejecting = harness();
    rejecting.readRecoveryWallet.mockRejectedValueOnce(new Error(`do not leak ${EVM_ADDRESS}`));
    await expect(
      rejecting.reader.readWallet(request(new AbortController().signal)),
    ).rejects.toEqual(
      new DormantMainnetFinancialActionFinalityWalletUnavailableError('WALLET_UNAVAILABLE'),
    );

    const thenable = Object.freeze({
      readMainnetFinancialActionRecoveryWallet: jest.fn(() => ({ then: () => undefined })),
    }) as unknown as WalletRegistrationService;
    const reader = new WalletRegistrationMainnetFinancialActionFinalityWalletReader(
      thenable,
      Object.freeze({ now: () => new Date(NOW_MILLISECONDS) }),
    );
    await expect(reader.readWallet(request(new AbortController().signal))).rejects.toMatchObject({
      code: 'WALLET_UNAVAILABLE',
    });

    const method = jest.fn(async () => recoveryWallet());
    const proxy = new Proxy(
      { readMainnetFinancialActionRecoveryWallet: method },
      {},
    ) as unknown as WalletRegistrationService;
    expect(
      () =>
        new WalletRegistrationMainnetFinancialActionFinalityWalletReader(
          proxy,
          Object.freeze({ now: () => new Date(NOW_MILLISECONDS) }),
        ),
    ).toThrow(DormantMainnetFinancialActionFinalityWalletUnavailableError);
    expect(method).not.toHaveBeenCalled();
  });
});
