import {
  attestSolanaMainnetBalanceDeploymentIdentity,
  createBalanceSyncExecutionContext,
  reviewMainnetBalanceDeploymentIdentityAttestation,
  type ReviewedMainnetBalanceDeploymentIdentityAttestation,
  type SolanaMainnetBalanceDeploymentIdentityVerificationRequest,
} from '../../application/ports/balance-sync.ports';
import { decodeSolanaPublicKey } from '../../../blockchain/domain/solana-token-account';
import type { BalanceJsonRpcRequest, BalanceJsonRpcTransport } from './balance-json-rpc';
import {
  SOLANA_BPF_UPGRADEABLE_LOADER_V3,
  SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_VERSION,
  SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID,
  fingerprintSolanaMainnetBalanceDeploymentManifestV1,
  type SolanaMainnetBalanceDeploymentManifestContentV1,
  type SolanaMainnetBalanceDeploymentManifestV1,
} from './solana-mainnet-balance-deployment.manifest';
import {
  createDormantSolanaMainnetBalanceDeploymentIdentityVerifier,
  fingerprintSolanaMainnetMintConfigurationV1,
  fingerprintSolanaMainnetProgramBinaryV1,
} from './solana-mainnet-balance-deployment-identity.verifier';

const PYUSD_MINT = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const LEGACY_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const LEGACY_PROGRAM_DATA = 'SysvarC1ock11111111111111111111111111111111';
const TOKEN_2022_PROGRAM_DATA = 'SysvarRent111111111111111111111111111111111';
const AUTHORITY = 'Vote111111111111111111111111111111111111111';
const SOURCE_HASH = 'Stake11111111111111111111111111111111111111';
const PARENT_HASH = 'AddressLookupTab1e1111111111111111111111111';
const GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const SOURCE_SLOT = 250;

interface RpcAccount {
  data: [string, 'base64'];
  executable: boolean;
  lamports: number;
  owner: string;
  rentEpoch: number;
  space: number;
}

interface Fixture {
  readonly manifest: SolanaMainnetBalanceDeploymentManifestV1;
  readonly request: SolanaMainnetBalanceDeploymentIdentityVerificationRequest;
  readonly accounts: RpcAccount[];
  readonly binaryByProgram: Readonly<Record<string, Uint8Array>>;
}

interface ApprovedManifestFixture extends SolanaMainnetBalanceDeploymentManifestV1 {
  readonly testData: {
    readonly pyusd: Uint8Array;
    readonly usdc: Uint8Array;
    readonly usdt: Uint8Array;
    readonly legacyBinary: Uint8Array;
    readonly token2022Binary: Uint8Array;
  };
}

function mintBytes(
  mintAuthority: string | null,
  freezeAuthority: string | null,
  token2022: boolean,
  supply = 1_000_000n,
): Uint8Array {
  const data = new Uint8Array(token2022 ? 166 : 82);
  writeCOption(data, 0, 4, mintAuthority);
  new DataView(data.buffer).setBigUint64(36, supply, true);
  data[44] = 6;
  data[45] = 1;
  writeCOption(data, 46, 50, freezeAuthority);
  if (token2022) data[165] = 1;
  return data;
}

function programBytes(programDataAddress: string): Uint8Array {
  const data = new Uint8Array(36);
  new DataView(data.buffer).setUint32(0, 2, true);
  data.set(decodeSolanaPublicKey(programDataAddress), 4);
  return data;
}

function programDataBytes(
  deployedAtSlot: bigint,
  upgradeAuthority: string | null,
  binary: Uint8Array,
): Uint8Array {
  const data = new Uint8Array(45 + binary.byteLength);
  const view = new DataView(data.buffer);
  view.setUint32(0, 3, true);
  view.setBigUint64(4, deployedAtSlot, true);
  if (upgradeAuthority === null) {
    data[12] = 0;
  } else {
    data[12] = 1;
    data.set(decodeSolanaPublicKey(upgradeAuthority), 13);
  }
  data.set(binary, 45);
  return data;
}

function writeCOption(
  data: Uint8Array,
  discriminatorOffset: number,
  keyOffset: number,
  value: string | null,
): void {
  new DataView(data.buffer).setUint32(discriminatorOffset, value === null ? 0 : 1, true);
  if (value !== null) data.set(decodeSolanaPublicKey(value), keyOffset);
}

function rpcAccount(data: Uint8Array, owner: string, executable: boolean): RpcAccount {
  return {
    data: [Buffer.from(data).toString('base64'), 'base64'],
    executable,
    lamports: 1,
    owner,
    rentEpoch: 0,
    space: data.byteLength,
  };
}

