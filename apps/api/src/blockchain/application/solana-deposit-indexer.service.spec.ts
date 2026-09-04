import type {
  SolanaDepositSourcePort,
  SolanaDepositSourceRequestContext,
  SolanaTokenAccountsByOwnerRequest,
} from './ports/solana-deposit-source.port';
import type {
  SolanaCanonicalReadCapabilityContext,
  SolanaCanonicalReadCapabilityVerifierPort,
} from './ports/solana-canonical-read-capability.port';
import {
  SolanaDepositIndexerError,
  SolanaDepositIndexerService,
  type SolanaDepositIndexRequest,
} from './solana-deposit-indexer.service';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../domain/supported-asset-registry';
import {
  decodeSolanaPublicKey,
  SOLANA_TOKEN_PROGRAM_IDS,
  type SolanaTokenProgramId,
} from '../domain/solana-token-account';

const MAINNET_NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
const DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const;
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const OWNER = '7YttLkHDoNj9wyDur5EYBDauN5QJUJpz94QRtWQyFrA8';
const OTHER_OWNER = '3wyAj7b2zVzNRPc1K7AB5g3Zcw99oFGCBZRwBvZxr9FQ';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const PYUSD_MINT = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const COUNTERFEIT_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const ACCOUNT_ADDRESSES = [
  USDC_MINT,
  USDT_MINT,
  PYUSD_MINT,
  COUNTERFEIT_MINT,
  OWNER,
  OTHER_OWNER,
  SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
  SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
] as const;

interface AccountFixtureOptions {
  readonly address: string;
  readonly programId?: SolanaTokenProgramId;
  readonly mint?: string;
  readonly owner?: string;
  readonly amount?: bigint;
  readonly state?: number;
  readonly closed?: boolean;
}

function accountFixture(options: AccountFixtureOptions): Readonly<Record<string, unknown>> {
  const programId = options.programId ?? SOLANA_TOKEN_PROGRAM_IDS.LEGACY;
  if (options.closed === true) {
    return Object.freeze({ address: options.address, programId, data: null });
  }
  const data = new Uint8Array(programId === SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022 ? 166 : 165);
  data.set(decodeSolanaPublicKey(options.mint ?? USDC_MINT), 0);
  data.set(decodeSolanaPublicKey(options.owner ?? OWNER), 32);
  new DataView(data.buffer).setBigUint64(64, options.amount ?? 1n, true);
  data[108] = options.state ?? 1;
  if (programId === SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022) data[165] = 2;
  return Object.freeze({ address: options.address, programId, data });
}

function sourceResponse(
  programId: SolanaTokenProgramId,
  accounts: readonly Readonly<Record<string, unknown>>[] = [],
  contextSlot = 900n,
): Readonly<Record<string, unknown>> {
  for (const account of accounts) {
    expect(account.programId).toBe(programId);
  }
  return Object.freeze({ contextSlot, accounts: Object.freeze([...accounts]) });
}

class FakeSolanaDepositSource implements SolanaDepositSourcePort {
  genesisHash: unknown = MAINNET_GENESIS;
  responses: Record<SolanaTokenProgramId, unknown> = {
    [SOLANA_TOKEN_PROGRAM_IDS.LEGACY]: sourceResponse(SOLANA_TOKEN_PROGRAM_IDS.LEGACY),
    [SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022]: sourceResponse(SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022),
  };
  readonly calls: Array<
    | Readonly<{ method: 'getGenesisHash'; context: SolanaDepositSourceRequestContext }>
    | Readonly<{ method: 'getTokenAccountsByOwner'; request: SolanaTokenAccountsByOwnerRequest }>
  > = [];
  sourceError: Error | null = null;

  async getGenesisHash(context: SolanaDepositSourceRequestContext): Promise<unknown> {
    this.calls.push({ method: 'getGenesisHash', context });
    if (this.sourceError !== null) throw this.sourceError;
    return this.genesisHash;
  }

  async getTokenAccountsByOwner(request: SolanaTokenAccountsByOwnerRequest): Promise<unknown> {
    this.calls.push({ method: 'getTokenAccountsByOwner', request });
    if (this.sourceError !== null) throw this.sourceError;
    return this.responses[request.tokenProgramId];
  }
}

function indexRequest(
  overrides: Partial<SolanaDepositIndexRequest> = {},
): SolanaDepositIndexRequest {
  return {
    environment: 'MAINNET',
    networkId: MAINNET_NETWORK,
    ownerAddress: OWNER,
    tier: 'PROVISIONAL',
    minContextSlot: 850n,
    ...overrides,
  };
}

