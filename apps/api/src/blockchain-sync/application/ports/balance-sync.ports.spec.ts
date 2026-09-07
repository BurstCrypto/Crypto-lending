import {
  attestEthereumMainnetBalanceDeploymentIdentity,
  attestSolanaMainnetBalanceDeploymentIdentity,
  createBalanceSyncExecutionContext,
  createEthereumMainnetBalanceDeploymentIdentityVerifier,
  createSolanaMainnetBalanceDeploymentIdentityVerifier,
  reviewBalanceSyncExecutionContext,
  reviewMainnetBalanceDeploymentIdentityAttestation,
  type BalanceSyncExecutionContext,
  type EthereumMainnetBalanceDeploymentIdentityVerificationRequest,
  type EthereumMainnetBalanceDeploymentIdentityVerifierImplementation,
  type EthereumMainnetBalanceDeploymentIdentityVerifierPort,
  type SolanaMainnetBalanceDeploymentIdentityVerificationRequest,
  type SolanaMainnetBalanceDeploymentIdentityVerifierPort,
} from './balance-sync.ports';

const MANIFEST_FINGERPRINT = 'a'.repeat(64);
const OBSERVED_FINGERPRINT = 'b'.repeat(64);
const CLAIMS = Object.freeze({
  deploymentIdentityValidated: true as const,
  approvedManifestFingerprintSha256: MANIFEST_FINGERPRINT,
  observedIdentityFingerprintSha256: OBSERVED_FINGERPRINT,
});
const ETHEREUM_REQUEST = Object.freeze({
  networkId: 'eip155:1' as const,
  sourcePosition: '100',
  sourceHash: `0x${'c'.repeat(64)}`,
  assetIdentities: Object.freeze([
    '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
  ]),
}) satisfies EthereumMainnetBalanceDeploymentIdentityVerificationRequest;
const SOLANA_REQUEST = Object.freeze({
  networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const,
  sourcePosition: '100',
  sourceHash: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  assetIdentities: Object.freeze([
    '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  ]),
}) satisfies SolanaMainnetBalanceDeploymentIdentityVerificationRequest;

describe('balance sync execution context authority', () => {
  it('mints one frozen exact context and reviews the same native signal identity', () => {
    const owner = createBalanceSyncExecutionContext();
    const reviewed = reviewBalanceSyncExecutionContext(owner.context);

    expect(Object.getPrototypeOf(owner)).toBeNull();
    expect(Object.getPrototypeOf(owner.context)).toBeNull();
    expect(Object.isFrozen(owner)).toBe(true);
    expect(Object.isFrozen(owner.context)).toBe(true);
    expect(Reflect.ownKeys(owner).sort()).toEqual(['abort', 'context']);
    expect(Reflect.ownKeys(owner.context)).toEqual(['signal']);
    expect(reviewed?.signal).toBe(owner.context.signal);
    expect(reviewed?.abortKind).toBeNull();
    expect(Object.getPrototypeOf(reviewed as object)).toBeNull();
    expect(Object.isFrozen(reviewed)).toBe(true);
  });

  it('rejects counterfeit, accessor, proxied, and prototype-forged contexts without reads', () => {
    const genuine = createBalanceSyncExecutionContext().context;
    let reads = 0;
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'signal', {
      enumerable: true,
      get: () => {
        reads += 1;
        return genuine.signal;
      },
    });
    const proxy = new Proxy(genuine, {
      get: () => {
        reads += 1;
        throw new Error('must not read');
      },
      getPrototypeOf: () => {
        reads += 1;
        throw new Error('must not inspect');
      },
    });
    const prototypeForged = Object.create(
      Object.getPrototypeOf(genuine),
      Object.getOwnPropertyDescriptors(genuine),
    );

    for (const value of [
      { signal: genuine.signal },
      accessor,
      proxy,
      prototypeForged,
      null,
      undefined,
    ]) {
      expect(reviewBalanceSyncExecutionContext(value)).toBeNull();
    }
    expect(reads).toBe(0);
  });

  it.each([
    ['DEADLINE', 'SHUTDOWN', 'DEADLINE'],
    ['SHUTDOWN', 'DEADLINE', 'SHUTDOWN'],
  ] as const)('keeps first abort kind %s across later %s aborts', (first, second, expected) => {
    const owner = createBalanceSyncExecutionContext();
    owner.abort(first);
    owner.abort(second);
    owner.abort(second);

    const reviewed = reviewBalanceSyncExecutionContext(owner.context);
    expect(reviewed?.abortKind).toBe(expected);
    expect(reviewed?.signal.aborted).toBe(true);
  });

  it('rejects an invalid abort kind without aborting or retaining caller data', () => {
    const owner = createBalanceSyncExecutionContext();
    const callerSecret = 'caller-secret-must-not-become-an-abort-reason';

    expect(() => owner.abort(callerSecret as unknown as Parameters<typeof owner.abort>[0])).toThrow(
      new TypeError('invalid balance sync execution abort kind'),
    );
    expect(reviewBalanceSyncExecutionContext(owner.context)?.abortKind).toBeNull();

    owner.abort('SHUTDOWN');
    const signal = reviewBalanceSyncExecutionContext(owner.context)?.signal;
    expect(String(signal?.reason)).not.toContain(callerSecret);
    expect(JSON.stringify(reviewBalanceSyncExecutionContext(owner.context))).not.toContain(
      callerSecret,
    );
  });

  it('does not recognize a raw native signal cast as a context', () => {
    const signal = new AbortController().signal;
    expect(
      reviewBalanceSyncExecutionContext(signal as unknown as BalanceSyncExecutionContext),
    ).toBeNull();
  });
});

describe('mainnet balance deployment identity attestation authority', () => {
  it('rejects a proxied verifier implementation before creating a capability', () => {
    let calls = 0;
    const implementation = new Proxy(async () => CLAIMS, {
      apply: () => {
        calls += 1;
        return Promise.resolve(CLAIMS);
      },
    });

    expect(() => createEthereumMainnetBalanceDeploymentIdentityVerifier(implementation)).toThrow(
      'invalid mainnet balance deployment identity verifier',
    );
    expect(calls).toBe(0);
  });

  it('uses intrinsic promise settlement and drains a rejected result with a poisoned own then', async () => {
    const execution = createBalanceSyncExecutionContext();
    const rejected = Promise.reject(new Error('private verifier rejection'));
    let poisonedThenCalls = 0;
    Object.defineProperty(rejected, 'then', {
      value: () => {
        poisonedThenCalls += 1;
        return new Promise<never>(() => undefined);
      },
    });
    const implementation = (() =>
      rejected) as EthereumMainnetBalanceDeploymentIdentityVerifierImplementation;
    const verifier = createEthereumMainnetBalanceDeploymentIdentityVerifier(implementation);

    await expect(
      attestEthereumMainnetBalanceDeploymentIdentity(verifier, ETHEREUM_REQUEST, execution.context),
    ).rejects.toThrow('mainnet balance deployment identity verification unavailable');
    expect(poisonedThenCalls).toBe(0);
  });

  it('boxes changing-then claims so abort cannot hang after operation settlement', async () => {
    const execution = createBalanceSyncExecutionContext();
    const claims = { ...CLAIMS } as typeof CLAIMS & { readonly then?: unknown };
    let thenReads = 0;
    Object.defineProperty(claims, 'then', {
      enumerable: false,
      get: () => {
        thenReads += 1;
        return thenReads === 1 ? undefined : () => undefined;
      },
    });
    const verifier = createEthereumMainnetBalanceDeploymentIdentityVerifier(async () => claims);
    const pending = attestEthereumMainnetBalanceDeploymentIdentity(
      verifier,
      ETHEREUM_REQUEST,
      execution.context,
    );
    const rejection = expect(pending).rejects.toThrow(
      'mainnet balance deployment identity verification unavailable',
    );

    await Promise.resolve();
    await Promise.resolve();
    execution.abort('SHUTDOWN');

    await rejection;
    expect(thenReads).toBe(1);
  }, 1_000);

  it('mints an exact request-bound attestation only through a genuine chain verifier', async () => {
    const execution = createBalanceSyncExecutionContext();
    const implementation = jest.fn(
      async (
        request: EthereumMainnetBalanceDeploymentIdentityVerificationRequest,
        execution: BalanceSyncExecutionContext,
      ) => {
        void request;
        void execution;
        return CLAIMS;
      },
    );
    const verifier = createEthereumMainnetBalanceDeploymentIdentityVerifier(implementation);

    const value = await attestEthereumMainnetBalanceDeploymentIdentity(
      verifier,
      ETHEREUM_REQUEST,
      execution.context,
    );
    const reviewed = reviewMainnetBalanceDeploymentIdentityAttestation(value, ETHEREUM_REQUEST);

    expect(reviewed).toEqual(CLAIMS);
    expect(Object.getPrototypeOf(reviewed as object)).toBeNull();
    expect(Object.isFrozen(reviewed)).toBe(true);
    expect(implementation).toHaveBeenCalledWith(
      expect.objectContaining(ETHEREUM_REQUEST),
      execution.context,
    );
    const issuedRequest = implementation.mock.calls[0]?.[0] as object;
    expect(Object.getPrototypeOf(issuedRequest)).toBeNull();
    expect(Object.isFrozen(issuedRequest)).toBe(true);
    expect(Object.isFrozen((issuedRequest as { assetIdentities: object }).assetIdentities)).toBe(
      true,
    );
  });

  it('accepts a canonical mutable asset tuple and freezes its verifier copy', async () => {
    const execution = createBalanceSyncExecutionContext();
    let normalizedAssets: readonly string[] | undefined;
    const verifier = createEthereumMainnetBalanceDeploymentIdentityVerifier(async (request) => {
      normalizedAssets = request.assetIdentities;
      return CLAIMS;
    });

    await expect(
      attestEthereumMainnetBalanceDeploymentIdentity(
        verifier,
        { ...ETHEREUM_REQUEST, assetIdentities: [...ETHEREUM_REQUEST.assetIdentities] },
        execution.context,
      ),
    ).resolves.toEqual(CLAIMS);
    expect(Object.isFrozen(normalizedAssets)).toBe(true);
  });

  it.each(['undefined', 'structural', 'proxy', 'cross-chain'] as const)(
    'rejects a %s verifier capability',
    async (kind) => {
      const execution = createBalanceSyncExecutionContext();
      const ethereum = createEthereumMainnetBalanceDeploymentIdentityVerifier(async () => CLAIMS);
      let reads = 0;
      const proxy = new Proxy(ethereum as object, {
        get: () => {
          reads += 1;
          throw new Error('must not read');
        },
        getPrototypeOf: () => {
          reads += 1;
          throw new Error('must not inspect');
        },
      });
      const verifier =
        kind === 'undefined'
          ? undefined
          : kind === 'structural'
            ? ({} as EthereumMainnetBalanceDeploymentIdentityVerifierPort)
            : kind === 'proxy'
              ? (proxy as EthereumMainnetBalanceDeploymentIdentityVerifierPort)
              : (createSolanaMainnetBalanceDeploymentIdentityVerifier(
                  async () => CLAIMS,
                ) as unknown as EthereumMainnetBalanceDeploymentIdentityVerifierPort);

      await expect(
        attestEthereumMainnetBalanceDeploymentIdentity(
          verifier,
          ETHEREUM_REQUEST,
          execution.context,
        ),
      ).rejects.toThrow('mainnet balance deployment identity verification unavailable');
      expect(reads).toBe(0);
    },
  );

  it('rejects structural, proxied, cross-checkpoint, and cross-chain attestations without reads', async () => {
    const execution = createBalanceSyncExecutionContext();
    const verifier = createEthereumMainnetBalanceDeploymentIdentityVerifier(async () => CLAIMS);
    const genuine = await attestEthereumMainnetBalanceDeploymentIdentity(
      verifier,
      ETHEREUM_REQUEST,
      execution.context,
    );
    let reads = 0;
    const forged = { ...CLAIMS };
    const proxy = new Proxy(forged, {
      get: () => {
        reads += 1;
        throw new Error('must not read');
      },
      getPrototypeOf: () => {
        reads += 1;
        throw new Error('must not inspect');
      },
    });

    expect(reviewMainnetBalanceDeploymentIdentityAttestation(forged, ETHEREUM_REQUEST)).toBeNull();
    expect(reviewMainnetBalanceDeploymentIdentityAttestation(proxy, ETHEREUM_REQUEST)).toBeNull();
    expect(
      reviewMainnetBalanceDeploymentIdentityAttestation(undefined, ETHEREUM_REQUEST),
    ).toBeNull();
    expect(
      reviewMainnetBalanceDeploymentIdentityAttestation(genuine, {
        ...ETHEREUM_REQUEST,
        sourcePosition: '101',
      }),
    ).toBeNull();
    expect(reviewMainnetBalanceDeploymentIdentityAttestation(genuine, SOLANA_REQUEST)).toBeNull();
    expect(reads).toBe(0);
  });

  it.each([
    [
      'sparse asset tuple with a larger length',
      (() => {
        const identities = [...ETHEREUM_REQUEST.assetIdentities];
        identities.length = 5;
        return { ...ETHEREUM_REQUEST, assetIdentities: identities };
      })(),
    ],
    ['zero EVM source hash', { ...ETHEREUM_REQUEST, sourceHash: `0x${'0'.repeat(64)}` }],
    [
      'zero EVM asset address',
      {
        ...ETHEREUM_REQUEST,
        assetIdentities: [`0x${'0'.repeat(40)}`, ...ETHEREUM_REQUEST.assetIdentities.slice(1)],
      },
    ],
  ])('rejects a hostile Ethereum verification request: %s', async (_name, request) => {
    const execution = createBalanceSyncExecutionContext();
    const implementation = jest.fn(async () => CLAIMS);
    const verifier = createEthereumMainnetBalanceDeploymentIdentityVerifier(implementation);

    await expect(
      attestEthereumMainnetBalanceDeploymentIdentity(
        verifier,
        request as EthereumMainnetBalanceDeploymentIdentityVerificationRequest,
        execution.context,
      ),
    ).rejects.toThrow('mainnet balance deployment identity verification unavailable');
    expect(implementation).not.toHaveBeenCalled();
  });

  it.each([
    ['all-ones Solana source identity', { ...SOLANA_REQUEST, sourceHash: '1'.repeat(32) }],
    [
      'regex-shaped non-key Solana source identity',
      { ...SOLANA_REQUEST, sourceHash: '2'.repeat(32) },
    ],
    [
      'all-ones Solana asset identity',
      {
        ...SOLANA_REQUEST,
        assetIdentities: ['1'.repeat(32), ...SOLANA_REQUEST.assetIdentities.slice(1)],
      },
    ],
    [
      'regex-shaped non-key Solana asset identity',
      {
        ...SOLANA_REQUEST,
        assetIdentities: ['2'.repeat(32), ...SOLANA_REQUEST.assetIdentities.slice(1)],
      },
    ],
  ])('rejects a hostile Solana verification request: %s', async (_name, request) => {
    const execution = createBalanceSyncExecutionContext();
    const implementation = jest.fn(async () => CLAIMS);
    const verifier = createSolanaMainnetBalanceDeploymentIdentityVerifier(implementation);

    await expect(
      attestSolanaMainnetBalanceDeploymentIdentity(
        verifier,
        request as SolanaMainnetBalanceDeploymentIdentityVerificationRequest,
        execution.context,
      ),
    ).rejects.toThrow('mainnet balance deployment identity verification unavailable');
    expect(implementation).not.toHaveBeenCalled();
  });

  it.each([
    ['missing fields', {}],
    ['false validation', { ...CLAIMS, deploymentIdentityValidated: false }],
    ['zero manifest', { ...CLAIMS, approvedManifestFingerprintSha256: '0'.repeat(64) }],
    ['uppercase observed', { ...CLAIMS, observedIdentityFingerprintSha256: 'C'.repeat(64) }],
    ['extra field', { ...CLAIMS, extra: true }],
  ])('rejects malformed verifier claims: %s', async (_name, claims) => {
    const execution = createBalanceSyncExecutionContext();
    const verifier = createSolanaMainnetBalanceDeploymentIdentityVerifier(async () => claims);
    await expect(
      attestSolanaMainnetBalanceDeploymentIdentity(verifier, SOLANA_REQUEST, execution.context),
    ).rejects.toThrow('mainnet balance deployment identity verification unavailable');
  });

  it('suppresses a late verifier settlement after execution is aborted', async () => {
    const execution = createBalanceSyncExecutionContext();
    let settle!: (claims: typeof CLAIMS) => void;
    const verifier = createEthereumMainnetBalanceDeploymentIdentityVerifier(
      async () => new Promise<typeof CLAIMS>((resolve) => (settle = resolve)),
    );
    const pending = attestEthereumMainnetBalanceDeploymentIdentity(
      verifier,
      ETHEREUM_REQUEST,
      execution.context,
    );
    const rejection = expect(pending).rejects.toThrow(
      'mainnet balance deployment identity verification unavailable',
    );

    execution.abort('SHUTDOWN');
    settle(CLAIMS);

    await rejection;
  });

  it('rejects promptly on abort even when the verifier never settles', async () => {
    const execution = createBalanceSyncExecutionContext();
    const verifier = createEthereumMainnetBalanceDeploymentIdentityVerifier(
      async () => new Promise<never>(() => undefined),
    );
    const pending = attestEthereumMainnetBalanceDeploymentIdentity(
      verifier,
      ETHEREUM_REQUEST,
      execution.context,
    );
    const rejection = expect(pending).rejects.toThrow(
      'mainnet balance deployment identity verification unavailable',
    );

    execution.abort('DEADLINE');

    await rejection;
  }, 1_000);

  it('drains a verifier rejection that arrives after abort', async () => {
    const execution = createBalanceSyncExecutionContext();
    let rejectLate!: (reason: unknown) => void;
    const verifier = createEthereumMainnetBalanceDeploymentIdentityVerifier(
      async () => new Promise<never>((_resolve, reject) => (rejectLate = reject)),
    );
    const pending = attestEthereumMainnetBalanceDeploymentIdentity(
      verifier,
      ETHEREUM_REQUEST,
      execution.context,
    );
    const rejection = expect(pending).rejects.toThrow(
      'mainnet balance deployment identity verification unavailable',
    );

    execution.abort('SHUTDOWN');
    await rejection;
    rejectLate(new Error('private late rejection'));
    await Promise.resolve();
  });

  it('keeps Ethereum and Solana issuer capabilities distinct', async () => {
    const execution = createBalanceSyncExecutionContext();
    const solana = createSolanaMainnetBalanceDeploymentIdentityVerifier(async () => CLAIMS);
    await expect(
      attestSolanaMainnetBalanceDeploymentIdentity(solana, SOLANA_REQUEST, execution.context),
    ).resolves.toEqual(CLAIMS);
    expect(
      reviewMainnetBalanceDeploymentIdentityAttestation(
        await attestSolanaMainnetBalanceDeploymentIdentity(
          solana,
          SOLANA_REQUEST,
          execution.context,
        ),
        SOLANA_REQUEST,
      ),
    ).toEqual(CLAIMS);
    expect(solana as SolanaMainnetBalanceDeploymentIdentityVerifierPort).toBe(solana);
  });
});