function approvedManifest(): ApprovedManifestFixture {
  const pyusd = mintBytes(AUTHORITY, AUTHORITY, true);
  const usdc = mintBytes(null, null, false);
  const usdt = mintBytes(AUTHORITY, null, false);
  const legacyBinary = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 1]);
  const token2022Binary = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 2]);
  const content: SolanaMainnetBalanceDeploymentManifestContentV1 = {
    schemaVersion: SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_VERSION,
    environment: 'MAINNET',
    networkId: SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID,
    approvalStatus: 'APPROVED',
    approvedAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-10-01T00:00:00.000Z',
    validFromSlot: '200',
    validThroughSlot: '300',
    assets: [
      {
        stablecoin: 'PYUSD',
        mintAddress: PYUSD_MINT,
        tokenProgramAddress: TOKEN_2022_PROGRAM,
        decimals: 6,
        mintAuthorityAddress: AUTHORITY,
        freezeAuthorityAddress: AUTHORITY,
        mintConfigurationSha256: fingerprintSolanaMainnetMintConfigurationV1(pyusd),
      },
      {
        stablecoin: 'USDC',
        mintAddress: USDC_MINT,
        tokenProgramAddress: LEGACY_TOKEN_PROGRAM,
        decimals: 6,
        mintAuthorityAddress: null,
        freezeAuthorityAddress: null,
        mintConfigurationSha256: fingerprintSolanaMainnetMintConfigurationV1(usdc),
      },
      {
        stablecoin: 'USDT',
        mintAddress: USDT_MINT,
        tokenProgramAddress: LEGACY_TOKEN_PROGRAM,
        decimals: 6,
        mintAuthorityAddress: AUTHORITY,
        freezeAuthorityAddress: null,
        mintConfigurationSha256: fingerprintSolanaMainnetMintConfigurationV1(usdt),
      },
    ],
    programs: [
      {
        route: 'BPF_UPGRADEABLE_LOADER_V3',
        programAddress: LEGACY_TOKEN_PROGRAM,
        loaderAddress: SOLANA_BPF_UPGRADEABLE_LOADER_V3,
        programDataAddress: LEGACY_PROGRAM_DATA,
        deployedAtSlot: '100',
        upgradeAuthorityAddress: null,
        programBinarySha256: fingerprintSolanaMainnetProgramBinaryV1(legacyBinary),
      },
      {
        route: 'BPF_UPGRADEABLE_LOADER_V3',
        programAddress: TOKEN_2022_PROGRAM,
        loaderAddress: SOLANA_BPF_UPGRADEABLE_LOADER_V3,
        programDataAddress: TOKEN_2022_PROGRAM_DATA,
        deployedAtSlot: '150',
        upgradeAuthorityAddress: AUTHORITY,
        programBinarySha256: fingerprintSolanaMainnetProgramBinaryV1(token2022Binary),
      },
    ],
  };
  return {
    ...content,
    fingerprintSha256: fingerprintSolanaMainnetBalanceDeploymentManifestV1(content),
    testData: { pyusd, usdc, usdt, legacyBinary, token2022Binary },
  };
}

function fixture(): Fixture {
  const manifestWithTestData = approvedManifest();
  const { testData, ...manifest } = manifestWithTestData;
  return {
    manifest,
    request: {
      networkId: SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID,
      sourcePosition: String(SOURCE_SLOT),
      sourceHash: SOURCE_HASH,
      assetIdentities: [PYUSD_MINT, USDC_MINT, USDT_MINT],
    },
    accounts: [
      rpcAccount(testData.pyusd, TOKEN_2022_PROGRAM, false),
      rpcAccount(testData.usdc, LEGACY_TOKEN_PROGRAM, false),
      rpcAccount(testData.usdt, LEGACY_TOKEN_PROGRAM, false),
      rpcAccount(programBytes(LEGACY_PROGRAM_DATA), SOLANA_BPF_UPGRADEABLE_LOADER_V3, true),
      rpcAccount(programBytes(TOKEN_2022_PROGRAM_DATA), SOLANA_BPF_UPGRADEABLE_LOADER_V3, true),
      rpcAccount(
        programDataBytes(100n, null, testData.legacyBinary),
        SOLANA_BPF_UPGRADEABLE_LOADER_V3,
        false,
      ),
      rpcAccount(
        programDataBytes(150n, AUTHORITY, testData.token2022Binary),
        SOLANA_BPF_UPGRADEABLE_LOADER_V3,
        false,
      ),
    ],
    binaryByProgram: {
      [LEGACY_TOKEN_PROGRAM]: testData.legacyBinary,
      [TOKEN_2022_PROGRAM]: testData.token2022Binary,
    },
  };
}

