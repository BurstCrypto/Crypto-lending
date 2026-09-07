import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  assessDormantMainnetFinancialAction,
  DORMANT_MAINNET_FINANCIAL_ACTION_DENIAL_REASONS,
  DORMANT_MAINNET_FINANCIAL_ACTION_MAXIMUM_TTL_MILLISECONDS,
  DORMANT_MAINNET_FINANCIAL_ACTION_POLICY,
  DormantMainnetFinancialActionValidationError,
  MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES,
  parseDormantMainnetFinancialActionIntent,
  type DormantMainnetFinancialActionIntentInputV1,
  type DormantMainnetFinancialActionValidationCode,
  type MainnetFinancialActionProviderCandidate,
} from './dormant-mainnet-financial-action';

const ETHEREUM = 'eip155:1';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const NOW = new Date('2026-09-06T12:00:00.000Z');
const ETHEREUM_WALLET = '0x1111111111111111111111111111111111111111';
const ETHEREUM_MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const ETHEREUM_USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const SOLANA_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
const SOLANA_WALLET = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function input(
  overrides: Partial<DormantMainnetFinancialActionIntentInputV1> = {},
): DormantMainnetFinancialActionIntentInputV1 {
  const networkId = overrides.networkId ?? ETHEREUM;
  const isSolana = networkId === SOLANA;
  return {
    schemaVersion: 1,
    intentId: '11111111-1111-4111-8111-111111111111',
    accountId: '22222222-2222-4222-8222-222222222222',
    walletRegistrationId: '33333333-3333-4333-8333-333333333333',
    replayProtectionId: '44444444-4444-4444-8444-444444444444',
    idempotencyKeyDigestSha256: 'ab'.repeat(32),
    networkId,
    walletAddress: isSolana ? SOLANA_WALLET : ETHEREUM_WALLET,
    providerId: isSolana ? 'kamino' : 'aave',
    protocolId: isSolana ? 'kamino-lend' : 'aave-v3',
    marketId: isSolana ? SOLANA_MARKET : ETHEREUM_MARKET,
    assetRegistryVersion: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version,
    assetRegistryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    assetSymbol: 'USDC',
    assetIdentity: isSolana ? SOLANA_USDC : ETHEREUM_USDC,
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

function inputForProvider(
  provider: MainnetFinancialActionProviderCandidate,
): DormantMainnetFinancialActionIntentInputV1 {
  return input({
    networkId: provider.networkId,
    providerId: provider.providerId,
    protocolId: provider.protocolId,
  });
}

function expectCode(
  candidate: unknown,
  code: DormantMainnetFinancialActionValidationCode,
  now: unknown = NOW,
): void {
  expect(() => parseDormantMainnetFinancialActionIntent(candidate, now)).toThrow(
    new DormantMainnetFinancialActionValidationError(code),
  );
}

describe('dormant mainnet financial action boundary', () => {
  it('uses the canonical provider and protocol identities from the lending boundaries', () => {
    expect(MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES).toEqual([
      { providerId: 'aave', protocolId: 'aave-v3', networkId: ETHEREUM },
      { providerId: 'morpho', protocolId: 'morpho-blue', networkId: ETHEREUM },
      { providerId: 'compound', protocolId: 'compound-iii', networkId: ETHEREUM },
      { providerId: 'spark', protocolId: 'sparklend', networkId: ETHEREUM },
      { providerId: 'euler', protocolId: 'euler-v2', networkId: ETHEREUM },
      { providerId: 'gearbox', protocolId: 'gearbox-v3', networkId: ETHEREUM },
      { providerId: 'kamino', protocolId: 'kamino-lend', networkId: SOLANA },
      { providerId: 'save', protocolId: 'save-lend', networkId: SOLANA },
      { providerId: 'project-0', protocolId: 'marginfi-v2', networkId: SOLANA },
      { providerId: 'jupiter', protocolId: 'jupiter-lend', networkId: SOLANA },
    ]);
  });

  it('normalizes a fully bound Ethereum candidate without granting authority', () => {
    const parsed = parseDormantMainnetFinancialActionIntent(input(), NOW);

    expect(parsed).toMatchObject({
      use: 'DORMANT_MAINNET_FINANCIAL_ACTION_INTENT_VALIDATION_ONLY',
      mayAuthorizeFinancialAction: false,
      networkId: ETHEREUM,
      walletAddress: ETHEREUM_WALLET,
      providerId: 'aave',
      protocolId: 'aave-v3',
      marketId: ETHEREUM_MARKET,
      assetSymbol: 'USDC',
      assetIdentity: ETHEREUM_USDC,
      assetDecimals: 6,
      action: 'SUPPLY',
      allowanceMode: 'EXACT',
      allowanceAmountAtomic: '1000000',
      signingResponsibility: 'USER_WALLET_ONLY',
      broadcastResponsibility: 'USER_WALLET_ONLY',
      apiMaySign: false,
      apiMayBroadcast: false,
      crossChainExecutionAllowed: false,
      automaticResendAllowed: false,
      automaticFeeEscalationAllowed: false,
      durableReplayProtectionVerified: false,
    });
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('normalizes a fully bound Solana candidate without granting authority', () => {
    const parsed = parseDormantMainnetFinancialActionIntent(input({ networkId: SOLANA }), NOW);

    expect(parsed).toMatchObject({
      mayAuthorizeFinancialAction: false,
      networkId: SOLANA,
      walletAddress: SOLANA_WALLET,
      providerId: 'kamino',
      protocolId: 'kamino-lend',
      marketId: SOLANA_MARKET,
      assetSymbol: 'USDC',
      assetIdentity: SOLANA_USDC,
      signingResponsibility: 'USER_WALLET_ONLY',
      broadcastResponsibility: 'USER_WALLET_ONLY',
    });
  });

  it.each(MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES)(
    'binds candidate $providerId/$protocolId to $networkId only',
    (candidate) => {
      expect(
        parseDormantMainnetFinancialActionIntent(inputForProvider(candidate), NOW),
      ).toMatchObject(candidate);
    },
  );

  it('rejects cross-chain, cross-provider, and cross-protocol substitutions', () => {
    expectCode(
      input({ providerId: 'kamino', protocolId: 'kamino-lend' }),
      'INVALID_PROVIDER_BINDING',
    );
    expectCode(
      input({ providerId: 'aave', protocolId: 'compound-iii' }),
      'INVALID_PROVIDER_BINDING',
    );
    expectCode(
      input({ networkId: SOLANA, providerId: 'aave', protocolId: 'aave-v3' }),
      'INVALID_PROVIDER_BINDING',
    );
    expectCode(input({ providerId: 'unknown', protocolId: 'aave-v3' }), 'INVALID_PROVIDER_BINDING');
  });

  it.each(['eip155:8453', 'eip155:11155111', 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'])(
    'rejects deferred or non-mainnet network %s',
    (networkId) => {
      expectCode(input({ networkId }), 'INVALID_NETWORK');
    },
  );

  it('requires an exact current asset-registry version and fingerprint', () => {
    expectCode(input({ assetRegistryVersion: 0 }), 'INVALID_ASSET_REGISTRY_BINDING');
    expectCode(
      input({ assetRegistryFingerprintSha256: 'cd'.repeat(32) }),
      'INVALID_ASSET_REGISTRY_BINDING',
    );
  });

  it('binds the asset symbol and canonical identity to the selected chain', () => {
    expectCode(input({ assetSymbol: 'USDT' }), 'INVALID_ASSET_BINDING');
    expectCode(input({ assetIdentity: SOLANA_USDC }), 'INVALID_ASSET_BINDING');
    expectCode(input({ networkId: SOLANA, assetIdentity: ETHEREUM_USDC }), 'INVALID_ASSET_BINDING');
    expectCode(input({ assetIdentity: ETHEREUM_USDC.toUpperCase() }), 'INVALID_ASSET_BINDING');
  });

  it('requires a canonical, non-zero market identity for the selected chain', () => {
    const bytes32Market = `0x${'12'.repeat(32)}`;
    expect(
      parseDormantMainnetFinancialActionIntent(input({ marketId: bytes32Market }), NOW).marketId,
    ).toBe(bytes32Market);
    expectCode(input({ marketId: `0x${'0'.repeat(40)}` }), 'INVALID_MARKET_BINDING');
    expectCode(input({ marketId: ETHEREUM_MARKET.toUpperCase() }), 'INVALID_MARKET_BINDING');
    expectCode(input({ networkId: SOLANA, marketId: ETHEREUM_MARKET }), 'INVALID_MARKET_BINDING');
  });

  it.each(['BRIDGE', 'SWAP', 'ALLOCATE', 'supply', ''])(
    'rejects unsupported action %j',
    (action) => {
      expectCode(input({ action }), 'INVALID_ACTION');
    },
  );

  it('requires positive canonical amount and requested-value fields within uint256', () => {
    for (const amountAtomic of [
      '0',
      '-1',
      '+1',
      '01',
      '1.0',
      (1n << 256n).toString(),
      '9'.repeat(10_000),
    ]) {
      expectCode(input({ amountAtomic }), 'INVALID_AMOUNT');
    }
    for (const requestedValueUsdMicros of ['0', '-1', '01', (1n << 256n).toString()]) {
      expectCode(input({ requestedValueUsdMicros }), 'INVALID_VALUE_LIMIT_INPUT');
    }
  });

  it('bounds both absolute and percentage fee inputs', () => {
    for (const maximumNetworkFeeAtomic of ['-1', '01', (1n << 256n).toString()]) {
      expectCode(input({ maximumNetworkFeeAtomic }), 'INVALID_NETWORK_FEE_LIMIT_INPUT');
    }
    for (const maximumNetworkFeeBasisPoints of [-1, 10_001, 1.5, Number.NaN]) {
      expectCode(input({ maximumNetworkFeeBasisPoints }), 'INVALID_NETWORK_FEE_LIMIT_INPUT');
    }
    expect(
      parseDormantMainnetFinancialActionIntent(
        input({ maximumNetworkFeeAtomic: '0', maximumNetworkFeeBasisPoints: 0 }),
        NOW,
      ).maximumNetworkFeeAtomic,
    ).toBe('0');
  });

  it('requires a positive post-action native-asset reserve', () => {
    for (const minimumPostActionNativeBalanceAtomic of ['0', '-1', '01']) {
      expectCode(input({ minimumPostActionNativeBalanceAtomic }), 'INVALID_POST_ACTION_RESERVE');
    }
  });

  it('allows only an exact action-appropriate allowance', () => {
    for (const action of ['SUPPLY', 'REPAY'] as const) {
      expect(
        parseDormantMainnetFinancialActionIntent(input({ action }), NOW).allowanceAmountAtomic,
      ).toBe('1000000');
      expectCode(input({ action, allowanceAmountAtomic: '1000001' }), 'INVALID_ALLOWANCE');
    }
    for (const action of ['WITHDRAW', 'BORROW'] as const) {
      expect(
        parseDormantMainnetFinancialActionIntent(input({ action, allowanceAmountAtomic: '0' }), NOW)
          .allowanceAmountAtomic,
      ).toBe('0');
      expectCode(input({ action, allowanceAmountAtomic: '1000000' }), 'INVALID_ALLOWANCE');
    }
    expectCode(input({ allowanceMode: 'UNLIMITED' }), 'INVALID_ALLOWANCE');
  });

  it('uses exclusive expiry, server time, and a five-minute maximum lifetime', () => {
    expect(DORMANT_MAINNET_FINANCIAL_ACTION_MAXIMUM_TTL_MILLISECONDS).toBe(300_000);
    expectCode(input({ issuedAt: '2026-09-06T12:00:00.001Z' }), 'INVALID_INTENT_TIME');
    expectCode(input({ expiresAt: NOW.toISOString() }), 'INVALID_INTENT_TIME');
    expectCode(
      input({ issuedAt: '2026-09-06T11:58:59.999Z', expiresAt: '2026-09-06T12:04:00.000Z' }),
      'INVALID_INTENT_TIME',
    );
    expectCode(input({ expiresAt: '2026-09-06T12:04:00Z' }), 'INVALID_INTENT_TIME');
    expectCode(input(), 'INVALID_SERVER_TIME', new Date(Number.NaN));
    expectCode(input(), 'INVALID_SERVER_TIME', '2026-09-06T12:00:00.000Z');
    expectCode(input(), 'INVALID_SERVER_TIME', new Proxy(NOW, {}));

    class DateSubclass extends Date {}
    expectCode(input(), 'INVALID_SERVER_TIME', new DateSubclass(NOW));
  });

  it('requires distinct UUIDv4 identifiers and a non-zero lowercase replay digest', () => {
    expectCode(input({ intentId: 'not-an-id' }), 'INVALID_INTENT_ID');
    expectCode(input({ accountId: 'not-an-id' }), 'INVALID_ACCOUNT_ID');
    expectCode(input({ walletRegistrationId: 'not-an-id' }), 'INVALID_WALLET_REGISTRATION_ID');
    expectCode(input({ replayProtectionId: input().intentId }), 'INVALID_REPLAY_PROTECTION');
    expectCode(input({ idempotencyKeyDigestSha256: '0'.repeat(64) }), 'INVALID_REPLAY_PROTECTION');
    expectCode(input({ idempotencyKeyDigestSha256: 'AB'.repeat(32) }), 'INVALID_REPLAY_PROTECTION');
  });

  it('rejects missing, extra, inherited, accessor, and hostile proxy input', () => {
    const missing = { ...input() } as Record<string, unknown>;
    delete missing['action'];
    expectCode(missing, 'INVALID_INTENT_INPUT');
    expectCode({ ...input(), extra: true }, 'INVALID_INTENT_INPUT');
    expectCode(
      Object.assign(Object.create({ inherited: true }) as object, input()),
      'INVALID_INTENT_INPUT',
    );

    let getterInvoked = false;
    const accessor = { ...input() } as Record<string, unknown>;
    Object.defineProperty(accessor, 'providerId', {
      enumerable: true,
      get: () => {
        getterInvoked = true;
        return 'aave';
      },
    });
    expectCode(accessor, 'INVALID_INTENT_INPUT');
    expect(getterInvoked).toBe(false);

    const hostile = new Proxy(input(), {
      ownKeys: () => {
        throw new Error('hostile proxy');
      },
    });
    expectCode(hostile, 'INVALID_INTENT_INPUT');

    const errorSpoofingProxy = new Proxy(input(), {
      ownKeys: () => {
        throw new DormantMainnetFinancialActionValidationError('INVALID_ACTION');
      },
    });
    expectCode(errorSpoofingProxy, 'INVALID_INTENT_INPUT');
  });

  it('returns value-free validation errors', () => {
    const untrusted = ['private', 'candidate', 'value'].join('-');
    try {
      parseDormantMainnetFinancialActionIntent(input({ providerId: untrusted }), NOW);
      throw new Error('expected parsing to fail');
    } catch (error: unknown) {
      expect(error).toEqual(
        new DormantMainnetFinancialActionValidationError('INVALID_PROVIDER_BINDING'),
      );
      expect((error as Error).message).not.toContain(untrusted);
    }
  });

  it('defensively snapshots mutable input', () => {
    const mutable = input() as unknown as Record<string, unknown>;
    const parsed = parseDormantMainnetFinancialActionIntent(mutable, NOW);
    mutable['providerId'] = 'compound';
    mutable['assetIdentity'] = SOLANA_USDC;
    mutable['amountAtomic'] = '999999999';

    expect(parsed).toMatchObject({
      providerId: 'aave',
      assetIdentity: ETHEREUM_USDC,
      amountAtomic: '1000000',
    });
  });

  it('ships only a deeply frozen, empty-approval, zero-limit policy', () => {
    expect(DORMANT_MAINNET_FINANCIAL_ACTION_POLICY).toMatchObject({
      mode: 'DISABLED',
      mayAuthorizeFinancialAction: false,
      chainKillSwitches: {
        [ETHEREUM]: 'HALT',
        [SOLANA]: 'HALT',
      },
      approvedProviders: [],
      approvedMarkets: [],
      approvedAssets: [],
      approvedActions: [],
      allowlistedWallets: [],
      perTransactionUsdMicros: '0',
      perWalletDailyUsdMicros: '0',
      globalDailyUsdMicros: '0',
      totalOutstandingUsdMicros: '0',
      maximumNetworkFeeAtomic: '0',
      maximumNetworkFeeBasisPoints: 0,
      minimumPostActionNativeBalanceAtomic: '0',
      maximumAllowanceAtomic: '0',
      maximumUnresolvedIntentsPerWallet: 0,
      walletAllowlistSize: 0,
      exactAllowanceRequired: true,
      automaticResendAllowed: false,
      automaticFeeEscalationAllowed: false,
      durableReplayProtectionAvailable: false,
      durableLimitCountersAvailable: false,
      providerWriteApprovalAvailable: false,
      marketWriteManifestAvailable: false,
      signingResponsibility: 'USER_WALLET_ONLY',
      broadcastResponsibility: 'USER_WALLET_ONLY',
      apiMaySign: false,
      apiMayBroadcast: false,
    });
    expect(Object.isFrozen(DORMANT_MAINNET_FINANCIAL_ACTION_POLICY)).toBe(true);
    expect(Object.isFrozen(DORMANT_MAINNET_FINANCIAL_ACTION_POLICY.chainKillSwitches)).toBe(true);
    for (const approvals of [
      DORMANT_MAINNET_FINANCIAL_ACTION_POLICY.approvedProviders,
      DORMANT_MAINNET_FINANCIAL_ACTION_POLICY.approvedMarkets,
      DORMANT_MAINNET_FINANCIAL_ACTION_POLICY.approvedAssets,
      DORMANT_MAINNET_FINANCIAL_ACTION_POLICY.approvedActions,
      DORMANT_MAINNET_FINANCIAL_ACTION_POLICY.allowlistedWallets,
    ]) {
      expect(Object.isFrozen(approvals)).toBe(true);
    }
  });

  it.each(MAINNET_FINANCIAL_ACTION_PROVIDER_CANDIDATES)(
    'always denies a valid $providerId candidate with every fixed fail-closed reason',
    (provider) => {
      const assessment = assessDormantMainnetFinancialAction(inputForProvider(provider), NOW);
      expect(assessment).toEqual({
        schemaVersion: 1,
        decision: 'DENY',
        mayAuthorizeFinancialAction: false,
        intent: parseDormantMainnetFinancialActionIntent(inputForProvider(provider), NOW),
        policy: DORMANT_MAINNET_FINANCIAL_ACTION_POLICY,
        denialReasons: DORMANT_MAINNET_FINANCIAL_ACTION_DENIAL_REASONS,
      });
      expect(Object.isFrozen(assessment)).toBe(true);
      expect(Object.isFrozen(assessment.denialReasons)).toBe(true);
    },
  );
});
