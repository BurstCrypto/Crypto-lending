import { keccak256, type Hex } from 'viem';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import {
  createEulerV2EthereumVaultManifest,
  EULER_V2_ETHEREUM_IDENTITIES,
  EULER_V2_ETHEREUM_SELECTORS,
  EULER_V2_ETHEREUM_SOURCE_PINS,
  EulerV2EthereumFinalizedTranscriptAdapter,
  EulerV2EthereumTranscriptUnavailableError,
  type EulerV2EthereumVaultManifestDefinition,
  type EulerV2EthereumJsonRpcRequest,
  type EulerV2EthereumJsonRpcTranscriptTransport,
  type ReadEulerV2EthereumVaultTranscriptRequest,
} from './euler-v2-ethereum-finalized-transcript.adapter';

const VAULT = '0x1111111111111111111111111111111111111111';
const ORACLE = '0x2222222222222222222222222222222222222222';
const IRM = '0x3333333333333333333333333333333333333333';
const PROBE = '0x4444444444444444444444444444444444444444';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const BLOCK = Object.freeze({
  number: '0x123',
  hash: `0x${'ab'.repeat(32)}`,
  parentHash: `0x${'cd'.repeat(32)}`,
  stateRoot: `0x${'ef'.repeat(32)}`,
  timestamp: `0x${(1_800_000_000).toString(16)}`,
  transactions: Object.freeze([]),
});
const CLOCK = new Date(1_800_000_300_000);
const SUPPLY_CAP_RAW = 64_006n; // exponent 6, mantissa 1000 => 10,000,000 atomic
const BORROW_CAP_RAW = 32_006n; // exponent 6, mantissa 500 => 5,000,000 atomic
const TOTAL_ASSETS = 5_000_000n;
const TOTAL_SUPPLY = 4_000_000n;
const CASH = 3_000_000n;
const TOTAL_BORROWS = 2_000_000n;
const CONVERT_TO_ASSETS = 1_200_000n;
const CONVERT_TO_SHARES = 833_333n;
const MAX_DEPOSIT = 4_999_999n;

type ResultMutator = (
  request: EulerV2EthereumJsonRpcRequest,
  result: unknown,
  ordinal: number,
) => unknown;

type ResponseMutator = (
  request: EulerV2EthereumJsonRpcRequest,
  response: Readonly<{ jsonrpc: '2.0'; id: number; result: unknown }>,
) => unknown;

interface HarnessOptions {
  readonly resultMutator?: ResultMutator;
  readonly responseMutator?: ResponseMutator;
  readonly clock?: unknown;
  readonly requiredFingerprint?: string;
  readonly rawManifest?: ReturnType<typeof manifestDefinition>;
}

type MutableWidened<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends object
        ? { -readonly [Key in keyof T]: MutableWidened<T[Key]> }
        : T;

type TestManifestDefinition = MutableWidened<EulerV2EthereumVaultManifestDefinition>;

function codeFor(index: number): Hex {
  return `0x60${index.toString(16).padStart(2, '0')}6000` as Hex;
}

const CODE_ENTRIES = Object.freeze([
  EULER_V2_ETHEREUM_IDENTITIES.factory,
  EULER_V2_ETHEREUM_IDENTITIES.implementation,
  EULER_V2_ETHEREUM_IDENTITIES.evc,
  EULER_V2_ETHEREUM_IDENTITIES.protocolConfig,
  EULER_V2_ETHEREUM_IDENTITIES.sequenceRegistry,
  EULER_V2_ETHEREUM_IDENTITIES.balanceTracker,
  EULER_V2_ETHEREUM_IDENTITIES.permit2,
  EULER_V2_ETHEREUM_IDENTITIES.modules.token,
  EULER_V2_ETHEREUM_IDENTITIES.modules.vault,
  EULER_V2_ETHEREUM_IDENTITIES.modules.borrowing,
  EULER_V2_ETHEREUM_IDENTITIES.modules.governance,
  VAULT,
  USDC,
  ORACLE,
  IRM,
]);

const CODES = new Map(CODE_ENTRIES.map((address, index) => [address, codeFor(index + 1)] as const));

function identity(address: string): { address: string; runtimeCodeKeccak256: string } {
  const code = CODES.get(address);
  if (code === undefined) throw new Error('missing test code');
  return { address, runtimeCodeKeccak256: keccak256(code) };
}