function result(request: BalanceJsonRpcRequest, value: unknown): unknown {
  return { jsonrpc: '2.0', id: request.id, result: value };
}

function transportFor(
  current: Fixture,
  options: Readonly<{
    accountContextSlot?: number;
    secondBlockHash?: string;
    secondParentHash?: string;
  }> = {},
): BalanceJsonRpcTransport & { readonly exchange: jest.Mock } {
  let blockReads = 0;
  const exchange = jest.fn(async (request: BalanceJsonRpcRequest) => {
    if (request.method === 'getGenesisHash') return result(request, GENESIS_HASH);
    if (request.method === 'getBlock') {
      blockReads += 1;
      return result(request, {
        blockhash:
          blockReads === 2 && options.secondBlockHash !== undefined
            ? options.secondBlockHash
            : SOURCE_HASH,
        parentSlot: SOURCE_SLOT - 1,
        previousBlockhash:
          blockReads === 2 && options.secondParentHash !== undefined
            ? options.secondParentHash
            : PARENT_HASH,
      });
    }
    if (request.method === 'getMultipleAccounts') {
      return result(request, {
        context: { slot: options.accountContextSlot ?? SOURCE_SLOT },
        value: current.accounts,
      });
    }
    throw new Error(`unexpected method ${request.method}`);
  });
  return { exchange };
}

async function attest(
  current: Fixture,
  transport: BalanceJsonRpcTransport,
): Promise<Readonly<ReviewedMainnetBalanceDeploymentIdentityAttestation> | null> {
  const verifier = createDormantSolanaMainnetBalanceDeploymentIdentityVerifier(
    current.manifest,
    current.manifest.fingerprintSha256,
    transport,
    { now: () => new Date('2026-09-06T12:00:00.000Z') },
  );
  const execution = createBalanceSyncExecutionContext();
  const value = await attestSolanaMainnetBalanceDeploymentIdentity(
    verifier,
    current.request,
    execution.context,
  );
  return reviewMainnetBalanceDeploymentIdentityAttestation(value, current.request);
}

