import { keccak256 } from 'viem';

import { isAllowedChainObservationMethod } from '../../../blockchain/domain/chain-observation-policy';
import type { ReadAaveV3EthereumDeploymentEvidenceRequest } from '../../application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import {
  type AaveV3EthereumFinalizedRpcSource,
  type ReadAaveV3EthereumFinalizedRpcObservationRequest,
} from './aave-v3-ethereum-finalized-rpc.source';
import {
  AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN,
  AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
  AaveV3EthereumDeploymentEvidenceAdapter,
  AaveV3EthereumDeploymentEvidenceUnavailableError,
} from './aave-v3-ethereum-deployment-evidence.adapter';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST } from './aave-v3-ethereum-deployment.manifest';

const EVALUATED_AT = '2026-09-03T18:00:00.000Z';
const CORRELATION_ID = '550e8400-e29b-41d4-a716-446655440000';
const HASH = `0x${'11'.repeat(32)}`;
const PARENT_HASH = `0x${'22'.repeat(32)}`;
const STATE_ROOT = `0x${'33'.repeat(32)}`;
const BYTECODE = '0x60006000556001600055';
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;

function addressWord(value: string): string {
  return `0x${'0'.repeat(24)}${value.slice(2).toLowerCase()}`;
}

function addressCalldata(selector: string, address: string): string {
  return `${selector}${addressWord(address).slice(2)}`;
}

function reserveTuple(
  aToken: string,
  variableDebtToken: string,
  stableDebtToken = ZERO_ADDRESS,
): string {
  return `0x${addressWord(aToken).slice(2)}${addressWord(stableDebtToken).slice(2)}${addressWord(variableDebtToken).slice(2)}`;
}

function finalizedBlock(): Record<string, unknown> {
  return {
    number: '0x1312d00',
    hash: HASH,
    parentHash: PARENT_HASH,
    stateRoot: STATE_ROOT,
    timestamp: `0x${Math.floor(Date.parse('2026-09-03T17:59:00.000Z') / 1_000).toString(16)}`,
  };
}

function response(): Record<string, unknown> {
  const manifest = AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST;
  return {
    schemaVersion: 1,
    sourceReferenceId: 'rpc-primary:ethereum-mainnet',
    sourceObservationId: 'observation:00000001',
    networkId: 'eip155:1',
    chainId: '0x1',
    blockSelector: 'finalized',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    manifestFingerprintSha256: manifest.manifestFingerprintSha256,
    assetRegistryFingerprintSha256:
      AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.assetRegistryFingerprintSha256,
    readPlanFingerprintSha256: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
    finalizedBlockBefore: finalizedBlock(),
    finalizedBlockAfter: finalizedBlock(),
    operationBlockBindings: Object.fromEntries(
      AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN.operations.map(({ operationId }) => [
        operationId,
        { blockHash: HASH, requireCanonical: true },
      ]),
    ),
    code: {
      poolAddressesProvider: BYTECODE,
      poolProxy: BYTECODE,
      poolImplementation: BYTECODE,
      protocolDataProvider: BYTECODE,
      usdcAToken: BYTECODE,
      usdcVariableDebtToken: BYTECODE,
      usdtAToken: BYTECODE,
      usdtVariableDebtToken: BYTECODE,
    },
    calls: {
      providerGetPool: addressWord(manifest.contracts.poolProxy),
      providerGetPoolDataProvider: addressWord(manifest.contracts.protocolDataProvider),
      poolAddressesProvider: addressWord(manifest.contracts.poolAddressesProvider),
      dataProviderAddressesProvider: addressWord(manifest.contracts.poolAddressesProvider),
      dataProviderPool: addressWord(manifest.contracts.poolProxy),
      poolImplementationFromAdmin: addressWord(manifest.contracts.poolImplementation),
      usdcReserveTokens: reserveTuple(
        manifest.assets.USDC.aToken,
        manifest.assets.USDC.variableDebtToken,
      ),
      usdtReserveTokens: reserveTuple(
        manifest.assets.USDT.aToken,
        manifest.assets.USDT.variableDebtToken,
      ),
    },
  };
}