function manifestDefinition(): TestManifestDefinition {
  return {
    schemaVersion: 1,
    use: 'DORMANT_EULER_V2_VAULT_CORROBORATION_ONLY',
    sources: { ...EULER_V2_ETHEREUM_SOURCE_PINS },
    registryVersion: 1,
    registryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    networkId: 'eip155:1',
    chainId: '0x1',
    blockSelector: 'finalized',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    maximumFinalizedBlockAgeSeconds: '600',
    deployment: {
      factory: identity(EULER_V2_ETHEREUM_IDENTITIES.factory),
      implementation: identity(EULER_V2_ETHEREUM_IDENTITIES.implementation),
      evc: identity(EULER_V2_ETHEREUM_IDENTITIES.evc),
      protocolConfig: identity(EULER_V2_ETHEREUM_IDENTITIES.protocolConfig),
      sequenceRegistry: identity(EULER_V2_ETHEREUM_IDENTITIES.sequenceRegistry),
      balanceTracker: identity(EULER_V2_ETHEREUM_IDENTITIES.balanceTracker),
      permit2: identity(EULER_V2_ETHEREUM_IDENTITIES.permit2),
      modules: {
        token: identity(EULER_V2_ETHEREUM_IDENTITIES.modules.token),
        vault: identity(EULER_V2_ETHEREUM_IDENTITIES.modules.vault),
        borrowing: identity(EULER_V2_ETHEREUM_IDENTITIES.modules.borrowing),
        governance: identity(EULER_V2_ETHEREUM_IDENTITIES.modules.governance),
      },
    },
    vault: {
      marketId: `euler-v2-ethereum-mainnet:${VAULT}`,
      vaultAddress: VAULT,
      vaultRuntimeCodeKeccak256: keccak256(CODES.get(VAULT) as Hex),
      proxyKind: 'IMMUTABLE_META_PROXY',
      upgradeable: false,
      stablecoin: 'USDC',
      assetAddress: USDC,
      assetRuntimeCodeKeccak256: keccak256(CODES.get(USDC) as Hex),
      oracleAddress: ORACLE,
      oracleRuntimeCodeKeccak256: keccak256(CODES.get(ORACLE) as Hex),
      unitOfAccountAddress: USDC,
      interestRateModelAddress: IRM,
      interestRateModelRuntimeCodeKeccak256: keccak256(CODES.get(IRM) as Hex),
      depositProbeAccount: PROBE,
      expectedConfigFlags: '0',
      expectedSupplyCapRaw: SUPPLY_CAP_RAW.toString(10),
      expectedBorrowCapRaw: BORROW_CAP_RAW.toString(10),
    },
  };
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

function uintResult(value: bigint): string {
  return `0x${word(value)}`;
}

function addressResult(value: string): string {
  return `0x${'0'.repeat(24)}${value.slice(2)}`;
}

function boolResult(value: boolean): string {
  return uintResult(value ? 1n : 0n);
}

function twoWordResult(first: bigint | string, second: bigint | string): string {
  const encode = (value: bigint | string): string =>
    typeof value === 'bigint' ? word(value) : addressResult(value).slice(2);
  return `0x${encode(first)}${encode(second)}`;
}

function proxyConfigResult(
  upgradeable = false,
  implementation: string = EULER_V2_ETHEREUM_IDENTITIES.implementation,
  trailingData = `${USDC.slice(2)}${ORACLE.slice(2)}${USDC.slice(2)}`,
): string {
  return `0x${word(upgradeable ? 1n : 0n)}${addressResult(implementation).slice(2)}${word(
    96n,
  )}${word(60n)}${trailingData.padEnd(128, '0')}`;
}

function baseResult(request: EulerV2EthereumJsonRpcRequest): unknown {
  if (request.method === 'eth_chainId') return '0x1';
  if (request.method === 'eth_getBlockByNumber') return BLOCK;
  if (request.method === 'eth_getCode') {
    const address = request.params[0];
    return typeof address === 'string' ? CODES.get(address) : undefined;
  }
  const transaction = request.params[0] as Readonly<{ to?: unknown; data?: unknown }>;
  const to = transaction.to;
  const data = transaction.data;
  if (typeof to !== 'string' || typeof data !== 'string') return undefined;
  const selector = data.slice(0, 10);
  if (to === EULER_V2_ETHEREUM_IDENTITIES.factory) {
    if (selector === EULER_V2_ETHEREUM_SELECTORS.factoryImplementation) {
      return addressResult(EULER_V2_ETHEREUM_IDENTITIES.implementation);
    }
    if (selector === EULER_V2_ETHEREUM_SELECTORS.factoryIsProxy) return boolResult(true);
    if (selector === EULER_V2_ETHEREUM_SELECTORS.factoryGetProxyConfig) {
      return proxyConfigResult();
    }
  }
  if (to === USDC && selector === EULER_V2_ETHEREUM_SELECTORS.decimals) return uintResult(6n);
  if (to !== VAULT) return undefined;
  const addressResults = new Map<string, string>([
    [EULER_V2_ETHEREUM_SELECTORS.asset, USDC],
    [EULER_V2_ETHEREUM_SELECTORS.evc, EULER_V2_ETHEREUM_IDENTITIES.evc],
    [
      EULER_V2_ETHEREUM_SELECTORS.protocolConfigAddress,
      EULER_V2_ETHEREUM_IDENTITIES.protocolConfig,
    ],
    [
      EULER_V2_ETHEREUM_SELECTORS.balanceTrackerAddress,
      EULER_V2_ETHEREUM_IDENTITIES.balanceTracker,
    ],
    [EULER_V2_ETHEREUM_SELECTORS.permit2Address, EULER_V2_ETHEREUM_IDENTITIES.permit2],
    [EULER_V2_ETHEREUM_SELECTORS.oracle, ORACLE],
    [EULER_V2_ETHEREUM_SELECTORS.unitOfAccount, USDC],
    [EULER_V2_ETHEREUM_SELECTORS.interestRateModel, IRM],
    [EULER_V2_ETHEREUM_SELECTORS.moduleToken, EULER_V2_ETHEREUM_IDENTITIES.modules.token],
    [EULER_V2_ETHEREUM_SELECTORS.moduleVault, EULER_V2_ETHEREUM_IDENTITIES.modules.vault],
    [EULER_V2_ETHEREUM_SELECTORS.moduleBorrowing, EULER_V2_ETHEREUM_IDENTITIES.modules.borrowing],
    [EULER_V2_ETHEREUM_SELECTORS.moduleGovernance, EULER_V2_ETHEREUM_IDENTITIES.modules.governance],
    [EULER_V2_ETHEREUM_SELECTORS.governorAdmin, ZERO_ADDRESS],
  ]);
  const address = addressResults.get(selector);
  if (address !== undefined) return addressResult(address);
  const uintResults = new Map<string, bigint>([
    [EULER_V2_ETHEREUM_SELECTORS.decimals, 6n],
    [EULER_V2_ETHEREUM_SELECTORS.configFlags, 0n],
    [EULER_V2_ETHEREUM_SELECTORS.totalAssets, TOTAL_ASSETS],
    [EULER_V2_ETHEREUM_SELECTORS.totalSupply, TOTAL_SUPPLY],
    [EULER_V2_ETHEREUM_SELECTORS.cash, CASH],
    [EULER_V2_ETHEREUM_SELECTORS.totalBorrows, TOTAL_BORROWS],
    [EULER_V2_ETHEREUM_SELECTORS.convertToAssets, CONVERT_TO_ASSETS],
    [EULER_V2_ETHEREUM_SELECTORS.convertToShares, CONVERT_TO_SHARES],
    [EULER_V2_ETHEREUM_SELECTORS.previewDeposit, CONVERT_TO_SHARES],
    [EULER_V2_ETHEREUM_SELECTORS.maxDeposit, MAX_DEPOSIT],
  ]);
  const integer = uintResults.get(selector);
  if (integer !== undefined) return uintResult(integer);
  if (selector === EULER_V2_ETHEREUM_SELECTORS.hookConfig) {
    return twoWordResult(ZERO_ADDRESS, 0n);
  }
  if (selector === EULER_V2_ETHEREUM_SELECTORS.caps) {
    return twoWordResult(SUPPLY_CAP_RAW, BORROW_CAP_RAW);
  }
  return undefined;
}

function harness(options: HarnessOptions = {}): {
  readonly adapter: EulerV2EthereumFinalizedTranscriptAdapter;
  readonly manifest: ReturnType<typeof createEulerV2EthereumVaultManifest>;
  readonly requests: EulerV2EthereumJsonRpcRequest[];
} {
  const rawManifest = options.rawManifest ?? manifestDefinition();
  const manifest = createEulerV2EthereumVaultManifest(rawManifest);
  const requests: EulerV2EthereumJsonRpcRequest[] = [];
  const transport: EulerV2EthereumJsonRpcTranscriptTransport = {
    async exchange(request) {
      requests.push(request);
      const result = baseResult(request);
      const mutated = options.resultMutator?.(request, result, requests.length) ?? result;
      const response = Object.freeze({ jsonrpc: '2.0' as const, id: request.id, result: mutated });
      return options.responseMutator?.(request, response) ?? response;
    },
  };
  const clockValue = options.clock ?? CLOCK;
  const adapter = new EulerV2EthereumFinalizedTranscriptAdapter(
    rawManifest,
    options.requiredFingerprint ?? manifest.manifestFingerprintSha256,
    transport,
    { now: () => clockValue as Date },
  );
  return { adapter, manifest, requests };
}

function request(): ReadEulerV2EthereumVaultTranscriptRequest {
  return {
    marketId: `euler-v2-ethereum-mainnet:${VAULT}`,
    vaultAddress: VAULT,
    stablecoin: 'USDC' as const,
  };
}

function failRead(options: HarnessOptions): Promise<unknown> {
  return harness(options).adapter.read(request());
}

function mutateCall(selector: string, replacement: unknown, to?: string): ResultMutator {
  return (rpcRequest, result) => {
    if (rpcRequest.method !== 'eth_call') return result;
    const transaction = rpcRequest.params[0] as { to?: unknown; data?: unknown };
    return typeof transaction.data === 'string' &&
      transaction.data.startsWith(selector) &&
      (to === undefined || transaction.to === to)
      ? replacement
      : result;
  };
}

describe('EulerV2EthereumFinalizedTranscriptAdapter', () => {
  it('returns only a dormant non-persistable raw evidence candidate', async () => {
    const { adapter } = harness();
    const candidate = await adapter.read(request());

    expect(candidate).toMatchObject({
      sourceId: 'EULER_V2_ETHEREUM_FINALIZED_JSON_RPC_TRANSCRIPT',
      providerId: 'euler',
      protocolId: 'euler-v2',
      networkId: 'eip155:1',
      sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT',
      yieldEvidenceStatus: 'ABSENT_NOT_COMPUTED',
      liquidityEvidenceStatus: 'NOT_ESTABLISHED_BY_CASH_CAP_OR_MAX_DEPOSIT',
      mayPersist: false,
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      deployment: {
        proxyKind: 'IMMUTABLE_META_PROXY',
        factoryRecognizedProxy: true,
        upgradeable: false,
        governorFinalized: true,
      },
      rawState: {
        totalAssetsAtomic: '5000000',
        totalSupplySharesAtomic: '4000000',
        cashAtomic: '3000000',
        totalBorrowsAtomic: '2000000',
        supplyCapResolvedAtomic: '10000000',
        borrowCapResolvedAtomic: '5000000',
        maxDepositProbeAtomic: '4999999',
      },
      conversionEvidence: {
        sampleAtomic: '1000000',
        sharesToAssetsAtomic: '1200000',
        assetsToSharesAtomic: '833333',
        previewDepositSharesAtomic: '833333',
        semantics: 'EVK_PINNED_VIRTUAL_DEPOSIT_INTEGER_ROUND_DOWN_MATCHED',
      },
    });
    expect(candidate).not.toHaveProperty('apy');
    expect(candidate).not.toHaveProperty('apr');
    expect(candidate).not.toHaveProperty('availableLiquidity');
  });

  it('uses EIP-1898 canonical block-hash parameters for every code and state read', async () => {
    const { adapter, requests } = harness();
    await adapter.read(request());
    const boundReads = requests.filter(
      (entry) => entry.method === 'eth_getCode' || entry.method === 'eth_call',
    );
    expect(boundReads.length).toBeGreaterThan(30);
    for (const entry of boundReads) {
      expect(entry.params.at(-1)).toEqual({ blockHash: BLOCK.hash, requireCanonical: true });
    }
    const finalHeader = requests.at(-2);
    expect(finalHeader).toMatchObject({
      method: 'eth_getBlockByNumber',
      params: [BLOCK.number, false],
    });
    expect(requests.at(-1)).toMatchObject({ method: 'eth_chainId', params: [] });
    expect(requests.some((entry) => entry.method === ('eth_getBlockByHash' as never))).toBe(false);
  });

  it('creates a deterministic separately matchable manifest fingerprint', () => {
    const first = createEulerV2EthereumVaultManifest(manifestDefinition());
    const second = createEulerV2EthereumVaultManifest(manifestDefinition());
    expect(first.manifestFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(second.manifestFingerprintSha256).toBe(first.manifestFingerprintSha256);
    expect(
      createEulerV2EthereumVaultManifest({
        ...manifestDefinition(),
        manifestFingerprintSha256: first.manifestFingerprintSha256,
      }),
    ).toEqual(first);
  });

  it('rejects a separately supplied manifest fingerprint mismatch', () => {
    expect(
      () =>
        new EulerV2EthereumFinalizedTranscriptAdapter(
          manifestDefinition(),
          'f'.repeat(64),
          { exchange: async () => ({}) },
          { now: () => CLOCK },
        ),
    ).toThrow(EulerV2EthereumTranscriptUnavailableError);
  });

  it.each([
    [
      'registry fingerprint',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.registryFingerprintSha256 = '0'.repeat(64);
      },
    ],
    [
      'source commit',
      (value: ReturnType<typeof manifestDefinition>) => {
        (value.sources as { eulerVaultKitCommitSha: string }).eulerVaultKitCommitSha = '0'.repeat(
          40,
        );
      },
    ],
    [
      'factory identity',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.deployment.factory.address = VAULT;
      },
    ],
    [
      'factory runtime fingerprint',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.deployment.factory.runtimeCodeKeccak256 = '0x' + '00'.repeat(32);
      },
    ],
    [
      'vault runtime fingerprint placeholder',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.vaultRuntimeCodeKeccak256 = `0x${'0'.repeat(64)}`;
      },
    ],
    [
      'asset runtime fingerprint placeholder',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.assetRuntimeCodeKeccak256 = `0x${'0'.repeat(64)}`;
      },
    ],
    [
      'oracle runtime fingerprint placeholder',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.oracleRuntimeCodeKeccak256 = `0x${'0'.repeat(64)}`;
      },
    ],
    [
      'IRM runtime fingerprint placeholder',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.interestRateModelRuntimeCodeKeccak256 = `0x${'0'.repeat(64)}`;
      },
    ],
    [
      'asset identity',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.assetAddress = IRM;
      },
    ],
    [
      'unit of account',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.unitOfAccountAddress = ORACLE;
      },
    ],
    [
      'upgradeability',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.upgradeable = true;
      },
    ],
    [
      'unlimited supply cap',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.expectedSupplyCapRaw = '0';
      },
    ],
    [
      'zero resolved cap',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.expectedSupplyCapRaw = '1';
      },
    ],
    [
      'unsupported flags',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.expectedConfigFlags = '4';
      },
    ],
    [
      'noncanonical address',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.vaultAddress = VAULT.toUpperCase();
      },
    ],
    [
      'market binding',
      (value: ReturnType<typeof manifestDefinition>) => {
        value.vault.marketId = `euler-v2-ethereum-mainnet:${ORACLE}`;
      },
    ],
  ])('rejects invalid manifest %s', (_label, mutate) => {
    const value = manifestDefinition();
    mutate(value);
    expect(() => createEulerV2EthereumVaultManifest(value)).toThrow(
      EulerV2EthereumTranscriptUnavailableError,
    );
  });

  it.each([
    ['marketId', { ...request(), marketId: `euler-v2-ethereum-mainnet:${ORACLE}` }],
    ['vaultAddress', { ...request(), vaultAddress: ORACLE }],
    ['stablecoin', { ...request(), stablecoin: 'USDT' }],
  ])('rejects request %s substitution', async (_label, value) => {
    await expect(
      harness().adapter.read(value as ReturnType<typeof request>),
    ).rejects.toBeInstanceOf(EulerV2EthereumTranscriptUnavailableError);
  });

  it.each([1, 48])('rejects wrong chain identity at check %i', async (ordinal) => {
    await expect(
      failRead({
        resultMutator: (rpcRequest, result, index) => (index === ordinal ? '0x2' : result),
      }),
    ).rejects.toBeInstanceOf(EulerV2EthereumTranscriptUnavailableError);
  });

  it.each(['hash', 'parentHash', 'stateRoot', 'timestamp'] as const)(
    'rejects canonical height re-read %s drift',
    async (field) => {
      await expect(
        failRead({
          resultMutator: (rpcRequest, result) =>
            rpcRequest.method === 'eth_getBlockByNumber' && rpcRequest.params[0] === BLOCK.number
              ? { ...BLOCK, [field]: field === 'timestamp' ? '0x1' : `0x${'11'.repeat(32)}` }
              : result,
        }),
      ).rejects.toBeInstanceOf(EulerV2EthereumTranscriptUnavailableError);
    },
  );

  it.each([
    EULER_V2_ETHEREUM_IDENTITIES.factory,
    EULER_V2_ETHEREUM_IDENTITIES.implementation,
    EULER_V2_ETHEREUM_IDENTITIES.evc,
    EULER_V2_ETHEREUM_IDENTITIES.protocolConfig,
    EULER_V2_ETHEREUM_IDENTITIES.sequenceRegistry,
    EULER_V2_ETHEREUM_IDENTITIES.balanceTracker,
    EULER_V2_ETHEREUM_IDENTITIES.permit2,
    EULER_V2_ETHEREUM_IDENTITIES.modules.token,
    EULER_V2_ETHEREUM_IDENTITIES.modules.vault,
    EULER_V2_ETHEREUM_IDENTITIES.modules.borrowing,
    EULER_V2_ETHEREUM_IDENTITIES.modules.governance,
    VAULT,
    USDC,
    ORACLE,
    IRM,
  ])('rejects runtime code drift for %s', async (address) => {
    await expect(
      failRead({
        resultMutator: (rpcRequest, result) =>
          rpcRequest.method === 'eth_getCode' && rpcRequest.params[0] === address
            ? '0x60016001'
            : result,
      }),
    ).rejects.toBeInstanceOf(EulerV2EthereumTranscriptUnavailableError);
  });

  it.each([
    [
      'implementation relation',
      EULER_V2_ETHEREUM_SELECTORS.factoryImplementation,
      addressResult(ORACLE),
    ],
    ['proxy registration', EULER_V2_ETHEREUM_SELECTORS.factoryIsProxy, boolResult(false)],
    [
      'upgradeable proxy',
      EULER_V2_ETHEREUM_SELECTORS.factoryGetProxyConfig,
      proxyConfigResult(true),
    ],
    [
      'proxy implementation',
      EULER_V2_ETHEREUM_SELECTORS.factoryGetProxyConfig,
      proxyConfigResult(false, ORACLE),
    ],
    [
      'proxy metadata',
      EULER_V2_ETHEREUM_SELECTORS.factoryGetProxyConfig,
      proxyConfigResult(
        false,
        EULER_V2_ETHEREUM_IDENTITIES.implementation,
        `${IRM.slice(2)}${ORACLE.slice(2)}${USDC.slice(2)}`,
      ),
    ],
    ['malformed proxy ABI', EULER_V2_ETHEREUM_SELECTORS.factoryGetProxyConfig, '0x00'],
  ])('rejects factory/proxy %s drift', async (_label, selector, result) => {
    await expect(failRead({ resultMutator: mutateCall(selector, result) })).rejects.toBeInstanceOf(
      EulerV2EthereumTranscriptUnavailableError,
    );
  });

  it.each([
    [EULER_V2_ETHEREUM_SELECTORS.asset, addressResult(IRM)],
    [EULER_V2_ETHEREUM_SELECTORS.evc, addressResult(IRM)],
    [EULER_V2_ETHEREUM_SELECTORS.protocolConfigAddress, addressResult(IRM)],
    [EULER_V2_ETHEREUM_SELECTORS.balanceTrackerAddress, addressResult(IRM)],
    [EULER_V2_ETHEREUM_SELECTORS.permit2Address, addressResult(IRM)],
    [EULER_V2_ETHEREUM_SELECTORS.oracle, addressResult(IRM)],
    [EULER_V2_ETHEREUM_SELECTORS.unitOfAccount, addressResult(IRM)],
    [EULER_V2_ETHEREUM_SELECTORS.interestRateModel, addressResult(ORACLE)],
    [EULER_V2_ETHEREUM_SELECTORS.moduleToken, addressResult(IRM)],
    [EULER_V2_ETHEREUM_SELECTORS.moduleVault, addressResult(IRM)],
    [EULER_V2_ETHEREUM_SELECTORS.moduleBorrowing, addressResult(IRM)],
    [EULER_V2_ETHEREUM_SELECTORS.moduleGovernance, addressResult(IRM)],
  ])('rejects vault identity relation drift for %s', async (selector, result) => {
    await expect(
      failRead({ resultMutator: mutateCall(selector, result, VAULT) }),
    ).rejects.toBeInstanceOf(EulerV2EthereumTranscriptUnavailableError);
  });

  it.each([
    ['vault decimals', VAULT, EULER_V2_ETHEREUM_SELECTORS.decimals, uintResult(18n)],
    ['asset decimals', USDC, EULER_V2_ETHEREUM_SELECTORS.decimals, uintResult(18n)],
    [
      'governor not finalized',
      VAULT,
      EULER_V2_ETHEREUM_SELECTORS.governorAdmin,
      addressResult(PROBE),
    ],
    [
      'hook target installed',
      VAULT,
      EULER_V2_ETHEREUM_SELECTORS.hookConfig,
      twoWordResult(PROBE, 0n),
    ],
    [
      'operation disabled',
      VAULT,
      EULER_V2_ETHEREUM_SELECTORS.hookConfig,
      twoWordResult(ZERO_ADDRESS, 1n),
    ],
    ['config drift', VAULT, EULER_V2_ETHEREUM_SELECTORS.configFlags, uintResult(1n)],
    [
      'cap drift',
      VAULT,
      EULER_V2_ETHEREUM_SELECTORS.caps,
      twoWordResult(SUPPLY_CAP_RAW - 1n, BORROW_CAP_RAW),
    ],
    [
      'unlimited observed cap',
      VAULT,
      EULER_V2_ETHEREUM_SELECTORS.caps,
      twoWordResult(0n, BORROW_CAP_RAW),
    ],
  ])('rejects unsafe configuration: %s', async (_label, to, selector, result) => {
    await expect(
      failRead({ resultMutator: mutateCall(selector, result, to) }),
    ).rejects.toBeInstanceOf(EulerV2EthereumTranscriptUnavailableError);
  });

  it.each([
    ['empty market', EULER_V2_ETHEREUM_SELECTORS.totalAssets, 0n],
    ['zero shares', EULER_V2_ETHEREUM_SELECTORS.totalSupply, 0n],
    ['accounting mismatch', EULER_V2_ETHEREUM_SELECTORS.totalAssets, TOTAL_ASSETS + 1n],
    ['supply cap reached', EULER_V2_ETHEREUM_SELECTORS.totalAssets, 10_000_000n],
    ['borrow cap exceeded', EULER_V2_ETHEREUM_SELECTORS.totalBorrows, 5_000_001n],
    ['uint112 cash overflow', EULER_V2_ETHEREUM_SELECTORS.cash, 1n << 112n],
    ['total assets overflow', EULER_V2_ETHEREUM_SELECTORS.totalAssets, 1n << 113n],
    [
      'conversion formula mismatch',
      EULER_V2_ETHEREUM_SELECTORS.convertToAssets,
      CONVERT_TO_ASSETS + 1n,
    ],
    ['zero conversion', EULER_V2_ETHEREUM_SELECTORS.convertToShares, 0n],
    ['preview mismatch', EULER_V2_ETHEREUM_SELECTORS.previewDeposit, CONVERT_TO_SHARES + 1n],
    ['max deposit mismatch', EULER_V2_ETHEREUM_SELECTORS.maxDeposit, MAX_DEPOSIT + 1n],
    ['zero max deposit', EULER_V2_ETHEREUM_SELECTORS.maxDeposit, 0n],
  ])('rejects numeric/protocol invariant violation: %s', async (_label, selector, value) => {
    await expect(
      failRead({ resultMutator: mutateCall(selector, uintResult(value), VAULT) }),
    ).rejects.toBeInstanceOf(EulerV2EthereumTranscriptUnavailableError);
  });

  it.each([
    ['future block', new Date(1_799_999_999_000)],
    ['stale block at exact bound', new Date(1_800_000_600_000)],
    ['invalid date', new Date(Number.NaN)],
    ['date subclass', new (class extends Date {})(CLOCK.getTime())],
    [
      'custom date prototype',
      Object.setPrototypeOf(new Date(CLOCK.getTime()), Object.create(Date.prototype)),
    ],
  ])('rejects invalid freshness/clock: %s', async (_label, clock) => {
    await expect(failRead({ clock })).rejects.toBeInstanceOf(
      EulerV2EthereumTranscriptUnavailableError,
    );
  });

  it('uses intrinsic Date methods without invoking adversarial instance overrides', async () => {
    const clock = new Date(CLOCK.getTime());
    const getTime = jest.fn(() => Number.NaN);
    const toISOString = jest.fn(() => 'forged');
    Object.defineProperties(clock, {
      getTime: { enumerable: true, value: getTime },
      toISOString: { enumerable: true, value: toISOString },
    });

    await expect(failRead({ clock })).resolves.toMatchObject({
      observedAt: CLOCK.toISOString(),
    });
    expect(getTime).not.toHaveBeenCalled();
    expect(toISOString).not.toHaveBeenCalled();
  });

  it('rejects malformed ABI words and noncanonical numeric encodings', async () => {
    await expect(
      failRead({
        resultMutator: mutateCall(
          EULER_V2_ETHEREUM_SELECTORS.totalAssets,
          `0x${'g'.repeat(64)}`,
          VAULT,
        ),
      }),
    ).rejects.toBeInstanceOf(EulerV2EthereumTranscriptUnavailableError);
  });

  it.each([
    [
      'extra envelope key',
      (_request: EulerV2EthereumJsonRpcRequest, response: Readonly<Record<string, unknown>>) => ({
        ...response,
        unexpected: true,
      }),
    ],
    [
      'wrong response id',
      (_request: EulerV2EthereumJsonRpcRequest, response: Readonly<Record<string, unknown>>) => ({
        ...response,
        id: 999,
      }),
    ],
    ['array envelope', () => []],
  ])('rejects malformed JSON-RPC data: %s', async (_label, responseMutator) => {
    await expect(
      failRead({ responseMutator: responseMutator as ResponseMutator }),
    ).rejects.toBeInstanceOf(EulerV2EthereumTranscriptUnavailableError);
  });

  it.each([
    ['unknown header field', { ...BLOCK, unexpected: true }],
    ['noncanonical block number', { ...BLOCK, number: '0x0123' }],
    ['zero state root', { ...BLOCK, stateRoot: `0x${'00'.repeat(32)}` }],
    [
      'missing timestamp',
      {
        number: BLOCK.number,
        hash: BLOCK.hash,
        parentHash: BLOCK.parentHash,
        stateRoot: BLOCK.stateRoot,
      },
    ],
  ])('rejects malformed finalized header: %s', async (_label, header) => {
    await expect(
      failRead({
        resultMutator: (rpcRequest, result) =>
          rpcRequest.method === 'eth_getBlockByNumber' && rpcRequest.params[0] === 'finalized'
            ? header
            : result,
      }),
    ).rejects.toBeInstanceOf(EulerV2EthereumTranscriptUnavailableError);
  });

  it('rejects an accessor-bearing RPC envelope without invoking the accessor', async () => {
    let invoked = false;
    const raw = manifestDefinition();
    const manifest = createEulerV2EthereumVaultManifest(raw);
    const transport: EulerV2EthereumJsonRpcTranscriptTransport = {
      async exchange(requestValue) {
        const response: Record<string, unknown> = { jsonrpc: '2.0', id: requestValue.id };
        Object.defineProperty(response, 'result', {
          enumerable: true,
          get() {
            invoked = true;
            return '0x1';
          },
        });
        return response;
      },
    };
    const adapter = new EulerV2EthereumFinalizedTranscriptAdapter(
      raw,
      manifest.manifestFingerprintSha256,
      transport,
      { now: () => CLOCK },
    );
    await expect(adapter.read(request())).rejects.toBeInstanceOf(
      EulerV2EthereumTranscriptUnavailableError,
    );
    expect(invoked).toBe(false);
  });

  it('rejects oversized response data and sanitizes transport failures', async () => {
    await expect(
      failRead({
        resultMutator: (rpcRequest, result) =>
          rpcRequest.method === 'eth_chainId' ? 'x'.repeat(2 * 1024 * 1024 + 1) : result,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'EulerV2EthereumTranscriptUnavailableError',
        message: 'Euler V2 Ethereum transcript is unavailable',
      }),
    );

    const raw = manifestDefinition();
    const manifest = createEulerV2EthereumVaultManifest(raw);
    const adapter = new EulerV2EthereumFinalizedTranscriptAdapter(
      raw,
      manifest.manifestFingerprintSha256,
      {
        exchange: async () => {
          throw new Error('secret endpoint token');
        },
      },
      { now: () => CLOCK },
    );
    await expect(adapter.read(request())).rejects.toEqual(
      expect.objectContaining({
        message: 'Euler V2 Ethereum transcript is unavailable',
      }),
    );
  });

  it('rejects accessor-bearing manifest data without invoking it', () => {
    let invoked = false;
    const raw = manifestDefinition();
    Object.defineProperty(raw.vault, 'marketId', {
      enumerable: true,
      get() {
        invoked = true;
        return `euler-v2-ethereum-mainnet:${VAULT}`;
      },
    });
    expect(() => createEulerV2EthereumVaultManifest(raw)).toThrow(
      EulerV2EthereumTranscriptUnavailableError,
    );
    expect(invoked).toBe(false);
  });
});
