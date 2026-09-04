import {
  CHAIN_OBSERVATION_NETWORK_POLICIES,
  CHAIN_OBSERVATION_REGISTRY_BINDINGS,
  CHAIN_OBSERVATION_RESILIENCE_POLICY,
  CHAIN_OBSERVATION_TIERS,
  canObservationAuthorizeFinancialUse,
  chainObservationPolicyForNetwork,
  classifyChainObservationFreshness,
  classifyFinalityProgress,
  compareFinalizedSourceCheckpoints,
  decideChainContinuity,
  decideChainObservationFallback,
  isAllowedChainObservationMethod,
  isExpectedChainIdentity,
  observationTierRule,
  type ChainBlockReference,
  type ChainObservationNetworkId,
} from './chain-observation-policy';

const EXPECTED_NETWORKS = [
  'eip155:1',
  'eip155:31337',
  'eip155:11155111',
  'eip155:8453',
  'eip155:84532',
  'eip155:42161',
  'eip155:421614',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
] as const satisfies readonly ChainObservationNetworkId[];

function expectDeepFrozen(value: unknown, seen = new Set<unknown>()): void {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return;
  if (seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) expectDeepFrozen(Reflect.get(value, key), seen);
}

function block(position: bigint, hash: string, parentHash: string): ChainBlockReference {
  return { position, hash, parentHash };
}