async function expectIndexError(
  promise: Promise<unknown>,
  code: string,
): Promise<SolanaDepositIndexerError> {
  try {
    await promise;
    throw new Error('Expected indexer error');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(SolanaDepositIndexerError);
    expect((error as SolanaDepositIndexerError).code).toBe(code);
    return error as SolanaDepositIndexerError;
  }
}

describe('SolanaDepositIndexerService', () => {
  it('aggregates multiple accounts by canonical KAN-61 asset identity at one source slot', async () => {
    const source = new FakeSolanaDepositSource();
    source.responses[SOLANA_TOKEN_PROGRAM_IDS.LEGACY] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
      [
        accountFixture({ address: ACCOUNT_ADDRESSES[0], amount: 9_007_199_254_740_993n }),
        accountFixture({ address: ACCOUNT_ADDRESSES[1], amount: 7n }),
        accountFixture({
          address: ACCOUNT_ADDRESSES[2],
          mint: USDT_MINT,
          amount: 30n,
          state: 2,
        }),
        accountFixture({
          address: ACCOUNT_ADDRESSES[3],
          mint: COUNTERFEIT_MINT,
          amount: 999n,
        }),
        accountFixture({ address: ACCOUNT_ADDRESSES[4], closed: true }),
      ],
    );
    source.responses[SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
      [
        accountFixture({
          address: ACCOUNT_ADDRESSES[5],
          programId: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
          mint: PYUSD_MINT,
          amount: 500n,
          state: 0,
        }),
      ],
    );
    const signal = new AbortController().signal;

    const result = await new SolanaDepositIndexerService(source).index(indexRequest({ signal }));

    expect(result).toMatchObject({
      completeness: 'COMPLETE',
      authority: 'DISPLAY_ONLY',
      tier: 'PROVISIONAL',
      commitment: 'confirmed',
      environment: 'MAINNET',
      networkId: MAINNET_NETWORK,
      ownerAddress: OWNER,
      sourceSlot: 900n,
      registryVersion: 1,
      registryFingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
      sourceAccountCount: 6,
      exclusions: {
        closedAccounts: 1,
        uninitializedAccounts: 1,
        unsupportedMintAccounts: 1,
      },
    });
    const registryAssets = MAINNET_SUPPORTED_ASSET_REGISTRY.latest.assets.filter(
      ({ chain }) => chain === 'SOLANA',
    );
    expect(result.balances.map(({ assetId }) => assetId)).toEqual(
      registryAssets.map(({ qualifiedIdentity }) => qualifiedIdentity),
    );
    expect(result.balances).toEqual([
      expect.objectContaining({
        stablecoin: 'USDC',
        mintAddress: USDC_MINT,
        amountBaseUnits: 9_007_199_254_741_000n,
        activeAmountBaseUnits: 9_007_199_254_741_000n,
        frozenAmountBaseUnits: 0n,
        activeTokenAccountCount: 2,
        frozenTokenAccountCount: 0,
        sourceSlot: 900n,
      }),
      expect.objectContaining({
        stablecoin: 'USDT',
        amountBaseUnits: 30n,
        activeAmountBaseUnits: 0n,
        frozenAmountBaseUnits: 30n,
        activeTokenAccountCount: 0,
        frozenTokenAccountCount: 1,
        sourceSlot: 900n,
      }),
      expect.objectContaining({
        stablecoin: 'PYUSD',
        amountBaseUnits: 0n,
        activeAmountBaseUnits: 0n,
        sourceSlot: 900n,
      }),
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.balances)).toBe(true);
    expect(result.balances.every((balance) => Object.isFrozen(balance))).toBe(true);
    expect(source.calls).toEqual([
      { method: 'getGenesisHash', context: { signal } },
      {
        method: 'getTokenAccountsByOwner',
        request: {
          ownerAddress: OWNER,
          tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
          commitment: 'confirmed',
          minContextSlot: 850n,
          signal,
        },
      },
      {
        method: 'getTokenAccountsByOwner',
        request: {
          ownerAddress: OWNER,
          tokenProgramId: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
          commitment: 'confirmed',
          minContextSlot: 850n,
          signal,
        },
      },
    ]);
  });

  it('requires a network-bound live capability before confirmed canonical reads', async () => {
    const source = new FakeSolanaDepositSource();
    const service = new SolanaDepositIndexerService(source);
    await expectIndexError(
      service.index(indexRequest({ tier: 'CANONICAL' })),
      'LIVE_CAPABILITY_PROOF_REQUIRED',
    );
    expect(source.calls).toHaveLength(0);

    await expectIndexError(
      service.index(
        indexRequest({
          tier: 'CANONICAL',
          canonicalReadCapability: {
            networkId: MAINNET_NETWORK,
            confirmedTokenAccountReadsValidated: true,
          },
        }),
      ),
      'LIVE_CAPABILITY_PROOF_REQUIRED',
    );
    expect(source.calls).toHaveLength(0);

    const opaqueCapability = Object.freeze({ proofId: 'local-fixture-capability' });
    const verifier: jest.Mocked<SolanaCanonicalReadCapabilityVerifierPort> = {
      verify: jest.fn(
        (capability: unknown, context: SolanaCanonicalReadCapabilityContext): boolean =>
          capability === opaqueCapability && context.networkId === MAINNET_NETWORK,
      ),
    };
    const verifiedService = new SolanaDepositIndexerService(source, verifier);
    await expectIndexError(
      verifiedService.index(
        indexRequest({ tier: 'CANONICAL', canonicalReadCapability: { ...opaqueCapability } }),
      ),
      'LIVE_CAPABILITY_PROOF_REQUIRED',
    );
    expect(source.calls).toHaveLength(0);

    const result = await verifiedService.index(
      indexRequest({
        tier: 'CANONICAL',
        canonicalReadCapability: opaqueCapability,
      }),
    );
    expect(result.authority).toBe('CANONICAL_INDEXING');
    expect(result.commitment).toBe('confirmed');
    expect(
      source.calls.every(
        (call) =>
          call.method !== 'getTokenAccountsByOwner' || call.request.commitment === 'confirmed',
      ),
    ).toBe(true);
    expect(verifier.verify).toHaveBeenLastCalledWith(opaqueCapability, {
      environment: 'MAINNET',
      networkId: MAINNET_NETWORK,
      commitment: 'confirmed',
    });
    expect(Object.isFrozen(verifier.verify.mock.calls.at(-1)?.[1])).toBe(true);
  });

  it('fails canonical reads closed when the trusted capability verifier fails', async () => {
    const source = new FakeSolanaDepositSource();
    const verifier: SolanaCanonicalReadCapabilityVerifierPort = {
      verify: () => {
        throw new Error('private verifier detail');
      },
    };

    const error = await expectIndexError(
      new SolanaDepositIndexerService(source, verifier).index(
        indexRequest({ tier: 'CANONICAL', canonicalReadCapability: Symbol('opaque') }),
      ),
      'LIVE_CAPABILITY_PROOF_REQUIRED',
    );
    expect(source.calls).toEqual([]);
    expect(error.message).not.toContain('private verifier detail');
  });

  it('rejects financial use, unsupported networks, environment crossover, invalid owners, and slots', async () => {
    const source = new FakeSolanaDepositSource();
    const service = new SolanaDepositIndexerService(source);
    await expectIndexError(
      service.index(indexRequest({ tier: 'FINANCIAL' as 'PROVISIONAL' })),
      'TIER_NOT_AVAILABLE',
    );
    await expectIndexError(
      service.index(indexRequest({ networkId: 'eip155:1' })),
      'UNSUPPORTED_NETWORK',
    );
    await expectIndexError(
      service.index(indexRequest({ environment: 'TESTNET' })),
      'ENVIRONMENT_MISMATCH',
    );
    await expectIndexError(
      service.index(indexRequest({ ownerAddress: 'not-a-public-key' })),
      'INVALID_OWNER_ADDRESS',
    );
    await expectIndexError(
      service.index(indexRequest({ minContextSlot: -1n })),
      'INVALID_MIN_CONTEXT_SLOT',
    );
  });

  it('validates exact genesis identity before reading balances', async () => {
    const source = new FakeSolanaDepositSource();
    source.genesisHash = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
    await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest()),
      'IDENTITY_MISMATCH',
    );
    expect(source.calls.map(({ method }) => method)).toEqual(['getGenesisHash']);
  });

  it('fails closed on source errors and never exposes provider error text', async () => {
    const source = new FakeSolanaDepositSource();
    source.sourceError = new Error('secret-provider-url?apiKey=do-not-expose');
    const error = await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest()),
      'SOURCE_READ_FAILED',
    );
    expect(error.message).toBe('SOURCE_READ_FAILED');
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain('do-not-expose');
  });

  it('rejects regressing and incoherent response slots instead of publishing a mixed snapshot', async () => {
    const source = new FakeSolanaDepositSource();
    source.responses[SOLANA_TOKEN_PROGRAM_IDS.LEGACY] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
      [],
      900n,
    );
    source.responses[SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
      [],
      901n,
    );
    await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest()),
      'INCOHERENT_SOURCE_SLOTS',
    );

    source.responses[SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
      [],
      900n,
    );
    await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest({ minContextSlot: 901n })),
      'SOURCE_SLOT_REGRESSION',
    );
  });

  it('rejects duplicate account identities across token programs before aggregation', async () => {
    const source = new FakeSolanaDepositSource();
    source.responses[SOLANA_TOKEN_PROGRAM_IDS.LEGACY] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
      [accountFixture({ address: ACCOUNT_ADDRESSES[0], closed: true })],
    );
    source.responses[SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
      [
        accountFixture({
          address: ACCOUNT_ADDRESSES[0],
          programId: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
          closed: true,
        }),
      ],
    );
    await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest()),
      'DUPLICATE_TOKEN_ACCOUNT',
    );
  });

  it('fails closed on malformed source values, wrong wallet ownership, and accessor fields', async () => {
    const source = new FakeSolanaDepositSource();
    source.responses[SOLANA_TOKEN_PROGRAM_IDS.LEGACY] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
      [accountFixture({ address: ACCOUNT_ADDRESSES[0], owner: OTHER_OWNER })],
    );
    await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest()),
      'INVALID_SOURCE_RESPONSE',
    );

    source.responses[SOLANA_TOKEN_PROGRAM_IDS.LEGACY] = {
      contextSlot: 900n,
      accounts: [
        {
          address: ACCOUNT_ADDRESSES[0],
          programId: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
          data: null,
        },
      ],
    };
    await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest()),
      'INVALID_SOURCE_RESPONSE',
    );

    let accessorInvoked = false;
    source.responses[SOLANA_TOKEN_PROGRAM_IDS.LEGACY] = {
      get contextSlot(): bigint {
        accessorInvoked = true;
        return 900n;
      },
      accounts: [],
    };
    await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest()),
      'INVALID_SOURCE_RESPONSE',
    );
    expect(accessorInvoked).toBe(false);

    source.responses[SOLANA_TOKEN_PROGRAM_IDS.LEGACY] = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('provider-secret-in-proxy-trap');
        },
      },
    );
    const error = await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest()),
      'INVALID_SOURCE_RESPONSE',
    );
    expect(error.message).not.toContain('provider-secret');

    const spoofedBytes = {
      length: 165,
      [Symbol.toStringTag]: 'Uint8Array',
    };
    source.responses[SOLANA_TOKEN_PROGRAM_IDS.LEGACY] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
      [
        Object.freeze({
          address: ACCOUNT_ADDRESSES[0],
          programId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
          data: spoofedBytes,
        }),
      ],
    );
    await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest()),
      'INVALID_SOURCE_RESPONSE',
    );

    source.responses[SOLANA_TOKEN_PROGRAM_IDS.LEGACY] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
      [
        Object.freeze({
          address: ACCOUNT_ADDRESSES[0],
          programId: SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
          data: new Uint8Array(4_097),
        }),
      ],
    );
    await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest()),
      'INVALID_SOURCE_RESPONSE',
    );
  });

  it('enforces the KAN-62 per-job read-unit ceiling across both token programs', async () => {
    const source = new FakeSolanaDepositSource();
    const closed = accountFixture({ address: ACCOUNT_ADDRESSES[0], closed: true });
    source.responses[SOLANA_TOKEN_PROGRAM_IDS.LEGACY] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.LEGACY,
      new Array<Readonly<Record<string, unknown>>>(2_048).fill(closed),
    );
    source.responses[SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022] = sourceResponse(
      SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
      [
        accountFixture({
          address: ACCOUNT_ADDRESSES[1],
          programId: SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022,
          closed: true,
        }),
      ],
    );
    await expectIndexError(
      new SolanaDepositIndexerService(source).index(indexRequest()),
      'READ_UNIT_LIMIT_EXCEEDED',
    );
  });

  it('supports the configured devnet identity without mixing mainnet assets', async () => {
    const source = new FakeSolanaDepositSource();
    source.genesisHash = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
    const result = await new SolanaDepositIndexerService(source).index(
      indexRequest({ environment: 'TESTNET', networkId: DEVNET_NETWORK }),
    );
    expect(result.balances.map(({ stablecoin }) => stablecoin)).toEqual(['USDC', 'PYUSD']);
    expect(result.balances.every(({ sourceSlot }) => sourceSlot === 900n)).toBe(true);
  });
});