function clone(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

function sourceReturning(value: unknown): {
  readonly source: AaveV3EthereumFinalizedRpcSource;
  readonly read: jest.Mock<Promise<unknown>, [ReadAaveV3EthereumFinalizedRpcObservationRequest]>;
} {
  const read = jest.fn<Promise<unknown>, [ReadAaveV3EthereumFinalizedRpcObservationRequest]>(() =>
    Promise.resolve(value),
  );
  return { source: { readFinalizedDeployment: read }, read };
}

function validRequest(): ReadAaveV3EthereumDeploymentEvidenceRequest {
  return { evaluatedAt: EVALUATED_AT, correlationId: CORRELATION_ID };
}

async function expectUnavailable(
  adapter: AaveV3EthereumDeploymentEvidenceAdapter,
  request: ReadAaveV3EthereumDeploymentEvidenceRequest = validRequest(),
): Promise<AaveV3EthereumDeploymentEvidenceUnavailableError> {
  let captured: unknown;
  try {
    await adapter.readCurrentDeploymentEvidence(request);
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(AaveV3EthereumDeploymentEvidenceUnavailableError);
  expect(captured).toMatchObject({
    code: 'AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_UNAVAILABLE',
    message: 'Aave V3 Ethereum deployment evidence is unavailable',
  });
  return captured as AaveV3EthereumDeploymentEvidenceUnavailableError;
}

describe('Aave V3 Ethereum finalized deployment evidence adapter', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('exports one frozen, read-only, canonical-block-bound RPC plan', () => {
    const plan = AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN;
    expect(plan).toMatchObject({
      schemaVersion: 1,
      networkId: 'eip155:1',
      expectedChainId: '0x1',
      blockSelector: 'finalized',
      blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
      blockAcquisition: {
        initialMethod: 'eth_getBlockByNumber',
        initialSelector: 'finalized',
        includeTransactions: false,
        stateReadParameter: 'CAPTURED_BLOCK_HASH_REQUIRE_CANONICAL',
        consistencyRecheckMethod: 'eth_getBlockByNumber',
        consistencyRecheckSelector: 'CAPTURED_BLOCK_NUMBER',
      },
      maximumAggregateResponseBytes: 1_048_576,
      expectedRpcCallCount: 19,
      manifestFingerprintSha256: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.manifestFingerprintSha256,
      requiredMethods: ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'],
    });
    expect(plan.operations).toHaveLength(16);
    expect(new Set(plan.operations.map(({ operationId }) => operationId)).size).toBe(16);
    const manifest = AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST;
    expect(
      plan.operations.map(({ operationId, method, target }) => [operationId, method, target]),
    ).toEqual([
      ['code:pool-addresses-provider', 'eth_getCode', manifest.contracts.poolAddressesProvider],
      ['code:pool-proxy', 'eth_getCode', manifest.contracts.poolProxy],
      ['code:pool-implementation', 'eth_getCode', manifest.contracts.poolImplementation],
      ['code:protocol-data-provider', 'eth_getCode', manifest.contracts.protocolDataProvider],
      ['code:usdc-atoken', 'eth_getCode', manifest.assets.USDC.aToken],
      ['code:usdc-variable-debt-token', 'eth_getCode', manifest.assets.USDC.variableDebtToken],
      ['code:usdt-atoken', 'eth_getCode', manifest.assets.USDT.aToken],
      ['code:usdt-variable-debt-token', 'eth_getCode', manifest.assets.USDT.variableDebtToken],
      ['call:provider-get-pool', 'eth_call', manifest.contracts.poolAddressesProvider],
      ['call:provider-get-data-provider', 'eth_call', manifest.contracts.poolAddressesProvider],
      ['call:pool-addresses-provider', 'eth_call', manifest.contracts.poolProxy],
      [
        'call:data-provider-addresses-provider',
        'eth_call',
        manifest.contracts.protocolDataProvider,
      ],
      ['call:data-provider-pool', 'eth_call', manifest.contracts.protocolDataProvider],
      ['call:pool-implementation-from-admin', 'eth_call', manifest.contracts.poolProxy],
      ['call:usdc-reserve-tokens', 'eth_call', manifest.contracts.protocolDataProvider],
      ['call:usdt-reserve-tokens', 'eth_call', manifest.contracts.protocolDataProvider],
    ]);
    expect(
      Object.fromEntries(
        plan.operations
          .filter(({ method }) => method === 'eth_call')
          .map(({ operationId, calldata: data }) => [operationId, data]),
      ),
    ).toEqual({
      'call:provider-get-pool': manifest.selectors.getPool,
      'call:provider-get-data-provider': manifest.selectors.getPoolDataProvider,
      'call:pool-addresses-provider': manifest.selectors.addressesProvider,
      'call:data-provider-addresses-provider': manifest.selectors.addressesProvider,
      'call:data-provider-pool': manifest.selectors.pool,
      'call:pool-implementation-from-admin': manifest.selectors.implementation,
      'call:usdc-reserve-tokens': addressCalldata(
        manifest.selectors.getReserveTokensAddresses,
        manifest.assets.USDC.underlyingAsset,
      ),
      'call:usdt-reserve-tokens': addressCalldata(
        manifest.selectors.getReserveTokensAddresses,
        manifest.assets.USDT.underlyingAsset,
      ),
    });
    expect(
      plan.operations.find(
        ({ operationId }) => operationId === 'call:pool-implementation-from-admin',
      ),
    ).toEqual({
      operationId: 'call:pool-implementation-from-admin',
      method: 'eth_call',
      target: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.contracts.poolProxy.toLowerCase(),
      blockParameter: {
        blockHash: 'CAPTURED_FINALIZED_BLOCK_HASH',
        requireCanonical: true,
      },
      calldata: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.selectors.implementation,
      from: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.contracts.poolAddressesProvider.toLowerCase(),
    });
    expect(
      plan.operations.every(({ method }) => method === 'eth_call' || method === 'eth_getCode'),
    ).toBe(true);
    expect(
      plan.requiredMethods.every((method) => isAllowedChainObservationMethod('eip155:1', method)),
    ).toBe(true);
    expect(
      plan.operations.every(
        ({ blockParameter }) =>
          blockParameter.blockHash === 'CAPTURED_FINALIZED_BLOCK_HASH' &&
          blockParameter.requireCanonical,
      ),
    ).toBe(true);
    expect(JSON.stringify(plan)).not.toMatch(/wallet|sendRaw|eth_send/iu);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.blockAcquisition)).toBe(true);
    expect(Object.isFrozen(plan.operations)).toBe(true);
    expect(plan.operations.every(Object.isFrozen)).toBe(true);
    expect(plan.operations.every(({ blockParameter }) => Object.isFrozen(blockParameter))).toBe(
      true,
    );
    expect(AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256).toBe(
      '332f1ec7b3f5d96ca0631f1de6b7ffbf764a2795abebe8f9d1df60075d374c4f',
    );
  });

  it('normalizes matching deployment topology without granting recommendation or financial authority', async () => {
    const fake = sourceReturning(response());
    const adapter = new AaveV3EthereumDeploymentEvidenceAdapter(fake.source);

    const evidence = await adapter.readCurrentDeploymentEvidence(validRequest());

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      sourceId: 'AAVE_V3_ETHEREUM_FINALIZED_RPC',
      use: 'DEPLOYMENT_CORROBORATION_ONLY',
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      networkId: 'eip155:1',
      chainId: '0x1',
      blockSelector: 'finalized',
      blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
      observedChainIdentityMatchesPolicy: true,
      manifestBindingValidated: true,
      observedDeploymentTopologyMatchesManifest: true,
      blockBindingExecutionStatus: 'SOURCE_ATTESTED_UNVERIFIED',
      runtimeCodeApprovalStatus: 'UNVERIFIED',
      sourceProviderApproved: false,
      exactHostEgressApproved: false,
      liveCapabilityProofValidated: false,
      independentFinalizedSourcesAgree: false,
      freshnessStatus: 'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT',
      finalityStatus: 'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF',
      observedAt: EVALUATED_AT,
      finalizedBlock: {
        number: BigInt('0x1312d00'),
        hash: HASH,
        parentHash: PARENT_HASH,
        stateRoot: STATE_ROOT,
        timestamp: '2026-09-03T17:59:00.000Z',
      },
    });
    expect(evidence.runtimeCodeKeccak256).toEqual({
      poolAddressesProvider: keccak256(BYTECODE),
      poolProxy: keccak256(BYTECODE),
      poolImplementation: keccak256(BYTECODE),
      protocolDataProvider: keccak256(BYTECODE),
      usdcAToken: keccak256(BYTECODE),
      usdcVariableDebtToken: keccak256(BYTECODE),
      usdtAToken: keccak256(BYTECODE),
      usdtVariableDebtToken: keccak256(BYTECODE),
    });
    expect(evidence.reserves.USDC).toEqual({
      underlyingAsset:
        AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDC.underlyingAsset.toLowerCase(),
      aToken: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDC.aToken.toLowerCase(),
      stableDebtToken: ZERO_ADDRESS,
      variableDebtToken:
        AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDC.variableDebtToken.toLowerCase(),
    });
    expect(evidence.evidenceFingerprintSha256).toBe(
      '85c7abf276952939b7881cf31d1b7764064a20e952c334d7c52f52792e2f1f97',
    );
    expect(evidence.evidenceId).toBe(
      `aave-v3-ethereum-deployment:${evidence.evidenceFingerprintSha256}`,
    );
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.runtimeCodeKeccak256)).toBe(true);
    expect(Object.isFrozen(evidence.reserves)).toBe(true);
    expect(Object.isFrozen(evidence.reserves.USDC)).toBe(true);

    expect(fake.read).toHaveBeenCalledTimes(1);
    const sourceRequest = fake.read.mock.calls[0]?.[0];
    expect(sourceRequest?.correlationId).toBe(CORRELATION_ID);
    expect(sourceRequest?.deadlineAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(sourceRequest?.plan).toBe(AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN);
    expect(Object.isFrozen(sourceRequest)).toBe(true);
    expect(sourceRequest?.signal.aborted).toBe(true);
  });

  it.each([
    [
      'wrong chain identity',
      (input: Record<string, unknown>) => {
        input.chainId = '0x2105';
      },
    ],
    [
      'changed post-read block',
      (input: Record<string, unknown>) => {
        (input.finalizedBlockAfter as Record<string, unknown>).hash = `0x${'44'.repeat(32)}`;
      },
    ],
    [
      'future finalized block',
      (input: Record<string, unknown>) => {
        (input.finalizedBlockBefore as Record<string, unknown>).timestamp = '0xffffffff';
        (input.finalizedBlockAfter as Record<string, unknown>).timestamp = '0xffffffff';
      },
    ],
    [
      'zero finalized block hashes',
      (input: Record<string, unknown>) => {
        for (const key of ['finalizedBlockBefore', 'finalizedBlockAfter']) {
          const candidate = input[key] as Record<string, unknown>;
          candidate.hash = `0x${'0'.repeat(64)}`;
        }
      },
    ],
    [
      'zero finalized state root',
      (input: Record<string, unknown>) => {
        for (const key of ['finalizedBlockBefore', 'finalizedBlockAfter']) {
          const candidate = input[key] as Record<string, unknown>;
          candidate.stateRoot = `0x${'0'.repeat(64)}`;
        }
      },
    ],
    [
      'self-parented finalized block',
      (input: Record<string, unknown>) => {
        for (const key of ['finalizedBlockBefore', 'finalizedBlockAfter']) {
          const candidate = input[key] as Record<string, unknown>;
          candidate.parentHash = HASH;
        }
      },
    ],
    [
      'pre-genesis finalized timestamp',
      (input: Record<string, unknown>) => {
        for (const key of ['finalizedBlockBefore', 'finalizedBlockAfter']) {
          const candidate = input[key] as Record<string, unknown>;
          candidate.timestamp = '0x1';
        }
      },
    ],
    [
      'oversized finalized block number',
      (input: Record<string, unknown>) => {
        for (const key of ['finalizedBlockBefore', 'finalizedBlockAfter']) {
          const candidate = input[key] as Record<string, unknown>;
          candidate.number = '0x10000000000000000';
        }
      },
    ],
    [
      'unbound read plan',
      (input: Record<string, unknown>) => {
        input.readPlanFingerprintSha256 = '0'.repeat(64);
      },
    ],
    [
      'operation bound to a different block',
      (input: Record<string, unknown>) => {
        const bindings = input.operationBlockBindings as Record<string, unknown>;
        (bindings['code:pool-proxy'] as Record<string, unknown>).blockHash = `0x${'55'.repeat(32)}`;
      },
    ],
    [
      'missing contract code',
      (input: Record<string, unknown>) => {
        (input.code as Record<string, unknown>).poolProxy = '0x';
      },
    ],
    [
      'wrong provider/pool relationship',
      (input: Record<string, unknown>) => {
        (input.calls as Record<string, unknown>).providerGetPool = addressWord(ZERO_ADDRESS);
      },
    ],
    [
      'noncanonical ABI address padding',
      (input: Record<string, unknown>) => {
        (input.calls as Record<string, unknown>).providerGetPool = `0x${'f'.repeat(64)}`;
      },
    ],
    [
      'short reserve tuple',
      (input: Record<string, unknown>) => {
        const calls = input.calls as Record<string, unknown>;
        calls.usdtReserveTokens = String(calls.usdtReserveTokens).slice(0, -2);
      },
    ],
    [
      'long reserve tuple',
      (input: Record<string, unknown>) => {
        const calls = input.calls as Record<string, unknown>;
        calls.usdtReserveTokens = `${String(calls.usdtReserveTokens)}00`;
      },
    ],
    [
      'wrong active implementation',
      (input: Record<string, unknown>) => {
        (input.calls as Record<string, unknown>).poolImplementationFromAdmin =
          addressWord(ZERO_ADDRESS);
      },
    ],
    [
      'wrong immutable data-provider pool',
      (input: Record<string, unknown>) => {
        (input.calls as Record<string, unknown>).dataProviderPool = addressWord(ZERO_ADDRESS);
      },
    ],
    [
      'wrong reserve token relationship',
      (input: Record<string, unknown>) => {
        (input.calls as Record<string, unknown>).usdcReserveTokens = reserveTuple(
          AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDT.aToken,
          AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDC.variableDebtToken,
        );
      },
    ],
    [
      'nonzero deprecated stable-debt token',
      (input: Record<string, unknown>) => {
        (input.calls as Record<string, unknown>).usdcReserveTokens = reserveTuple(
          AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDC.aToken,
          AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDC.variableDebtToken,
          AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDT.aToken,
        );
      },
    ],
    [
      'unexpected executable-looking field',
      (input: Record<string, unknown>) => {
        input.transaction = null;
      },
    ],
  ])('rejects %s', async (_name, mutate) => {
    const input = clone(response());
    mutate(input);
    await expectUnavailable(
      new AaveV3EthereumDeploymentEvidenceAdapter(sourceReturning(input).source),
    );
  });

  it('does not invoke accessors and sanitizes proxy metadata traps', async () => {
    const accessor = response();
    const getter = jest.fn(() => '0x1');
    Object.defineProperty(accessor, 'chainId', { enumerable: true, get: getter });
    await expectUnavailable(
      new AaveV3EthereumDeploymentEvidenceAdapter(sourceReturning(accessor).source),
    );
    expect(getter).not.toHaveBeenCalled();

    const proxy = new Proxy(response(), {
      ownKeys: () => {
        throw new Error('proxy trap');
      },
    });
    await expectUnavailable(
      new AaveV3EthereumDeploymentEvidenceAdapter(sourceReturning(proxy).source),
    );
  });

  it('rejects malformed requests before contacting the source', async () => {
    const fake = sourceReturning(response());
    const adapter = new AaveV3EthereumDeploymentEvidenceAdapter(fake.source);

    await expectUnavailable(adapter, {
      evaluatedAt: '2026-09-03T18:00:00Z',
      correlationId: CORRELATION_ID,
    });
    await expectUnavailable(adapter, {
      evaluatedAt: EVALUATED_AT,
      correlationId: 'not-a-uuid',
    });
    await expectUnavailable(adapter, {
      ...validRequest(),
      extra: true,
    } as ReadAaveV3EthereumDeploymentEvidenceRequest);

    const accessor = validRequest();
    const getter = jest.fn(() => EVALUATED_AT);
    Object.defineProperty(accessor, 'evaluatedAt', { enumerable: true, get: getter });
    await expectUnavailable(adapter, accessor);
    expect(getter).not.toHaveBeenCalled();

    await expectUnavailable(
      adapter,
      new Proxy(validRequest(), {
        ownKeys: () => {
          throw new Error('request proxy trap');
        },
      }),
    );
    expect(fake.read).not.toHaveBeenCalled();
  });

  it('aborts an unresponsive source at the closed deadline and sanitizes the timeout', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(EVALUATED_AT));
    let sourceRequest: ReadAaveV3EthereumFinalizedRpcObservationRequest | undefined;
    const source: AaveV3EthereumFinalizedRpcSource = {
      readFinalizedDeployment: jest.fn((request) => {
        sourceRequest = request;
        return new Promise<never>(() => undefined);
      }),
    };
    const pending = new AaveV3EthereumDeploymentEvidenceAdapter(
      source,
    ).readCurrentDeploymentEvidence(validRequest());
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_UNAVAILABLE',
      message: 'Aave V3 Ethereum deployment evidence is unavailable',
    });
    expect(sourceRequest?.signal.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(5_000);
    await rejection;
    expect(sourceRequest?.deadlineAt).toBe('2026-09-03T18:00:05.000Z');
    expect(sourceRequest?.signal.aborted).toBe(true);
  });

  it('rejects a source result that arrives exactly at the closed deadline', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(EVALUATED_AT));
    const source: AaveV3EthereumFinalizedRpcSource = {
      readFinalizedDeployment: jest.fn(() => {
        jest.setSystemTime(new Date('2026-09-03T18:00:05.000Z'));
        return Promise.resolve(response());
      }),
    };

    await expectUnavailable(new AaveV3EthereumDeploymentEvidenceAdapter(source));
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sanitizes source failures and returns a fresh public error each time', async () => {
    const source: AaveV3EthereumFinalizedRpcSource = {
      readFinalizedDeployment: jest.fn(() => Promise.reject(new Error('secret provider host'))),
    };
    const adapter = new AaveV3EthereumDeploymentEvidenceAdapter(source);
    const first = await expectUnavailable(adapter);
    const second = await expectUnavailable(adapter);

    expect(first).not.toBe(second);
    expect(first.message).not.toContain('secret');
    expect(first).not.toHaveProperty('cause');
  });

  it('binds a deterministic, domain-separated fingerprint to semantic evidence fields', async () => {
    const first = await new AaveV3EthereumDeploymentEvidenceAdapter(
      sourceReturning(response()).source,
    ).readCurrentDeploymentEvidence(validRequest());
    const identical = await new AaveV3EthereumDeploymentEvidenceAdapter(
      sourceReturning(response()).source,
    ).readCurrentDeploymentEvidence(validRequest());
    const later = await new AaveV3EthereumDeploymentEvidenceAdapter(
      sourceReturning(response()).source,
    ).readCurrentDeploymentEvidence({
      ...validRequest(),
      evaluatedAt: '2026-09-03T18:00:01.000Z',
    });
    const changedResponse = response();
    (changedResponse.code as Record<string, unknown>).poolImplementation = '0x6001';
    const changed = await new AaveV3EthereumDeploymentEvidenceAdapter(
      sourceReturning(changedResponse).source,
    ).readCurrentDeploymentEvidence(validRequest());
    const changedSourceResponse = response();
    changedSourceResponse.sourceReferenceId = 'rpc-secondary:ethereum-mainnet';
    const changedSource = await new AaveV3EthereumDeploymentEvidenceAdapter(
      sourceReturning(changedSourceResponse).source,
    ).readCurrentDeploymentEvidence(validRequest());
    const changedBlockResponse = response();
    const changedBlockHash = `0x${'44'.repeat(32)}`;
    for (const key of ['finalizedBlockBefore', 'finalizedBlockAfter']) {
      const candidate = changedBlockResponse[key] as Record<string, unknown>;
      candidate.number = '0x1312d01';
      candidate.hash = changedBlockHash;
      candidate.parentHash = HASH;
      candidate.stateRoot = `0x${'66'.repeat(32)}`;
    }
    for (const binding of Object.values(
      changedBlockResponse.operationBlockBindings as Record<string, Record<string, unknown>>,
    )) {
      binding.blockHash = changedBlockHash;
    }
    const changedBlock = await new AaveV3EthereumDeploymentEvidenceAdapter(
      sourceReturning(changedBlockResponse).source,
    ).readCurrentDeploymentEvidence(validRequest());

    expect(identical.evidenceFingerprintSha256).toBe(first.evidenceFingerprintSha256);
    expect(later.evidenceFingerprintSha256).not.toBe(first.evidenceFingerprintSha256);
    expect(changed.evidenceFingerprintSha256).not.toBe(first.evidenceFingerprintSha256);
    expect(changedSource.evidenceFingerprintSha256).not.toBe(first.evidenceFingerprintSha256);
    expect(changedBlock.evidenceFingerprintSha256).not.toBe(first.evidenceFingerprintSha256);
  });
});