describe('chain observation policy', () => {
  it('is deeply immutable and binds exactly to both KAN-61 registry fingerprints and all networks', () => {
    expectDeepFrozen(CHAIN_OBSERVATION_TIERS);
    expectDeepFrozen(CHAIN_OBSERVATION_REGISTRY_BINDINGS);
    expectDeepFrozen(CHAIN_OBSERVATION_RESILIENCE_POLICY);
    expectDeepFrozen(CHAIN_OBSERVATION_NETWORK_POLICIES);

    expect(CHAIN_OBSERVATION_REGISTRY_BINDINGS).toEqual({
      MAINNET: {
        registryVersion: 1,
        fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
        networkIds: [
          'eip155:1',
          'eip155:8453',
          'eip155:42161',
          'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        ],
      },
      TESTNET: {
        registryVersion: 1,
        fingerprintSha256: '89c158de188fcde7d01642aadef226f3c93724bfe5b53a7f3fcce096180d5ca7',
        networkIds: [
          'eip155:11155111',
          'eip155:84532',
          'eip155:421614',
          'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        ],
      },
    });
    expect(CHAIN_OBSERVATION_NETWORK_POLICIES.map(({ networkId }) => networkId).sort()).toEqual(
      [...EXPECTED_NETWORKS].sort(),
    );
    expect(new Set(CHAIN_OBSERVATION_NETWORK_POLICIES.map(({ networkId }) => networkId)).size).toBe(
      9,
    );
  });

  it('keeps the explicit LOCAL_EVM_HARDHAT identity display-only', () => {
    const local = chainObservationPolicyForNetwork('eip155:31337');
    expect(local).toMatchObject({
      environment: 'LOCAL',
      networkId: 'eip155:31337',
      identityProbe: { kind: 'EVM_CHAIN_ID', expectedResult: '0x7a69' },
      registryFingerprintSha256: '3584658754837a75ca0bcb727035c38e382db89641e55311f57f862dee3278dc',
    });
    expect(isExpectedChainIdentity('eip155:31337', '0x7a69')).toBe(true);
    expect(isExpectedChainIdentity('eip155:31337', '0xaa36a7')).toBe(false);
    expect(observationTierRule('eip155:31337', 'PROVISIONAL')).toMatchObject({
      state: 'ALLOWED',
      authority: 'DISPLAY_ONLY',
    });
    expect(observationTierRule('eip155:31337', 'FINANCIAL')).toMatchObject({
      state: 'BLOCKED_PENDING_LIVE_PROOF',
    });
  });

  it('allows only read/confirmation methods and treats WebSocket notifications as hints', () => {
    const ethereum = chainObservationPolicyForNetwork('eip155:1')!;
    const solana = chainObservationPolicyForNetwork('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')!;

    expect(ethereum.identityProbe).toEqual({
      kind: 'EVM_CHAIN_ID',
      method: 'eth_chainId',
      expectedResult: '0x1',
    });
    expect(isExpectedChainIdentity('eip155:1', '0x1')).toBe(true);
    expect(isExpectedChainIdentity('eip155:1', '0x01')).toBe(false);
    expect(ethereum.allowedMethods).toEqual([
      'eth_blockNumber',
      'eth_call',
      'eth_chainId',
      'eth_getBalance',
      'eth_getBlockByHash',
      'eth_getBlockByNumber',
      'eth_getCode',
      'eth_getLogs',
      'eth_getTransactionByHash',
      'eth_getTransactionReceipt',
    ]);
    expect(isAllowedChainObservationMethod('eip155:1', 'eth_sendRawTransaction')).toBe(false);
    expect(ethereum.transport).toEqual({
      authoritative: 'POLLING',
      webSocket: {
        role: 'NOTIFICATION_HINT_ONLY',
        allowedMethods: ['eth_subscribe'],
        allowedSubscriptions: ['logs', 'newHeads'],
        invocation: 'ETH_SUBSCRIBE_WITH_ALLOWLISTED_NAME',
        checkpointAuthority: 'NEVER_ADVANCE_FROM_NOTIFICATION_ALONE',
        disconnectOrGap: 'AUTHORITATIVE_POLLING_BACKFILL_REQUIRED',
      },
    });

    expect(solana.identityProbe).toEqual({
      kind: 'SOLANA_GENESIS_HASH',
      method: 'getGenesisHash',
      expectedResult: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
      expectedCaipReference: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      derivation: 'FIRST_32_BASE58_CHARACTERS',
    });
    expect(
      chainObservationPolicyForNetwork('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1')?.identityProbe,
    ).toEqual({
      kind: 'SOLANA_GENESIS_HASH',
      method: 'getGenesisHash',
      expectedResult: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
      expectedCaipReference: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      derivation: 'FIRST_32_BASE58_CHARACTERS',
    });
    if (solana.identityProbe.kind === 'SOLANA_GENESIS_HASH') {
      expect(solana.identityProbe.expectedResult.slice(0, 32)).toBe(
        solana.identityProbe.expectedCaipReference,
      );
      expect(solana.identityProbe.expectedResult).not.toBe(
        solana.identityProbe.expectedCaipReference,
      );
      expect(isExpectedChainIdentity(solana.networkId, solana.identityProbe.expectedResult)).toBe(
        true,
      );
      expect(
        isExpectedChainIdentity(solana.networkId, solana.identityProbe.expectedCaipReference),
      ).toBe(false);
    }
    expect(solana.allowedMethods).toEqual([
      'getAccountInfo',
      'getBlock',
      'getBlockHeight',
      'getGenesisHash',
      'getHealth',
      'getLatestBlockhash',
      'getMultipleAccounts',
      'getSignatureStatuses',
      'getSignaturesForAddress',
      'getSlot',
      'getTokenAccountBalance',
      'getTokenAccountsByOwner',
      'getTransaction',
      'getVersion',
    ]);
    expect(isAllowedChainObservationMethod(solana.networkId, 'sendTransaction')).toBe(false);
    expect(solana.monotonicReadConstraint).toBe('MIN_CONTEXT_SLOT_REQUIRED');
    expect(solana.tiers).toEqual([
      {
        tier: 'PROVISIONAL',
        selector: 'confirmed',
        state: 'ALLOWED',
        authority: 'DISPLAY_ONLY',
      },
      {
        tier: 'CANONICAL',
        selector: 'confirmed',
        state: 'REQUIRES_LIVE_PROOF',
        authority: 'CANONICAL_INDEXING',
      },
      {
        tier: 'FINANCIAL',
        selector: 'finalized',
        state: 'ALLOWED',
        authority: 'FINANCIAL_AND_LEDGER',
      },
    ]);
    expect(solana.transport.webSocket).toEqual({
      role: 'NOTIFICATION_HINT_ONLY',
      allowedMethods: [
        'accountSubscribe',
        'logsSubscribe',
        'programSubscribe',
        'rootSubscribe',
        'signatureSubscribe',
        'slotSubscribe',
      ],
      allowedSubscriptions: [
        'accountSubscribe',
        'logsSubscribe',
        'programSubscribe',
        'rootSubscribe',
        'signatureSubscribe',
        'slotSubscribe',
      ],
      invocation: 'DIRECT_SOLANA_SUBSCRIPTION_METHOD',
      checkpointAuthority: 'NEVER_ADVANCE_FROM_NOTIFICATION_ALONE',
      disconnectOrGap: 'AUTHORITATIVE_POLLING_BACKFILL_REQUIRED',
    });
  });

  it('does not let a successful retrieval of the same stale head refresh freshness', () => {
    const sameHead = classifyChainObservationFreshness({
      networkId: 'eip155:8453',
      nowMs: 60_000,
      identityValidated: true,
      previous: { position: 100n, advancedAtMs: 0 },
      candidate: { position: 100n, retrievedAtMs: 59_000 },
    });
    expect(sameHead).toEqual({
      freshness: 'STALE',
      effectiveHeadAdvancedAtMs: 0,
      retrievalAgeMs: 1_000,
      headAdvanceAgeMs: 60_000,
      reason: 'VALIDATED_BUT_STALE',
    });

    expect(
      classifyChainObservationFreshness({
        networkId: 'eip155:8453',
        nowMs: 60_000,
        identityValidated: true,
        previous: { position: 100n, advancedAtMs: 0 },
        candidate: { position: 101n, retrievedAtMs: 59_000 },
      }).freshness,
    ).toBe('CURRENT');
    expect(
      classifyChainObservationFreshness({
        networkId: 'eip155:8453',
        nowMs: 301_000,
        identityValidated: true,
        previous: { position: 100n, advancedAtMs: 0 },
        candidate: { position: 100n, retrievedAtMs: 300_000 },
      }).freshness,
    ).toBe('UNAVAILABLE');
    expect(
      classifyChainObservationFreshness({
        networkId: 'eip155:8453',
        nowMs: 10_000,
        identityValidated: true,
        previous: { position: 100n, advancedAtMs: 0 },
        candidate: { position: 99n, retrievedAtMs: 9_000 },
      }).freshness,
    ).toBe('QUARANTINED');
  });

  it('uses a separate finality-stall gate and blocks Arbitrum without endpoint proof', () => {
    expect(
      classifyFinalityProgress({
        networkId: 'eip155:1',
        nowMs: 1,
        identityValidated: true,
        liveCapabilityProofValidated: false,
        previous: null,
        candidate: { position: 1n, retrievedAtMs: 1 },
      }).status,
    ).toBe('BLOCKED_PENDING_LIVE_PROOF');
    expect(
      classifyFinalityProgress({
        networkId: 'eip155:1',
        nowMs: 1_800_001,
        identityValidated: true,
        liveCapabilityProofValidated: true,
        previous: { position: 10n, advancedAtMs: 0 },
        candidate: { position: 10n, retrievedAtMs: 1_800_000 },
      }).status,
    ).toBe('STALLED');
    expect(
      classifyFinalityProgress({
        networkId: 'eip155:1',
        nowMs: 1_800_001,
        identityValidated: true,
        liveCapabilityProofValidated: true,
        previous: { position: 10n, advancedAtMs: 0 },
        candidate: { position: 11n, retrievedAtMs: 1_800_000 },
      }).status,
    ).toBe('HEALTHY');
    expect(
      classifyFinalityProgress({
        networkId: 'eip155:42161',
        nowMs: 1,
        identityValidated: true,
        liveCapabilityProofValidated: false,
        previous: null,
        candidate: { position: 1n, retrievedAtMs: 1 },
      }).status,
    ).toBe('BLOCKED_PENDING_LIVE_PROOF');
    expect(
      classifyFinalityProgress({
        networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        nowMs: 90_001,
        identityValidated: true,
        liveCapabilityProofValidated: true,
        previous: { position: 10n, advancedAtMs: 0 },
        candidate: { position: 10n, retrievedAtMs: 90_000 },
      }).status,
    ).toBe('STALLED');
  });

  it('recovers provisional reorgs from finalized ancestry but quarantines finalized conflict', () => {
    const previous = block(100n, '0x100', '0x099');
    expect(
      decideChainContinuity({
        networkId: 'eip155:1',
        tier: 'PROVISIONAL',
        liveCapabilityProofValidated: false,
        previous,
        candidate: { ...previous },
      }).action,
    ).toBe('ACCEPT_NO_CHANGE');
    expect(
      decideChainContinuity({
        networkId: 'eip155:1',
        tier: 'PROVISIONAL',
        liveCapabilityProofValidated: false,
        previous,
        candidate: { ...previous, parentHash: '0xother' },
      }).action,
    ).toBe('RECOVER_PROVISIONAL_FROM_LAST_FINALIZED_COMMON_ANCESTOR');
    expect(
      decideChainContinuity({
        networkId: 'eip155:1',
        tier: 'FINANCIAL',
        liveCapabilityProofValidated: true,
        previous,
        candidate: { ...previous, parentHash: '0xother' },
      }).action,
    ).toBe('QUARANTINE_FINALIZED_DISAGREEMENT');
    expect(
      decideChainContinuity({
        networkId: 'eip155:1',
        tier: 'PROVISIONAL',
        liveCapabilityProofValidated: false,
        previous,
        candidate: block(101n, '0x101', '0x100'),
      }).action,
    ).toBe('ACCEPT_APPEND');
    expect(
      decideChainContinuity({
        networkId: 'eip155:1',
        tier: 'PROVISIONAL',
        liveCapabilityProofValidated: false,
        previous,
        candidate: block(103n, '0x103', '0x102'),
      }),
    ).toMatchObject({
      action: 'VERIFY_BOUNDED_CONTINUITY_FROM_LAST_FINALIZED_CHECKPOINT',
      maxReadUnits: 2_048,
      mayMutateFinalizedFacts: false,
    });
    expect(
      decideChainContinuity({
        networkId: 'eip155:1',
        tier: 'PROVISIONAL',
        liveCapabilityProofValidated: false,
        previous,
        candidate: block(101n, '0x201', '0xwrong'),
      }).action,
    ).toBe('RECOVER_PROVISIONAL_FROM_LAST_FINALIZED_COMMON_ANCESTOR');
    expect(
      decideChainContinuity({
        networkId: 'eip155:1',
        tier: 'FINANCIAL',
        liveCapabilityProofValidated: false,
        previous,
        candidate: block(101n, '0x101', '0x100'),
      }).action,
    ).toBe('FAIL_CLOSED_BLOCKED_TIER');
    expect(
      decideChainContinuity({
        networkId: 'eip155:1',
        tier: 'FINANCIAL',
        liveCapabilityProofValidated: true,
        previous,
        candidate: block(101n, '0x101', '0x100'),
      }).action,
    ).toBe('ACCEPT_APPEND');
    expect(
      decideChainContinuity({
        networkId: 'eip155:1',
        tier: 'FINANCIAL',
        liveCapabilityProofValidated: true,
        previous,
        candidate: block(101n, '0x201', '0xwrong'),
      }).action,
    ).toBe('QUARANTINE_FINALIZED_DISAGREEMENT');
    expect(
      decideChainContinuity({
        networkId: 'eip155:42161',
        tier: 'CANONICAL',
        liveCapabilityProofValidated: true,
        previous,
        candidate: block(101n, '0x101', '0x100'),
      }).action,
    ).toBe('FAIL_CLOSED_BLOCKED_TIER');
    expect(
      decideChainContinuity({
        networkId: 'eip155:1',
        tier: 'CANONICAL',
        liveCapabilityProofValidated: false,
        previous,
        candidate: block(101n, '0x101', '0x100'),
      }).action,
    ).toBe('FAIL_CLOSED_BLOCKED_TIER');
    expect(
      decideChainContinuity({
        networkId: 'eip155:1',
        tier: 'CANONICAL',
        liveCapabilityProofValidated: true,
        previous,
        candidate: block(101n, '0x101', '0x100'),
      }).action,
    ).toBe('ACCEPT_APPEND');
  });

  it('requires exact finalized agreement and every approved fallback gate', () => {
    const checkpoint = {
      networkId: 'eip155:1',
      ...block(100n, '0x100', '0x099'),
    } as const;
    expect(compareFinalizedSourceCheckpoints(checkpoint, { ...checkpoint })).toBe('AGREED');
    expect(compareFinalizedSourceCheckpoints(checkpoint, { ...checkpoint, position: 99n })).toBe(
      'BLOCKED_NOT_ALIGNED',
    );
    expect(compareFinalizedSourceCheckpoints(checkpoint, { ...checkpoint, hash: '0xother' })).toBe(
      'QUARANTINE_FINALIZED_DISAGREEMENT',
    );
    expect(
      compareFinalizedSourceCheckpoints(checkpoint, {
        ...checkpoint,
        parentHash: '0xother',
      }),
    ).toBe('QUARANTINE_FINALIZED_DISAGREEMENT');
    expect(
      compareFinalizedSourceCheckpoints(checkpoint, {
        ...checkpoint,
        networkId: 'eip155:8453',
      }),
    ).toBe('BLOCKED_NOT_ALIGNED');

    const approvedFallback = {
      primaryAvailable: false,
      primaryCircuitOpen: true,
      alternateApproved: true,
      alternateFailureDomainIndependent: true,
      alternateIdentityValidated: true,
      alternateFinalizedCheckpointCompatible: true,
    } as const;
    expect(decideChainObservationFallback(approvedFallback)).toBe('USE_EXACT_APPROVED_FALLBACK');
    expect(decideChainObservationFallback(Object.assign([], approvedFallback))).toBe(
      'FAIL_CLOSED_RETAIN_LAST_GOOD',
    );
    expect(
      decideChainObservationFallback({
        ...approvedFallback,
        alternateFinalizedCheckpointCompatible: false,
      }),
    ).toBe('FAIL_CLOSED_RETAIN_LAST_GOOD');
    expect(CHAIN_OBSERVATION_RESILIENCE_POLICY.failure).toEqual({
      lastGoodObservation: 'RETAIN',
      missingBalance: 'NEVER_REPLACE_WITH_ZERO',
      transactionSubmission: 'DISABLED',
      automaticResubmission: 'NEVER',
      financialUse: 'FAIL_CLOSED',
    });
  });

  it('never authorizes unsafe tiers or a blocked Arbitrum financial tier', () => {
    const allApprovals = {
      providerSelectionApproved: true,
      exactHostEgressApproved: true,
      liveCapabilityProofValidated: true,
      registryBindingValidated: true,
      independentFinalizedSourcesAgree: true,
      identityValidated: true,
      freshness: 'CURRENT',
      finalityStatus: 'HEALTHY',
      lineageValidated: true,
      quarantineClear: true,
    } as const;
    expect(observationTierRule('eip155:1', 'PROVISIONAL')?.authority).toBe('DISPLAY_ONLY');
    expect(canObservationAuthorizeFinancialUse('eip155:1', 'PROVISIONAL', allApprovals)).toBe(
      false,
    );
    expect(canObservationAuthorizeFinancialUse('eip155:1', 'CANONICAL', allApprovals)).toBe(false);
    expect(canObservationAuthorizeFinancialUse('eip155:1', 'FINANCIAL', allApprovals)).toBe(true);
    for (const missingApproval of [
      'providerSelectionApproved',
      'exactHostEgressApproved',
      'liveCapabilityProofValidated',
      'registryBindingValidated',
      'independentFinalizedSourcesAgree',
    ] as const) {
      expect(
        canObservationAuthorizeFinancialUse('eip155:1', 'FINANCIAL', {
          ...allApprovals,
          [missingApproval]: false,
        }),
      ).toBe(false);
    }
    for (const unsafeObservationState of [
      { identityValidated: false },
      { freshness: 'STALE' },
      { finalityStatus: 'STALLED' },
      { lineageValidated: false },
      { quarantineClear: false },
    ] as const) {
      expect(
        canObservationAuthorizeFinancialUse('eip155:1', 'FINANCIAL', {
          ...allApprovals,
          ...unsafeObservationState,
        }),
      ).toBe(false);
    }
    expect(
      canObservationAuthorizeFinancialUse('eip155:1', 'FINANCIAL', Object.assign([], allApprovals)),
    ).toBe(false);
    expect(canObservationAuthorizeFinancialUse('eip155:42161', 'FINANCIAL', allApprovals)).toBe(
      false,
    );
  });

  it('fails closed without throwing on runtime-malformed boundary values', () => {
    expect(() => classifyChainObservationFreshness(null as never)).not.toThrow();
    expect(classifyChainObservationFreshness(null as never).freshness).toBe('UNAVAILABLE');
    expect(() => classifyFinalityProgress({ networkId: 'eip155:1' } as never)).not.toThrow();
    expect(classifyFinalityProgress({ networkId: 'eip155:1' } as never).status).toBe('UNAVAILABLE');
    expect(() => decideChainContinuity(null as never)).not.toThrow();
    expect(decideChainContinuity(null as never).action).toBe('FAIL_CLOSED_BLOCKED_TIER');
    expect(() => compareFinalizedSourceCheckpoints(null as never, null as never)).not.toThrow();
    expect(compareFinalizedSourceCheckpoints(null as never, null as never)).toBe(
      'QUARANTINE_FINALIZED_DISAGREEMENT',
    );
    expect(() => decideChainObservationFallback(null as never)).not.toThrow();
    expect(decideChainObservationFallback(null as never)).toBe('FAIL_CLOSED_RETAIN_LAST_GOOD');
    expect(observationTierRule('malformed', 'FINANCIAL')).toBeUndefined();
    expect(isExpectedChainIdentity('malformed', null)).toBe(false);
    expect(canObservationAuthorizeFinancialUse('eip155:1', 'FINANCIAL', null as never)).toBe(false);
  });

  it('performs no external calls while evaluating policy', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    chainObservationPolicyForNetwork('eip155:1');
    isAllowedChainObservationMethod('eip155:1', 'eth_getLogs');
    isExpectedChainIdentity('eip155:1', '0x1');
    classifyChainObservationFreshness({
      networkId: 'eip155:1',
      nowMs: 1,
      identityValidated: true,
      previous: null,
      candidate: { position: 1n, retrievedAtMs: 1 },
    });
    decideChainObservationFallback({
      primaryAvailable: true,
      primaryCircuitOpen: false,
      alternateApproved: false,
      alternateFailureDomainIndependent: false,
      alternateIdentityValidated: false,
      alternateFinalizedCheckpointCompatible: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
