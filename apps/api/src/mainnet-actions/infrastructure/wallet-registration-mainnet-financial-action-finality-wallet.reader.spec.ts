import { Buffer } from 'node:buffer';

import { parseAccountId } from '../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import type {
  ActiveWalletRegistrationRecord,
  WalletRegistrationRepositoryPort,
} from '../../wallets/application/ports/wallet-registration-repository.port';
import {
  WalletRegistrationService,
  type ActiveRegisteredWallet,
  type ActiveWalletRoster,
} from '../../wallets/application/wallet-registration.service';
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
  type ReadMainnetFinancialActionFinalityWalletRequestV1,
} from '../application/ports/mainnet-financial-action-finality-prerequisite-issuer.port';
import {
  DormantMainnetFinancialActionFinalityWalletUnavailableError,
  WalletRegistrationMainnetFinancialActionFinalityWalletReader,
} from './wallet-registration-mainnet-financial-action-finality-wallet.reader';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ACCOUNT_ID = 'abababab-abab-4bab-8bab-abababababab';
const WALLET_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_WALLET_ID = 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc';
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111';
const SOLANA_ADDRESS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const NOW_MILLISECONDS = Date.parse('2026-09-07T18:00:00.000Z');
const DEADLINE = '2026-09-07T18:00:20.000Z';
const MAINNET_REGISTRY = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;

function nullRecord<T extends object>(members: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, members));
}

function wallet(overrides: Partial<ActiveRegisteredWallet> = {}): Readonly<ActiveRegisteredWallet> {
  return Object.freeze({
    walletId: WALLET_ID,
    chainId: ETHEREUM,
    address: EVM_ADDRESS,
    registeredAt: '2026-09-01T18:00:00.000Z',
    registryEnvironment: 'MAINNET',
    registryVersion: MAINNET_REGISTRY.version,
    registryFingerprintSha256: MAINNET_REGISTRY.fingerprintSha256,
    ...overrides,
  });
}

function roster(wallets: readonly ActiveRegisteredWallet[]): Readonly<ActiveWalletRoster> {
  return Object.freeze({ version: 1, wallets: Object.freeze([...wallets]) });
}

function request(
  signal: AbortSignal,
  overrides: Partial<ReadMainnetFinancialActionFinalityWalletRequestV1> = {},
): ReadMainnetFinancialActionFinalityWalletRequestV1 {
  return nullRecord({
    readerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
    use: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READ_USE,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    accountId: ACCOUNT_ID,
    walletRegistrationId: WALLET_ID,
    networkId: ETHEREUM,
    walletIdentityDigestVersion: 1,
    walletIdentityDigestHex: '2'.repeat(64),
    deadlineAt: DEADLINE,
    signal,
    ...overrides,
  });
}

interface Harness {
  readonly reader: WalletRegistrationMainnetFinancialActionFinalityWalletReader;
  readonly listActiveWallets: jest.Mock;
  readonly clockNow: jest.Mock;
}

function harness(
  activeRoster: Readonly<ActiveWalletRoster> = roster([wallet()]),
  now: () => Date = () => new Date(NOW_MILLISECONDS),
): Harness {
  const listActiveWallets = jest.fn(async () => activeRoster);
  const service = Object.freeze({ listActiveWallets }) as unknown as WalletRegistrationService;
  const clockNow = jest.fn(now);
  const clock = Object.freeze({
    now: clockNow,
  }) as MainnetFinancialActionFinalityPrerequisiteIssuerClock;
  return {
    reader: new WalletRegistrationMainnetFinancialActionFinalityWalletReader(service, clock),
    listActiveWallets,
    clockNow,
  };
}

