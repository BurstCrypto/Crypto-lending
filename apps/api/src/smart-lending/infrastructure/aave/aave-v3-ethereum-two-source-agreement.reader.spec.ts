import { CHAIN_OBSERVATION_REGISTRY_BINDINGS } from '../../../blockchain/domain/chain-observation-policy';
import type { AaveV3EthereumDeploymentEvidenceReader } from '../../application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import type {
  AaveV3EthereumDeploymentEvidence,
  AaveV3EthereumObservedRuntimeCodeHashes,
  ReadAaveV3EthereumDeploymentEvidenceRequest,
} from '../../application/ports/aave-v3-ethereum-deployment-evidence-reader.port';
import { fingerprintAaveV3EthereumDeploymentEvidence } from '../../domain/aave-v3-ethereum-deployment-evidence-fingerprint';
import { AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST } from './aave-v3-ethereum-deployment.manifest';
import { AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256 } from './aave-v3-ethereum-finalized-rpc.plan';
import {
  AaveV3EthereumDeploymentAgreementUnavailableError,
  AaveV3EthereumTwoSourceAgreementReader,
} from './aave-v3-ethereum-two-source-agreement.reader';

const EVALUATED_AT = '2026-09-04T18:00:00.000Z';
const REQUEST = Object.freeze({
  evaluatedAt: EVALUATED_AT,
  correlationId: '00000000-0000-4000-8000-000000000001',
}) satisfies ReadAaveV3EthereumDeploymentEvidenceRequest;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}` as const;

function hash(character: string): `0x${string}` {
  return `0x${character.repeat(64)}`;
}

function runtimeCodeHashes(): AaveV3EthereumObservedRuntimeCodeHashes {
  return Object.freeze({
    poolAddressesProvider: hash('1'),
    poolProxy: hash('2'),
    poolImplementation: hash('3'),
    protocolDataProvider: hash('4'),
    usdcAToken: hash('5'),
    usdcVariableDebtToken: hash('6'),
    usdtAToken: hash('7'),
    usdtVariableDebtToken: hash('8'),
  });
}

function evidence(
  source: 'primary' | 'corroborating',
  overrides: Partial<AaveV3EthereumDeploymentEvidence> = {},
): AaveV3EthereumDeploymentEvidence {
  const placeholderFingerprintSha256 = '0'.repeat(64);
  const candidate = {
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
    sourceReferenceId: `rpc-${source}`,
    sourceObservationId: `observation-${source}`,
    deploymentManifestFingerprintSha256:
      AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.manifestFingerprintSha256,
    assetRegistryFingerprintSha256: CHAIN_OBSERVATION_REGISTRY_BINDINGS.MAINNET.fingerprintSha256,
    readPlanFingerprintSha256: AAVE_V3_ETHEREUM_FINALIZED_RPC_READ_PLAN_FINGERPRINT_SHA256,
    evidenceFingerprintSha256: placeholderFingerprintSha256,
    evidenceId: `aave-v3-ethereum-deployment:${placeholderFingerprintSha256}`,
    observedAt: EVALUATED_AT,
    finalizedBlock: Object.freeze({
      number: 22_000_000n,
      hash: hash('a'),
      parentHash: hash('b'),
      stateRoot: hash('c'),
      timestamp: '2026-09-04T17:59:00.000Z',
    }),
    runtimeCodeKeccak256: runtimeCodeHashes(),
    reserves: Object.freeze({
      USDC: Object.freeze({
        underlyingAsset: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDC.underlyingAsset,
        aToken: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDC.aToken,
        stableDebtToken: ZERO_ADDRESS,
        variableDebtToken: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDC.variableDebtToken,
      }),
      USDT: Object.freeze({
        underlyingAsset: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDT.underlyingAsset,
        aToken: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDT.aToken,
        stableDebtToken: ZERO_ADDRESS,
        variableDebtToken: AAVE_V3_ETHEREUM_DEPLOYMENT_MANIFEST.assets.USDT.variableDebtToken,
      }),
    }),
    ...overrides,
  } as AaveV3EthereumDeploymentEvidence;
  const computedFingerprint = fingerprintAaveV3EthereumDeploymentEvidence(
    candidate,
    candidate.observedAt,
  );
  const evidenceFingerprintSha256 = Object.hasOwn(overrides, 'evidenceFingerprintSha256')
    ? candidate.evidenceFingerprintSha256
    : computedFingerprint;
  const evidenceId = Object.hasOwn(overrides, 'evidenceId')
    ? candidate.evidenceId
    : `aave-v3-ethereum-deployment:${evidenceFingerprintSha256}`;
  return Object.freeze({
    ...candidate,
    evidenceFingerprintSha256,
    evidenceId,
  });
}

function sourceReader(
  value: AaveV3EthereumDeploymentEvidence | Promise<AaveV3EthereumDeploymentEvidence>,
): {
  readonly reader: AaveV3EthereumDeploymentEvidenceReader;
  readonly read: jest.Mock;
} {
  const read = jest.fn(() => Promise.resolve(value));
  return {
    reader: { readCurrentDeploymentEvidence: read },
    read,
  };
}

function coordinator(
  primaryValue: AaveV3EthereumDeploymentEvidence = evidence('primary'),
  corroboratingValue: AaveV3EthereumDeploymentEvidence = evidence('corroborating'),
): {
  readonly reader: AaveV3EthereumTwoSourceAgreementReader;
  readonly primary: ReturnType<typeof sourceReader>;
  readonly corroborating: ReturnType<typeof sourceReader>;
} {
  const primary = sourceReader(primaryValue);
  const corroborating = sourceReader(corroboratingValue);
  return {
    reader: new AaveV3EthereumTwoSourceAgreementReader(primary.reader, corroborating.reader),
    primary,
    corroborating,
  };
}

async function expectUnavailable(promise: Promise<unknown>): Promise<Error> {
  let captured: unknown;
  try {
    await promise;
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(AaveV3EthereumDeploymentAgreementUnavailableError);
  expect(captured).toMatchObject({
    name: 'AaveV3EthereumDeploymentAgreementUnavailableError',
    code: 'AAVE_V3_ETHEREUM_DEPLOYMENT_AGREEMENT_UNAVAILABLE',
    message: 'Aave V3 Ethereum deployment agreement is unavailable',
  });
  return captured as Error;
}

describe('AaveV3EthereumTwoSourceAgreementReader', () => {
  it('compares both readers concurrently under the exact same frozen request', async () => {
    let releasePrimary: ((value: AaveV3EthereumDeploymentEvidence) => void) | undefined;
    const primaryRead = jest.fn((request: ReadAaveV3EthereumDeploymentEvidenceRequest) => {
      void request;
      return new Promise<AaveV3EthereumDeploymentEvidence>((resolve) => {
        releasePrimary = resolve;
      });
    });
    const corroboratingRead = jest.fn((request: ReadAaveV3EthereumDeploymentEvidenceRequest) => {
      void request;
      return Promise.resolve(evidence('corroborating'));
    });
    const reader = new AaveV3EthereumTwoSourceAgreementReader(
      { readCurrentDeploymentEvidence: primaryRead },
      { readCurrentDeploymentEvidence: corroboratingRead },
    );

    const pending = reader.readDeploymentAgreement(REQUEST);
    await Promise.resolve();
    expect(primaryRead).toHaveBeenCalledTimes(1);
    expect(corroboratingRead).toHaveBeenCalledTimes(1);
    expect(primaryRead.mock.calls[0]?.[0]).toBe(corroboratingRead.mock.calls[0]?.[0]);
    expect(Object.isFrozen(primaryRead.mock.calls[0]?.[0])).toBe(true);
    releasePrimary?.(evidence('primary'));

    await expect(pending).resolves.toMatchObject({ comparisonStatus: 'EXACT_PAYLOAD_MATCH' });
  });

  it('reports an exact payload match while keeping every authority gate false or unverified', async () => {
    const result = await coordinator().reader.readDeploymentAgreement(REQUEST);

    expect(result).toMatchObject({
      schemaVersion: 1,
      sourceId: 'AAVE_V3_ETHEREUM_TWO_SOURCE_COMPARISON',
      use: 'DEPLOYMENT_CORROBORATION_ONLY',
      comparisonStatus: 'EXACT_PAYLOAD_MATCH',
      quarantineRequired: false,
      sourcePairProviderApprovalStatus: 'UNVERIFIED',
      sourcePairEgressApprovalStatus: 'UNVERIFIED',
      sourcePairLiveCapabilityProofStatus: 'UNVERIFIED',
      sourcePairIndependenceStatus: 'UNVERIFIED_WITHOUT_APPROVED_PAIR_BINDING',
      blockBindingExecutionStatus: 'SOURCE_ATTESTED_UNVERIFIED',
      runtimeCodeApprovalStatus: 'UNVERIFIED',
      freshnessStatus: 'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT',
      finalityStatus: 'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF',
      independentFinalizedSourcesAgree: false,
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      networkId: 'eip155:1',
      chainId: '0x1',
      correlationId: REQUEST.correlationId,
      evaluatedAt: REQUEST.evaluatedAt,
      primary: { role: 'PRIMARY_CANDIDATE', sourceReferenceId: 'rpc-primary' },
      corroborating: {
        role: 'CORROBORATING_CANDIDATE',
        sourceReferenceId: 'rpc-corroborating',
      },
    });
    expect(result.matchedDeploymentStateFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.primary.deploymentStateFingerprintSha256).toBe(
      result.corroborating.deploymentStateFingerprintSha256,
    );
    expect(result.comparisonFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.comparisonId).toBe(
      `aave-v3-ethereum-two-source-comparison:${result.comparisonFingerprintSha256}`,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.primary)).toBe(true);
    expect(Object.isFrozen(result.primary.finalizedBlock)).toBe(true);
  });

  it('treats different finalized heights as temporary non-alignment, not agreement or divergence', async () => {
    const corroborating = evidence('corroborating', {
      finalizedBlock: Object.freeze({
        ...evidence('corroborating').finalizedBlock,
        number: 21_999_999n,
      }),
    });
    const result = await coordinator(
      evidence('primary'),
      corroborating,
    ).reader.readDeploymentAgreement(REQUEST);

    expect(result).toMatchObject({
      comparisonStatus: 'BLOCKED_NOT_ALIGNED',
      quarantineRequired: false,
      independentFinalizedSourcesAgree: false,
      matchedDeploymentStateFingerprintSha256: null,
    });
  });

  it.each([
    ['hash', hash('d')],
    ['parentHash', hash('d')],
    ['stateRoot', hash('d')],
    ['timestamp', '2026-09-04T17:58:59.000Z'],
  ] as const)('quarantines same-height finalized %s divergence', async (field, value) => {
    const base = evidence('corroborating');
    const result = await coordinator(
      evidence('primary'),
      evidence('corroborating', {
        finalizedBlock: Object.freeze({ ...base.finalizedBlock, [field]: value }),
      }),
    ).reader.readDeploymentAgreement(REQUEST);

    expect(result).toMatchObject({
      comparisonStatus: 'QUARANTINED_FINALIZED_HEADER_DIVERGENCE',
      quarantineRequired: true,
      independentFinalizedSourcesAgree: false,
      matchedDeploymentStateFingerprintSha256: null,
    });
  });

  it.each([
    'poolAddressesProvider',
    'poolProxy',
    'poolImplementation',
    'protocolDataProvider',
    'usdcAToken',
    'usdcVariableDebtToken',
    'usdtAToken',
    'usdtVariableDebtToken',
  ] as const)('quarantines exact-block %s runtime-code divergence', async (field) => {
    const base = evidence('corroborating');
    const result = await coordinator(
      evidence('primary'),
      evidence('corroborating', {
        runtimeCodeKeccak256: Object.freeze({
          ...base.runtimeCodeKeccak256,
          [field]: hash('9'),
        }),
      }),
    ).reader.readDeploymentAgreement(REQUEST);

    expect(result).toMatchObject({
      comparisonStatus: 'QUARANTINED_DEPLOYMENT_STATE_DIVERGENCE',
      quarantineRequired: true,
      independentFinalizedSourcesAgree: false,
      matchedDeploymentStateFingerprintSha256: null,
    });
  });

  it.each(['sourceReferenceId', 'sourceObservationId'] as const)(
    'blocks %s reuse instead of mistaking one source for two',
    async (field) => {
      const primary = evidence('primary');
      const primaryValue = primary[field];
      const overrides = { [field]: primaryValue } as Partial<AaveV3EthereumDeploymentEvidence>;
      const result = await coordinator(
        primary,
        evidence('corroborating', overrides),
      ).reader.readDeploymentAgreement(REQUEST);

      expect(result).toMatchObject({
        comparisonStatus: 'BLOCKED_SOURCE_ALIAS_REUSE',
        quarantineRequired: false,
        independentFinalizedSourcesAgree: false,
        matchedDeploymentStateFingerprintSha256: null,
      });
    },
  );

  it('creates deterministic domain-separated comparisons sensitive to source evidence', async () => {
    const first = await coordinator().reader.readDeploymentAgreement(REQUEST);
    const identical = await coordinator().reader.readDeploymentAgreement(REQUEST);
    const changed = await coordinator(
      evidence('primary'),
      evidence('corroborating', {
        sourceObservationId: 'observation-corroborating-second',
      }),
    ).reader.readDeploymentAgreement(REQUEST);

    expect(identical.comparisonFingerprintSha256).toBe(first.comparisonFingerprintSha256);
    expect(changed.comparisonStatus).toBe('EXACT_PAYLOAD_MATCH');
    expect(changed.comparisonFingerprintSha256).not.toBe(first.comparisonFingerprintSha256);
  });

  it('recomputes each single-source fingerprint before comparing matching tampered payloads', async () => {
    const forgedCode = Object.freeze({
      ...runtimeCodeHashes(),
      poolProxy: hash('9'),
    });
    const primary = Object.freeze({
      ...evidence('primary'),
      runtimeCodeKeccak256: forgedCode,
    });
    const corroborating = Object.freeze({
      ...evidence('corroborating'),
      runtimeCodeKeccak256: forgedCode,
    });

    await expectUnavailable(
      coordinator(primary, corroborating).reader.readDeploymentAgreement(REQUEST),
    );
  });

  it('rejects a forged evidence fingerprint even when its evidence ID is internally consistent', async () => {
    const forgedFingerprint = 'f'.repeat(64);
    await expectUnavailable(
      coordinator(
        evidence('primary'),
        evidence('corroborating', {
          evidenceFingerprintSha256: forgedFingerprint,
          evidenceId: `aave-v3-ethereum-deployment:${forgedFingerprint}`,
        }),
      ).reader.readDeploymentAgreement(REQUEST),
    );
  });

  it('rejects an invalid reserve topology rather than comparing unvalidated state', async () => {
    const base = evidence('corroborating');
    await expectUnavailable(
      coordinator(
        evidence('primary'),
        evidence('corroborating', {
          reserves: Object.freeze({
            ...base.reserves,
            USDC: Object.freeze({
              ...base.reserves.USDC,
              aToken: hash('a').slice(0, 42) as `0x${string}`,
            }),
          }),
        }),
      ).reader.readDeploymentAgreement(REQUEST),
    );
  });

  it.each([
    { sourceProviderApproved: true },
    { independentFinalizedSourcesAgree: true },
    { runtimeCodeApprovalStatus: 'APPROVED' },
    { readPlanFingerprintSha256: 'f'.repeat(64) },
    { observedAt: '2026-09-04T17:59:59.999Z' },
  ])('rejects authority or binding drift in either single-source input: %o', async (override) => {
    await expectUnavailable(
      coordinator(
        evidence('primary'),
        evidence('corroborating', override as Partial<AaveV3EthereumDeploymentEvidence>),
      ).reader.readDeploymentAgreement(REQUEST),
    );
  });

  it('rejects malformed requests and hostile evidence shapes with a fixed error', async () => {
    await expectUnavailable(
      coordinator().reader.readDeploymentAgreement({
        ...REQUEST,
        correlationId: 'not-a-correlation-id',
      }),
    );

    const accessor = { ...evidence('corroborating') } as Record<string, unknown>;
    Object.defineProperty(accessor, 'sourceReferenceId', {
      enumerable: true,
      get: () => 'secret-provider-host',
    });
    const bad = sourceReader(accessor as unknown as AaveV3EthereumDeploymentEvidence);
    const primary = sourceReader(evidence('primary'));
    await expectUnavailable(
      new AaveV3EthereumTwoSourceAgreementReader(
        primary.reader,
        bad.reader,
      ).readDeploymentAgreement(REQUEST),
    );
  });

  it('sanitizes reader failures and returns a fresh local error', async () => {
    const primary = sourceReader(evidence('primary'));
    const secretFailure: AaveV3EthereumDeploymentEvidenceReader = {
      readCurrentDeploymentEvidence: jest.fn(() =>
        Promise.reject(new Error('https://credential@secret-provider.example/rpc')),
      ),
    };
    const reader = new AaveV3EthereumTwoSourceAgreementReader(primary.reader, secretFailure);

    const first = await expectUnavailable(reader.readDeploymentAgreement(REQUEST));
    const second = await expectUnavailable(reader.readDeploymentAgreement(REQUEST));
    expect(first).not.toBe(second);
    expect(first.message).not.toContain('secret-provider');
  });

  it('bounds the aggregate comparison deadline even if both readers fail to settle', async () => {
    jest.useFakeTimers();
    try {
      const never = new Promise<AaveV3EthereumDeploymentEvidence>(() => undefined);
      const primary = sourceReader(never);
      const corroborating = sourceReader(never);
      const pending = new AaveV3EthereumTwoSourceAgreementReader(
        primary.reader,
        corroborating.reader,
      ).readDeploymentAgreement(REQUEST);
      const unavailable = expectUnavailable(pending);

      await jest.advanceTimersByTimeAsync(5_000);
      await unavailable;
    } finally {
      jest.useRealTimers();
    }
  });

  it('cleans up its deadline and consumes late reader rejections after timing out', async () => {
    jest.useFakeTimers();
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      let rejectPrimary: ((reason: Error) => void) | undefined;
      let rejectCorroborating: ((reason: Error) => void) | undefined;
      const primaryPromise = new Promise<AaveV3EthereumDeploymentEvidence>((_resolve, reject) => {
        rejectPrimary = reject;
      });
      const corroboratingPromise = new Promise<AaveV3EthereumDeploymentEvidence>(
        (_resolve, reject) => {
          rejectCorroborating = reject;
        },
      );
      const pending = new AaveV3EthereumTwoSourceAgreementReader(
        sourceReader(primaryPromise).reader,
        sourceReader(corroboratingPromise).reader,
      ).readDeploymentAgreement(REQUEST);
      const unavailable = expectUnavailable(pending);

      await jest.advanceTimersByTimeAsync(5_000);
      await unavailable;
      expect(jest.getTimerCount()).toBe(0);

      rejectPrimary?.(new Error('late primary secret'));
      rejectCorroborating?.(new Error('late corroborating secret'));
      await Promise.resolve();
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener('unhandledRejection', unhandled);
      jest.useRealTimers();
    }
  });

  it('rejects obvious same-reader reuse at construction', () => {
    const source = sourceReader(evidence('primary')).reader;
    expect(() => new AaveV3EthereumTwoSourceAgreementReader(source, source)).toThrow(
      AaveV3EthereumDeploymentAgreementUnavailableError,
    );
  });
});