describe('dormant Solana mainnet balance deployment identity verifier', () => {
  it('binds exact-slot mint configuration and loader-v3 program identities', async () => {
    const current = fixture();
    const transport = transportFor(current);

    const claims = await attest(current, transport);

    expect(claims).toEqual({
      deploymentIdentityValidated: true,
      approvedManifestFingerprintSha256: current.manifest.fingerprintSha256,
      observedIdentityFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(transport.exchange.mock.calls.map(([request]) => request.method)).toEqual([
      'getGenesisHash',
      'getBlock',
      'getMultipleAccounts',
      'getBlock',
      'getGenesisHash',
    ]);
    expect(transport.exchange.mock.calls[1]?.[0].params).toEqual([
      SOURCE_SLOT,
      { commitment: 'finalized', transactionDetails: 'none', rewards: false },
    ]);
    expect(transport.exchange.mock.calls[2]?.[0].params).toEqual([
      [
        PYUSD_MINT,
        USDC_MINT,
        USDT_MINT,
        LEGACY_TOKEN_PROGRAM,
        TOKEN_2022_PROGRAM,
        LEGACY_PROGRAM_DATA,
        TOKEN_2022_PROGRAM_DATA,
      ],
      { commitment: 'finalized', encoding: 'base64', minContextSlot: SOURCE_SLOT },
    ]);
  });

  it('excludes mutable mint supply from deployment identity', async () => {
    const first = fixture();
    const second = fixture();
    const changed = mintBytes(AUTHORITY, AUTHORITY, true, 9_999_999n);
    second.accounts[0] = rpcAccount(changed, TOKEN_2022_PROGRAM, false);

    const [firstClaims, secondClaims] = await Promise.all([
      attest(first, transportFor(first)),
      attest(second, transportFor(second)),
    ]);

    expect(firstClaims?.observedIdentityFingerprintSha256).toBe(
      secondClaims?.observedIdentityFingerprintSha256,
    );
  });

  it.each([
    [
      'account context advances past the selected slot',
      (current: Fixture) => transportFor(current, { accountContextSlot: SOURCE_SLOT + 1 }),
    ],
    [
      'the exact block changes during verification',
      (current: Fixture) => transportFor(current, { secondBlockHash: AUTHORITY }),
    ],
    [
      'the provider changes the parent transcript for the same block hash',
      (current: Fixture) => transportFor(current, { secondParentHash: AUTHORITY }),
    ],
    [
      'a mint configuration differs',
      (current: Fixture) => {
        const bytes = Buffer.from(current.accounts[0]!.data[0], 'base64');
        bytes[44] = 5;
        current.accounts[0] = rpcAccount(bytes, TOKEN_2022_PROGRAM, false);
        return transportFor(current);
      },
    ],
    [
      'a program binary differs',
      (current: Fixture) => {
        const binary = Uint8Array.from([...current.binaryByProgram[LEGACY_TOKEN_PROGRAM]!, 99]);
        current.accounts[5] = rpcAccount(
          programDataBytes(100n, null, binary),
          SOLANA_BPF_UPGRADEABLE_LOADER_V3,
          false,
        );
        return transportFor(current);
      },
    ],
    [
      'a loader route points at another ProgramData account',
      (current: Fixture) => {
        current.accounts[3] = rpcAccount(
          programBytes(TOKEN_2022_PROGRAM_DATA),
          SOLANA_BPF_UPGRADEABLE_LOADER_V3,
          true,
        );
        return transportFor(current);
      },
    ],
  ])('fails closed when %s', async (_label, buildTransport) => {
    const current = fixture();
    await expect(attest(current, buildTransport(current))).rejects.toThrow(
      'mainnet balance deployment identity verification unavailable',
    );
  });

  it('requires a separately supplied, exact approved-manifest fingerprint', () => {
    const current = fixture();
    const transport = transportFor(current);

    expect(() =>
      createDormantSolanaMainnetBalanceDeploymentIdentityVerifier(
        current.manifest,
        'f'.repeat(64),
        transport,
        { now: () => new Date('2026-09-06T12:00:00.000Z') },
      ),
    ).toThrow('Solana deployment identity verifier unavailable');
    expect(transport.exchange).not.toHaveBeenCalled();
  });

  it('rechecks approval expiry after provider reads', async () => {
    const current = fixture();
    const transport = transportFor(current);
    const now = jest
      .fn()
      .mockReturnValueOnce(new Date('2026-09-06T12:00:00.000Z'))
      .mockReturnValueOnce(new Date('2026-10-01T00:00:00.000Z'));
    const verifier = createDormantSolanaMainnetBalanceDeploymentIdentityVerifier(
      current.manifest,
      current.manifest.fingerprintSha256,
      transport,
      { now },
    );
    const execution = createBalanceSyncExecutionContext();

    await expect(
      attestSolanaMainnetBalanceDeploymentIdentity(verifier, current.request, execution.context),
    ).rejects.toThrow('mainnet balance deployment identity verification unavailable');
    expect(now).toHaveBeenCalledTimes(2);
  });

  it('passes the owned abort signal through so accepted I/O can drain cooperatively', async () => {
    const current = fixture();
    let transportAborted = false;
    const exchange = jest.fn(
      (request: BalanceJsonRpcRequest, signal: AbortSignal): Promise<unknown> =>
        new Promise((_resolve, reject) => {
          expect(request.method).toBe('getGenesisHash');
          signal.addEventListener(
            'abort',
            () => {
              transportAborted = true;
              reject(new Error('cooperative transport abort'));
            },
            { once: true },
          );
        }),
    );
    const verifier = createDormantSolanaMainnetBalanceDeploymentIdentityVerifier(
      current.manifest,
      current.manifest.fingerprintSha256,
      { exchange },
      { now: () => new Date('2026-09-06T12:00:00.000Z') },
    );
    const execution = createBalanceSyncExecutionContext();
    const pending = attestSolanaMainnetBalanceDeploymentIdentity(
      verifier,
      current.request,
      execution.context,
    );
    await Promise.resolve();

    execution.abort('DEADLINE');

    await expect(pending).rejects.toThrow(
      'mainnet balance deployment identity verification unavailable',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(transportAborted).toBe(true);
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('does not create a verifier from the checked-in unapproved posture', async () => {
    const { SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_V1 } =
      await import('./solana-mainnet-balance-deployment.manifest');
    const current = fixture();
    const transport = transportFor(current);

    expect(() =>
      createDormantSolanaMainnetBalanceDeploymentIdentityVerifier(
        SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_V1,
        SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_V1.fingerprintSha256,
        transport,
        { now: () => new Date('2026-09-06T12:00:00.000Z') },
      ),
    ).toThrow('Solana deployment identity verifier unavailable');
    expect(transport.exchange).not.toHaveBeenCalled();
  });
});