function encodedKey(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

function realMainnetWalletService(): Readonly<{
  service: WalletRegistrationService;
  listActiveWallets: jest.MockedFunction<WalletRegistrationRepositoryPort['listActiveWallets']>;
  addressDigest: ActiveWalletRegistrationRecord['addressDigest'];
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
  const record: ActiveWalletRegistrationRecord = {
    walletId: WALLET_ID,
    accountId,
    registeredByChallengeId: challengeId,
    chainId: ETHEREUM,
    registry: {
      environment: MAINNET_REGISTRY.environment,
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
  };
  const listActiveWallets = jest.fn<
    ReturnType<WalletRegistrationRepositoryPort['listActiveWallets']>,
    Parameters<WalletRegistrationRepositoryPort['listActiveWallets']>
  >(async () => Object.freeze([record]));
  const repository = {
    listActiveWallets,
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
    listActiveWallets,
    addressDigest,
  });
}

async function issued(
  fixture: Harness,
  walletRequest: ReadMainnetFinancialActionFinalityWalletRequestV1,
): Promise<object> {
  const capability = await fixture.reader.readWallet(walletRequest);
  expect(typeof capability).toBe('object');
  expect(capability).not.toBeNull();
  return capability as object;
}

describe('WalletRegistrationMainnetFinancialActionFinalityWalletReader', () => {
  it('is dormant at construction and resolves one active Ethereum wallet with the exact signal', async () => {
    const fixture = harness();
    const controller = new AbortController();
    const walletRequest = request(controller.signal);

    expect(fixture.listActiveWallets).not.toHaveBeenCalled();
    const capability = await issued(fixture, walletRequest);

    expect(fixture.listActiveWallets).toHaveBeenCalledTimes(1);
    expect(fixture.listActiveWallets).toHaveBeenCalledWith(ACCOUNT_ID, {
      signal: controller.signal,
    });
    expect(fixture.listActiveWallets.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    expect(fixture.reader.verifyWallet(capability, walletRequest)).toEqual({
      readerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_READER_VERSION,
      use: MAINNET_FINANCIAL_ACTION_FINALITY_WALLET_RESULT_USE,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      accountId: ACCOUNT_ID,
      walletRegistrationId: WALLET_ID,
      networkId: ETHEREUM,
      walletIdentityDigestVersion: 1,
      walletIdentityDigestHex: '2'.repeat(64),
      walletAddress: EVM_ADDRESS,
    });
  });

  it('resolves one active Solana wallet without changing the network identity', async () => {
    const fixture = harness(roster([wallet({ chainId: SOLANA, address: SOLANA_ADDRESS })]));
    const controller = new AbortController();
    const walletRequest = request(controller.signal, { networkId: SOLANA });

    const capability = await issued(fixture, walletRequest);

    expect(fixture.reader.verifyWallet(capability, walletRequest)?.walletAddress).toBe(
      SOLANA_ADDRESS,
    );
  });

  it('composes with the real WalletRegistrationService frozen roster contract', async () => {
    const composed = realMainnetWalletService();
    const clock = Object.freeze({ now: () => new Date(NOW_MILLISECONDS) });
    const reader = new WalletRegistrationMainnetFinancialActionFinalityWalletReader(
      composed.service,
      clock,
    );
    const controller = new AbortController();
    const walletRequest = request(controller.signal, {
      walletIdentityDigestVersion: composed.addressDigest.version,
      walletIdentityDigestHex: composed.addressDigest.value,
    });

    const capability = await reader.readWallet(walletRequest);
    const result = reader.verifyWallet(capability, walletRequest);

    expect(composed.listActiveWallets).toHaveBeenCalledTimes(1);
    expect(composed.listActiveWallets).toHaveBeenCalledWith({
      accountId: parseAccountId(ACCOUNT_ID),
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      accountId: ACCOUNT_ID,
      walletRegistrationId: WALLET_ID,
      networkId: ETHEREUM,
      walletIdentityDigestVersion: composed.addressDigest.version,
      walletIdentityDigestHex: composed.addressDigest.value,
      walletAddress: EVM_ADDRESS,
    });
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('keeps wallet plaintext out of the opaque capability', async () => {
    const fixture = harness();
    const walletRequest = request(new AbortController().signal);
    const capability = await issued(fixture, walletRequest);

    expect(Object.getPrototypeOf(capability)).toBeNull();
    expect(Object.isFrozen(capability)).toBe(true);
    expect(Reflect.ownKeys(capability)).toEqual([]);
    expect(JSON.stringify(capability)).toBe('{}');
    expect(JSON.stringify(capability)).not.toContain(EVM_ADDRESS);
  });

  it.each([
    ['absent', roster([])],
    ['different wallet', roster([wallet({ walletId: OTHER_WALLET_ID })])],
    ['different network', roster([wallet({ chainId: SOLANA, address: SOLANA_ADDRESS })])],
    ['duplicate match', roster([wallet(), wallet({ registeredAt: '2026-09-02T18:00:00.000Z' })])],
  ])('fails closed for an %s active roster result', async (_label, activeRoster) => {
    const fixture = harness(activeRoster);

    await expect(
      fixture.reader.readWallet(request(new AbortController().signal)),
    ).rejects.toMatchObject({ code: 'WALLET_UNAVAILABLE' });
    expect(fixture.listActiveWallets).toHaveBeenCalledTimes(1);
  });

  it('passes the exact account to the account-scoped service read', async () => {
    const fixture = harness();
    const walletRequest = request(new AbortController().signal, {
      accountId: OTHER_ACCOUNT_ID,
    });

    await issued(fixture, walletRequest);

    expect(fixture.listActiveWallets).toHaveBeenCalledWith(OTHER_ACCOUNT_ID, expect.any(Object));
  });

  it('rejects non-mainnet, malformed, mutable, accessor, and overlong-deadline requests before I/O', async () => {
    const fixture = harness();
    const signal = new AbortController().signal;
    const valid = request(signal);
    const mutable = { ...valid } as ReadMainnetFinancialActionFinalityWalletRequestV1;
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
      mutable,
      request(signal, { networkId: 'eip155:8453' as never }),
      request(signal, { walletIdentityDigestHex: '0'.repeat(64) }),
      request(signal, { walletIdentityDigestVersion: 0 }),
      request(signal, { deadlineAt: '2026-09-07T18:00:31.000Z' }),
      accessor,
      new Proxy(valid, {}),
    ];

    for (const invalid of invalidRequests) {
      await expect(
        fixture.reader.readWallet(invalid as ReadMainnetFinancialActionFinalityWalletRequestV1),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(fixture.listActiveWallets).not.toHaveBeenCalled();
  });

  it('rejects an already-aborted signal and exact-request replay before starting another read', async () => {
    const abortedController = new AbortController();
    abortedController.abort();
    const fixture = harness();
    await expect(
      fixture.reader.readWallet(request(abortedController.signal)),
    ).rejects.toMatchObject({ code: 'STALE_REQUEST' });
    expect(fixture.listActiveWallets).not.toHaveBeenCalled();

    const walletRequest = request(new AbortController().signal);
    await issued(fixture, walletRequest);
    await expect(fixture.reader.readWallet(walletRequest)).rejects.toMatchObject({
      code: 'STALE_REQUEST',
    });
    expect(fixture.listActiveWallets).toHaveBeenCalledTimes(1);
  });

  it('fails stale when the exact signal aborts while the roster read is pending', async () => {
    let resolveRoster: ((value: Readonly<ActiveWalletRoster>) => void) | undefined;
    const pendingRoster = new Promise<Readonly<ActiveWalletRoster>>((resolve) => {
      resolveRoster = resolve;
    });
    const listActiveWallets = jest.fn(() => pendingRoster);
    const service = Object.freeze({ listActiveWallets }) as unknown as WalletRegistrationService;
    const clock = Object.freeze({ now: () => new Date(NOW_MILLISECONDS) });
    const reader = new WalletRegistrationMainnetFinancialActionFinalityWalletReader(service, clock);
    const controller = new AbortController();
    const operation = reader.readWallet(request(controller.signal));

    controller.abort();
    resolveRoster?.(roster([wallet()]));

    await expect(operation).rejects.toMatchObject({ code: 'STALE_REQUEST' });
    expect(listActiveWallets).toHaveBeenCalledTimes(1);
  });

  it('settles stale when an aborted pending roster read rejects', async () => {
    let rejectRoster: ((reason: unknown) => void) | undefined;
    const pendingRoster = new Promise<Readonly<ActiveWalletRoster>>((_resolve, reject) => {
      rejectRoster = reject;
    });
    const listActiveWallets = jest.fn(() => pendingRoster);
    const service = Object.freeze({ listActiveWallets }) as unknown as WalletRegistrationService;
    const reader = new WalletRegistrationMainnetFinancialActionFinalityWalletReader(
      service,
      Object.freeze({ now: () => new Date(NOW_MILLISECONDS) }),
    );
    const controller = new AbortController();
    const operation = reader.readWallet(request(controller.signal));

    controller.abort();
    rejectRoster?.(new Error('private cancellation detail'));

    await expect(operation).rejects.toMatchObject({ code: 'STALE_REQUEST' });
    expect(listActiveWallets).toHaveBeenCalledTimes(1);
  });

  it('fails stale when the deadline is reached during or immediately after the roster read', async () => {
    const times = [NOW_MILLISECONDS, Date.parse(DEADLINE), Date.parse(DEADLINE)];
    const fixture = harness(
      roster([wallet()]),
      () => new Date(times.shift() ?? Date.parse(DEADLINE)),
    );

    await expect(
      fixture.reader.readWallet(request(new AbortController().signal)),
    ).rejects.toMatchObject({ code: 'STALE_REQUEST' });
    expect(fixture.listActiveWallets).toHaveBeenCalledTimes(1);
  });

  it('maps service rejection and non-native promises to a generic wallet-unavailable failure', async () => {
    const rejecting = harness();
    rejecting.listActiveWallets.mockRejectedValueOnce(new Error(`do not leak ${EVM_ADDRESS}`));
    await expect(
      rejecting.reader.readWallet(request(new AbortController().signal)),
    ).rejects.toEqual(
      new DormantMainnetFinancialActionFinalityWalletUnavailableError('WALLET_UNAVAILABLE'),
    );

    const thenable = Object.freeze({
      listActiveWallets: jest.fn(() => ({ then: () => roster([wallet()]) })),
    }) as unknown as WalletRegistrationService;
    const reader = new WalletRegistrationMainnetFinancialActionFinalityWalletReader(
      thenable,
      Object.freeze({ now: () => new Date(NOW_MILLISECONDS) }),
    );
    await expect(reader.readWallet(request(new AbortController().signal))).rejects.toMatchObject({
      code: 'WALLET_UNAVAILABLE',
    });
  });

  it('rejects malformed, non-mainnet, mutable, and oversized roster data', async () => {
    const badWallet = (overrides: Record<string, unknown>): ActiveRegisteredWallet =>
      Object.freeze({ ...wallet(), ...overrides }) as ActiveRegisteredWallet;
    const oversized = roster(
      Array.from({ length: 33 }, (_, index) =>
        wallet({ walletId: `${index.toString(16).padStart(8, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb` }),
      ),
    );
    const sparseWallets = new Array<ActiveRegisteredWallet>(1);
    Object.freeze(sparseWallets);
    const accessorWallets: ActiveRegisteredWallet[] = [];
    Object.defineProperty(accessorWallets, '0', {
      enumerable: true,
      configurable: false,
      get: () => wallet(),
    });
    Object.defineProperty(accessorWallets, 'length', { writable: false });
    Object.freeze(accessorWallets);
    const extraKeyWallets = [wallet()] as ActiveRegisteredWallet[] & { extra?: string };
    extraKeyWallets.extra = 'not admitted';
    Object.freeze(extraKeyWallets);
    const invalidRosters: unknown[] = [
      { version: 1, wallets: [] },
      Object.freeze({ version: 2, wallets: Object.freeze([]) }),
      roster([badWallet({ registryEnvironment: 'TESTNET' })]),
      roster([badWallet({ registryVersion: MAINNET_REGISTRY.version + 1 })]),
      roster([badWallet({ registryFingerprintSha256: '9'.repeat(64) })]),
      roster([badWallet({ chainId: 'eip155:8453' })]),
      roster([badWallet({ address: '0x0000000000000000000000000000000000000000' })]),
      Object.freeze({ version: 1, wallets: sparseWallets }),
      Object.freeze({ version: 1, wallets: accessorWallets }),
      Object.freeze({ version: 1, wallets: extraKeyWallets }),
      oversized,
    ];

    for (const invalidRoster of invalidRosters) {
      const fixture = harness(invalidRoster as ActiveWalletRoster);
      await expect(
        fixture.reader.readWallet(request(new AbortController().signal)),
      ).rejects.toMatchObject({ code: 'WALLET_UNAVAILABLE' });
    }
  });

  it('binds capability provenance to the exact reader instance and exact request identity', async () => {
    const fixture = harness();
    const signal = new AbortController().signal;
    const walletRequest = request(signal);
    const capability = await issued(fixture, walletRequest);
    const clone = Object.freeze(
      Object.assign(Object.create(null), { ...walletRequest }),
    ) as ReadMainnetFinancialActionFinalityWalletRequestV1;
    const changedDigest = request(signal, { walletIdentityDigestHex: '3'.repeat(64) });
    const other = harness();

    expect(fixture.reader.verifyWallet({ ...capability }, walletRequest)).toBeNull();
    expect(fixture.reader.verifyWallet(new Proxy(capability, {}), walletRequest)).toBeNull();
    expect(fixture.reader.verifyWallet(capability, clone)).toBeNull();
    expect(fixture.reader.verifyWallet(capability, changedDigest)).toBeNull();
    expect(fixture.reader.verifyWallet(capability, new Proxy(walletRequest, {}))).toBeNull();
    expect(other.reader.verifyWallet(capability, walletRequest)).toBeNull();
  });

  it('expires verification immediately on abort or deadline without another service read', async () => {
    const controller = new AbortController();
    const fixture = harness();
    const walletRequest = request(controller.signal);
    const capability = await issued(fixture, walletRequest);
    controller.abort();

    expect(fixture.reader.verifyWallet(capability, walletRequest)).toBeNull();
    expect(fixture.listActiveWallets).toHaveBeenCalledTimes(1);

    const times = [NOW_MILLISECONDS, NOW_MILLISECONDS, NOW_MILLISECONDS, Date.parse(DEADLINE)];
    const expiring = harness(
      roster([wallet()]),
      () => new Date(times.shift() ?? Date.parse(DEADLINE)),
    );
    const expiringRequest = request(new AbortController().signal);
    const expiringCapability = await issued(expiring, expiringRequest);
    expect(expiring.reader.verifyWallet(expiringCapability, expiringRequest)).toBeNull();
    expect(expiring.listActiveWallets).toHaveBeenCalledTimes(1);
  });

  it('rejects proxy dependencies without calling them', () => {
    const listActiveWallets = jest.fn(async () => roster([wallet()]));
    const service = new Proxy({ listActiveWallets }, {}) as unknown as WalletRegistrationService;

    expect(
      () =>
        new WalletRegistrationMainnetFinancialActionFinalityWalletReader(
          service,
          Object.freeze({ now: () => new Date(NOW_MILLISECONDS) }),
        ),
    ).toThrow(DormantMainnetFinancialActionFinalityWalletUnavailableError);
    expect(listActiveWallets).not.toHaveBeenCalled();
  });
});
