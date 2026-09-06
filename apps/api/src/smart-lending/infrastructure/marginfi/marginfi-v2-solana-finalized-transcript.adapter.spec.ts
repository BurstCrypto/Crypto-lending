import { createHash } from 'node:crypto';

import { PublicKey } from '@solana/web3.js';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../../blockchain/domain/supported-asset-registry';
import { MAINNET_PLATFORM_DIRECTORY } from '../../../mainnet-platforms/domain/mainnet-platform-directory';
import { SMART_LENDING_PROVIDER_IDS } from '../../application/ports/live-lending-market-feed.port';
import {
  createMarginfiV2SolanaManifest,
  type MarginfiV2Manifest,
  MARGINFI_V2_SOLANA_MAINNET_IDENTITIES as ID,
  MARGINFI_V2_SOLANA_SOURCE_PINS as SOURCE,
  MarginfiV2SolanaFinalizedTranscriptAdapter,
  type MarginfiV2SolanaJsonRpcRequest,
  type MarginfiV2SolanaJsonRpcTranscriptTransport,
  type MarginfiV2SolanaTranscriptClock,
  MarginfiV2SolanaTranscriptUnavailableError,
  type ReadMarginfiV2SolanaTranscriptRequest,
} from './marginfi-v2-solana-finalized-transcript.adapter';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const NOW_SECONDS = 1_767_225_600;
const MINIMUM_SLOT = 995;
const SLOT = 1_000;
const DEPLOYED_SLOT = 900;
const PROGRAM_DATA_ADDRESS = 'BPFLoader2111111111111111111111111111111111';
const UPGRADE_AUTHORITY = 'Config1111111111111111111111111111111111111';
const ORACLE_ADDRESS = 'SysvarC1ock11111111111111111111111111111111';
const GROUP_BYTES = 9_256;
const BANK_BYTES = 1_864;
const MINT_BYTES = 82;
const TOKEN_ACCOUNT_BYTES = 165;
const PROGRAM_DATA_HEADER_BYTES = 45;
const BANK_DISCRIMINATOR = [142, 49, 166, 242, 50, 66, 97, 188] as const;
const GROUP_DISCRIMINATOR = [182, 23, 173, 240, 151, 206, 182, 67] as const;

interface RpcAccount {
  data: [string, 'base64'];
  executable: boolean;
  lamports: number;
  owner: string;
  rentEpoch: number;
  space: number;
}

interface AccountsResult {
  context: { slot: number; apiVersion?: string };
  value: Array<RpcAccount | null>;
}

interface RpcBlock {
  blockHeight: number | null;
  blockTime: number | null;
  blockhash: string;
  parentSlot: number;
  previousBlockhash: string;
}

interface Fixture {
  accounts: RpcAccount[];
  accountResult: AccountsResult;
  blockBefore: RpcBlock;
  blockAfter: RpcBlock;
  responses: Map<number, unknown>;
  manifest: MarginfiV2Manifest;
  authority: string | null;
  transport: FakeTransport;
  clock: MarginfiV2SolanaTranscriptClock;
}

const REQUEST: ReadMarginfiV2SolanaTranscriptRequest = Object.freeze({
  marketId: 'marginfi-v2-solana-mainnet-main-usdc',
  programAddress: ID.programAddress,
  groupAddress: ID.mainGroupAddress,
  bankAddress: ID.usdcBankAddress,
  assetMintAddress: ID.usdcMintAddress,
});

class FakeTransport implements MarginfiV2SolanaJsonRpcTranscriptTransport {
  readonly calls: MarginfiV2SolanaJsonRpcRequest[] = [];
  throwAtId: number | undefined;

  constructor(readonly responses: Map<number, unknown>) {}

  async exchange(request: MarginfiV2SolanaJsonRpcRequest): Promise<unknown> {
    this.calls.push(request);
    if (request.id === this.throwAtId) throw new Error('sensitive upstream detail');
    return this.responses.get(request.id);
  }
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function keyBytes(address: string): Uint8Array {
  return new PublicKey(address).toBytes();
}

function writeKey(data: Buffer, offset: number, address: string): void {
  data.set(keyBytes(address), offset);
}

function writeU128(data: Buffer, offset: number, value: bigint): void {
  data.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  data.writeBigUInt64LE(value >> 64n, offset + 8);
}

function programBytes(): Buffer {
  const data = Buffer.alloc(36);
  data.writeUInt32LE(2, 0);
  writeKey(data, 4, PROGRAM_DATA_ADDRESS);
  return data;
}

function programDataBytes(authority: string | null = UPGRADE_AUTHORITY): Buffer {
  const data = Buffer.alloc(PROGRAM_DATA_HEADER_BYTES + 64);
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(BigInt(DEPLOYED_SLOT), 4);
  if (authority === null) {
    data[12] = 0;
  } else {
    data[12] = 1;
    writeKey(data, 13, authority);
  }
  data.set([0x7f, 0x45, 0x4c, 0x46], PROGRAM_DATA_HEADER_BYTES);
  data.fill(0x5a, PROGRAM_DATA_HEADER_BYTES + 4);
  return data;
}

function groupBytes(length = GROUP_BYTES): Buffer {
  const data = Buffer.alloc(length);
  data.set(GROUP_DISCRIMINATOR, 0);
  writeKey(data, 8, UPGRADE_AUTHORITY);
  data.writeBigUInt64LE(1n, 40);
  data.writeUInt16LE(25, 120);
  return data;
}

function bankBytes(): Buffer {
  const data = Buffer.alloc(BANK_BYTES);
  data.set(BANK_DISCRIMINATOR, 0);
  writeKey(data, 8, ID.usdcMintAddress);
  data[40] = 6;
  writeKey(data, 41, ID.mainGroupAddress);
  writeU128(data, 80, 1n << 48n);
  writeU128(data, 96, (1n << 48n) + 100n);
  writeKey(data, 112, ID.liquidityVaultAddress);
  data[144] = ID.liquidityVaultBump;
  data[145] = ID.liquidityVaultAuthorityBump;
  writeKey(data, 146, ID.insuranceVaultAddress);
  data[178] = ID.insuranceVaultBump;
  data[179] = ID.insuranceVaultAuthorityBump;
  writeKey(data, 200, ID.feeVaultAddress);
  data[232] = ID.feeVaultBump;
  data[233] = ID.feeVaultAuthorityBump;
  writeU128(data, 256, 300n << 48n);
  writeU128(data, 272, 500n << 48n);
  data.writeBigInt64LE(BigInt(NOW_SECONDS - 15), 288);
  data.writeBigUInt64LE(10_000_000_000n, 360);
  data[608] = 1;
  data[609] = 3;
  writeKey(data, 610, ORACLE_ADDRESS);
  data.writeBigUInt64LE(8_000_000_000n, 776);
  data[784] = 0;
  data[785] = 0;
  data[786] = 0;
  data.writeUInt16LE(60, 800);
  data.writeBigUInt64LE(0n, 840);
  writeU128(data, 1_408, 1n << 48n);
  data.writeBigInt64LE(BigInt(NOW_SECONDS - 12), 1_424);
  writeU128(data, 1_432, 1n << 32n);
  data[1_448] = 0;
  data.writeInt32LE(200, 1_536);
  data.writeInt32LE(80, 1_540);
  data[1_776] = 0;
  return data;
}

function mintBytes(): Buffer {
  const data = Buffer.alloc(MINT_BYTES);
  data.writeUInt32LE(1, 0);
  writeKey(data, 4, UPGRADE_AUTHORITY);
  data.writeBigUInt64LE(50_000_000_000n, 36);
  data[44] = 6;
  data[45] = 1;
  data.writeUInt32LE(1, 46);
  writeKey(data, 50, ID.mainGroupAddress);
  return data;
}

function tokenAccountBytes(authorityAddress: string, amount: bigint): Buffer {
  const data = Buffer.alloc(TOKEN_ACCOUNT_BYTES);
  writeKey(data, 0, ID.usdcMintAddress);
  writeKey(data, 32, authorityAddress);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data;
}

function rpcAccount(data: Buffer, owner: string, executable: boolean): RpcAccount {
  return {
    data: [data.toString('base64'), 'base64'],
    executable,
    lamports: 1_000_000,
    owner,
    rentEpoch: Number((1n << 64n) - 1n),
    space: data.byteLength,
  };
}

function decodeAccount(account: RpcAccount): Buffer {
  return Buffer.from(account.data[0], 'base64');
}

function sourceDefinition(): MarginfiV2Manifest['sources'] {
  return {
    marginfiV2CommitSha: SOURCE.marginfiV2CommitSha,
    p0TsSdkCommitSha: SOURCE.p0TsSdkCommitSha,
    solanaLoaderCommitSha: SOURCE.solanaLoaderCommitSha,
    splTokenCommitSha: SOURCE.splTokenCommitSha,
    bankLayout: SOURCE.bankLayout,
    bankConfigLayout: SOURCE.bankConfigLayout,
    bankCacheLayout: SOURCE.bankCacheLayout,
    groupLayout: SOURCE.groupLayout,
    loaderLayout: SOURCE.loaderLayout,
    mintLayout: SOURCE.mintLayout,
    tokenAccountLayout: SOURCE.tokenAccountLayout,
    bankIdentityEvidence: SOURCE.bankIdentityEvidence,
  };
}

function manifestDefinition(
  accounts: readonly RpcAccount[],
  authority: string | null,
): Omit<
  MarginfiV2Manifest,
  'sourceFingerprintSha256' | 'deploymentFingerprintSha256' | 'manifestFingerprintSha256'
> {
  const decoded = accounts.map(decodeAccount);
  const [program, programData, group, bank, mint, liquidity, insurance, fee] = decoded;
  if (!program || !programData || !group || !bank || !mint || !liquidity || !insurance || !fee) {
    throw new Error('fixture accounts');
  }
  return {
    schemaVersion: 1,
    use: 'DORMANT_MARGINFI_V2_USDC_CORROBORATION_ONLY',
    sources: sourceDefinition(),
    assetRegistry: {
      environment: 'MAINNET',
      version: 1,
      fingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    },
    networkId: ID.networkId,
    genesisHash: ID.genesisHash,
    commitment: 'finalized',
    snapshotBinding: 'ONE_GET_MULTIPLE_ACCOUNTS_MIN_CONTEXT_SLOT',
    maximumAgeSeconds: '60',
    deployment: {
      programAddress: ID.programAddress,
      programDataAddress: PROGRAM_DATA_ADDRESS,
      programAccountDataSha256: sha256(program),
      programDataAccountLengthBytes: programData.byteLength.toString(10),
      programDataAccountSha256: sha256(programData),
      programDataBinarySha256: sha256(programData.subarray(PROGRAM_DATA_HEADER_BYTES)),
      expectedLastDeployedSlot: DEPLOYED_SLOT.toString(10),
      expectedUpgradeAuthorityAddress: authority,
    },
    group: {
      address: ID.mainGroupAddress,
      accountLengthBytes: group.byteLength === 1_064 ? '1064' : '9256',
      accountDataSha256: sha256(group),
    },
    bank: {
      address: ID.usdcBankAddress,
      groupAddress: ID.mainGroupAddress,
      mintAddress: ID.usdcMintAddress,
      expectedMintDecimals: 6,
      expectedOperationalStateRaw: '1',
      expectedRiskTierRaw: '0',
      expectedAssetTagRaw: '0',
      expectedOracleSetupRaw: '3',
      expectedPrimaryOracleAddress: ORACLE_ADDRESS,
      expectedDepositLimitAtomicRaw: '10000000000',
      expectedBorrowLimitAtomicRaw: '8000000000',
      expectedOracleMaximumAgeSeconds: '60',
      accountDataSha256: sha256(bank),
    },
    asset: {
      stablecoin: 'USDC',
      mintAddress: ID.usdcMintAddress,
      decimals: 6,
      tokenProgramAddress: ID.legacyTokenProgramAddress,
      accountDataSha256: sha256(mint),
    },
    vaults: {
      liquidity: {
        address: ID.liquidityVaultAddress,
        authorityAddress: ID.liquidityVaultAuthorityAddress,
        bump: ID.liquidityVaultBump,
        authorityBump: ID.liquidityVaultAuthorityBump,
        accountDataSha256: sha256(liquidity),
      },
      insurance: {
        address: ID.insuranceVaultAddress,
        authorityAddress: ID.insuranceVaultAuthorityAddress,
        bump: ID.insuranceVaultBump,
        authorityBump: ID.insuranceVaultAuthorityBump,
        accountDataSha256: sha256(insurance),
      },
      fee: {
        address: ID.feeVaultAddress,
        authorityAddress: ID.feeVaultAuthorityAddress,
        bump: ID.feeVaultBump,
        authorityBump: ID.feeVaultAuthorityBump,
        accountDataSha256: sha256(fee),
      },
    },
  };
}

function envelope(id: number, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result };
}

function fixture(authority: string | null = UPGRADE_AUTHORITY): Fixture {
  const accounts = [
    rpcAccount(programBytes(), ID.upgradeableLoaderAddress, true),
    rpcAccount(programDataBytes(authority), ID.upgradeableLoaderAddress, false),
    rpcAccount(groupBytes(), ID.programAddress, false),
    rpcAccount(bankBytes(), ID.programAddress, false),
    rpcAccount(mintBytes(), ID.legacyTokenProgramAddress, false),
    rpcAccount(
      tokenAccountBytes(ID.liquidityVaultAuthorityAddress, 2_000_000n),
      ID.legacyTokenProgramAddress,
      false,
    ),
    rpcAccount(
      tokenAccountBytes(ID.insuranceVaultAuthorityAddress, 300_000n),
      ID.legacyTokenProgramAddress,
      false,
    ),
    rpcAccount(
      tokenAccountBytes(ID.feeVaultAuthorityAddress, 20_000n),
      ID.legacyTokenProgramAddress,
      false,
    ),
  ];
  const accountResult: AccountsResult = {
    context: { slot: SLOT, apiVersion: '3.1.8' },
    value: accounts,
  };
  const blockBefore: RpcBlock = {
    blockHeight: 950,
    blockTime: NOW_SECONDS - 10,
    blockhash: ID.mainGroupAddress,
    parentSlot: SLOT - 1,
    previousBlockhash: ID.usdcBankAddress,
  };
  const blockAfter = { ...blockBefore };
  const responses = new Map<number, unknown>([
    [1, envelope(1, ID.genesisHash)],
    [2, envelope(2, MINIMUM_SLOT)],
    [3, envelope(3, accountResult)],
    [4, envelope(4, blockBefore)],
    [5, envelope(5, SLOT + 1)],
    [6, envelope(6, blockAfter)],
    [7, envelope(7, ID.genesisHash)],
  ]);
  const transport = new FakeTransport(responses);
  const result: Fixture = {
    accounts,
    accountResult,
    blockBefore,
    blockAfter,
    responses,
    manifest: createMarginfiV2SolanaManifest(manifestDefinition(accounts, authority)),
    authority,
    transport,
    clock: { now: () => NOW },
  };
  return result;
}

function required(f: Fixture): Record<string, string> {
  return {
    sourceFingerprintSha256: f.manifest.sourceFingerprintSha256,
    deploymentFingerprintSha256: f.manifest.deploymentFingerprintSha256,
    manifestFingerprintSha256: f.manifest.manifestFingerprintSha256,
  };
}

function adapter(f: Fixture): MarginfiV2SolanaFinalizedTranscriptAdapter {
  return new MarginfiV2SolanaFinalizedTranscriptAdapter(
    f.manifest,
    required(f),
    f.transport,
    f.clock,
  );
}

function reseal(f: Fixture): void {
  f.manifest = createMarginfiV2SolanaManifest(manifestDefinition(f.accounts, f.authority));
}

function mutateAccount(f: Fixture, index: number, mutate: (data: Buffer) => void): void {
  const account = f.accounts[index];
  if (!account) throw new Error('fixture account');
  const data = decodeAccount(account);
  mutate(data);
  account.data = [data.toString('base64'), 'base64'];
  reseal(f);
}

async function expectUnavailable(
  operation: Promise<unknown> | (() => unknown),
): Promise<MarginfiV2SolanaTranscriptUnavailableError> {
  try {
    if (typeof operation === 'function') operation();
    else await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(MarginfiV2SolanaTranscriptUnavailableError);
    expect(error).toMatchObject({
      name: 'MarginfiV2SolanaTranscriptUnavailableError',
      code: 'MARGINFI_V2_SOLANA_TRANSCRIPT_UNAVAILABLE',
      message: 'Marginfi v2 Solana transcript is unavailable',
    });
    expect(String(error)).not.toContain('sensitive');
    return error as MarginfiV2SolanaTranscriptUnavailableError;
  }
  throw new Error('expected unavailable');
}

describe('MarginfiV2SolanaFinalizedTranscriptAdapter', () => {
  it('emits only dormant raw evidence from the fully bound finalized transcript', async () => {
    const f = fixture();
    const candidate = await adapter(f).read(REQUEST);

    expect(candidate).toMatchObject({
      schemaVersion: 1,
      providerId: 'project-0',
      protocolId: 'marginfi-v2',
      networkId: ID.networkId,
      marketId: 'marginfi-v2-solana-mainnet-main-usdc',
      observedAt: '2026-01-01T00:00:00.000Z',
      staleAfter: '2026-01-01T00:00:45.000Z',
      sourcePosition: '1000',
      sourceFinality: 'SOLANA_FINALIZED_SLOT',
      sourceProofStatus: 'FINALIZED_RPC_TRANSCRIPT_BOUND_UNAUTHENTICATED',
      sourceAuthenticity: 'UNVERIFIED_SINGLE_INJECTED_RPC_TRANSCRIPT',
      freshnessStatus: 'CURRENT_WITHIN_CALLER_BLOCK_BANK_AND_CACHE_TIME_BOUNDS',
      oracleEvidenceStatus: 'CURRENT_CACHED_TIMESTAMP_ONLY_NO_ORACLE_ACCOUNT_PROOF',
      yieldEvidenceStatus: 'ABSENT_NOT_COMPUTED',
      liquidityEvidenceStatus: 'RAW_VAULT_AMOUNTS_ONLY_NOT_CAPACITY',
      persistenceEligibility: 'BLOCKED_PENDING_INDEPENDENT_ORACLE_SOURCE_AND_RISK_VERIFICATION',
      mayPersist: false,
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      snapshot: {
        minimumContextSlot: '995',
        slot: '1000',
        finalizedProgressAfter: '1001',
        blockTime: String(NOW_SECONDS - 10),
      },
      deployment: {
        programAddress: ID.programAddress,
        programDataAddress: PROGRAM_DATA_ADDRESS,
        lastDeployedSlot: '900',
        upgradeAuthorityAddress: UPGRADE_AUTHORITY,
        upgradeAuthorityStatus: 'PRESENT_CALLER_PINNED',
      },
      group: {
        address: ID.mainGroupAddress,
        adminAddress: UPGRADE_AUTHORITY,
        groupFlagsRaw: '1',
        bankCountRaw: '25',
        accountLengthBytes: '9256',
      },
      bank: {
        address: ID.usdcBankAddress,
        groupAddress: ID.mainGroupAddress,
        mintAddress: ID.usdcMintAddress,
        mintDecimals: 6,
        liquidityVaultAddress: ID.liquidityVaultAddress,
        insuranceVaultAddress: ID.insuranceVaultAddress,
        feeVaultAddress: ID.feeVaultAddress,
        operationalStateRaw: '1',
        riskTierRaw: '0',
        assetTagRaw: '0',
        oracleSetupRaw: '3',
        primaryOracleAddress: ORACLE_ADDRESS,
        oracleMaximumAgeSeconds: '60',
        lastUpdateUnixSecondsRaw: String(NOW_SECONDS - 15),
        cachedOracleTimestampUnixSecondsRaw: String(NOW_SECONDS - 12),
        assetShareValueI80F48LeHexRaw: '00000000000001000000000000000000',
        depositLimitAtomicRaw: '10000000000',
        borrowLimitAtomicRaw: '8000000000',
        bankFlagsRaw: '0',
        configFlagsRaw: '0',
        lendingPositionCountRaw: '200',
        borrowingPositionCountRaw: '80',
        circuitBreakerTierRaw: '0',
      },
      asset: {
        stablecoin: 'USDC',
        mintAddress: ID.usdcMintAddress,
        decimals: 6,
        initialized: true,
        supplyAtomicRaw: '50000000000',
      },
      vaults: {
        liquidity: {
          address: ID.liquidityVaultAddress,
          authorityAddress: ID.liquidityVaultAuthorityAddress,
          state: 'INITIALIZED',
          amountAtomicRaw: '2000000',
        },
        insurance: { amountAtomicRaw: '300000' },
        fee: { amountAtomicRaw: '20000' },
      },
    });
    expect(candidate.sourceFingerprintSha256).toBe(f.manifest.sourceFingerprintSha256);
    expect(candidate.deploymentFingerprintSha256).toBe(f.manifest.deploymentFingerprintSha256);
    expect(candidate.manifestFingerprintSha256).toBe(f.manifest.manifestFingerprintSha256);
    expect(candidate.transcriptFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(SMART_LENDING_PROVIDER_IDS).toContain(candidate.providerId);
    expect(
      MAINNET_PLATFORM_DIRECTORY.providers.find(({ id }) => id === candidate.providerId),
    ).toMatchObject({
      id: 'project-0',
      name: 'Project 0',
      protocol: 'marginfi v2',
      ecosystem: 'SOLANA',
      networks: [{ id: candidate.networkId, name: 'Solana' }],
    });
    expect(candidate.transcriptFingerprintSha256).toBe(
      createHash('sha256')
        .update(
          JSON.stringify([
            'crypto-lending:marginfi-v2-solana-finalized-transcript:v2',
            candidate.providerId,
            candidate.protocolId,
            candidate.networkId,
            candidate.marketId,
            candidate.sourceFingerprintSha256,
            candidate.deploymentFingerprintSha256,
            candidate.manifestFingerprintSha256,
            candidate.snapshot,
            candidate.deployment,
            candidate.group,
            candidate.bank,
            candidate.asset,
            candidate.vaults,
            candidate.observedAt,
          ]),
          'utf8',
        )
        .digest('hex'),
    );
    expect(candidate.bank).not.toHaveProperty('apr');
    expect(candidate.bank).not.toHaveProperty('apy');
    expect(candidate.bank).not.toHaveProperty('capacity');
    expect(candidate.bank).not.toHaveProperty('availableToDeposit');
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.bank)).toBe(true);
  });

  it('uses the exact genesis/slot/atomic-account/block/progress/block/genesis sequence', async () => {
    const f = fixture();
    await adapter(f).read(REQUEST);
    expect(f.transport.calls).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] },
      { jsonrpc: '2.0', id: 2, method: 'getSlot', params: [{ commitment: 'finalized' }] },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'getMultipleAccounts',
        params: [
          [
            ID.programAddress,
            PROGRAM_DATA_ADDRESS,
            ID.mainGroupAddress,
            ID.usdcBankAddress,
            ID.usdcMintAddress,
            ID.liquidityVaultAddress,
            ID.insuranceVaultAddress,
            ID.feeVaultAddress,
          ],
          { commitment: 'finalized', encoding: 'base64', minContextSlot: MINIMUM_SLOT },
        ],
      },
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'getBlock',
        params: [SLOT, { commitment: 'finalized', transactionDetails: 'none', rewards: false }],
      },
      {
        jsonrpc: '2.0',
        id: 5,
        method: 'getSlot',
        params: [{ commitment: 'finalized', minContextSlot: SLOT }],
      },
      {
        jsonrpc: '2.0',
        id: 6,
        method: 'getBlock',
        params: [SLOT, { commitment: 'finalized', transactionDetails: 'none', rewards: false }],
      },
      { jsonrpc: '2.0', id: 7, method: 'getGenesisHash', params: [] },
    ]);
  });

  it('independently derives every pinned vault and authority PDA from official seeds', () => {
    const program = new PublicKey(ID.programAddress);
    const bank = new PublicKey(ID.usdcBankAddress);
    const cases = [
      ['liquidity_vault', ID.liquidityVaultAddress, ID.liquidityVaultBump],
      ['liquidity_vault_auth', ID.liquidityVaultAuthorityAddress, ID.liquidityVaultAuthorityBump],
      ['insurance_vault', ID.insuranceVaultAddress, ID.insuranceVaultBump],
      ['insurance_vault_auth', ID.insuranceVaultAuthorityAddress, ID.insuranceVaultAuthorityBump],
      ['fee_vault', ID.feeVaultAddress, ID.feeVaultBump],
      ['fee_vault_auth', ID.feeVaultAuthorityAddress, ID.feeVaultAuthorityBump],
    ] as const;
    for (const [seed, expectedAddress, expectedBump] of cases) {
      const [address, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from(seed, 'ascii'), bank.toBuffer()],
        program,
      );
      expect(address.toBase58()).toBe(expectedAddress);
      expect(bump).toBe(expectedBump);
    }
  });

  it('supports the source-defined legacy group prefix only when its exact length is pinned', async () => {
    const f = fixture();
    const legacy = groupBytes(1_064);
    f.accounts[2] = rpcAccount(legacy, ID.programAddress, false);
    f.accountResult.value[2] = f.accounts[2] ?? null;
    reseal(f);
    await expect(adapter(f).read(REQUEST)).resolves.toMatchObject({
      group: { accountLengthBytes: '1064', bankCountRaw: '25' },
    });
  });

  it('reports a revoked upgrade authority without treating it as approval', async () => {
    const f = fixture(null);
    await expect(adapter(f).read(REQUEST)).resolves.toMatchObject({
      deployment: {
        upgradeAuthorityAddress: null,
        upgradeAuthorityStatus: 'REVOKED_CALLER_PINNED',
      },
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
    });
  });

  it('computes deterministic independent source/deployment/whole-manifest fingerprints', () => {
    const f = fixture();
    const again = createMarginfiV2SolanaManifest(f.manifest);
    expect(again).toEqual(f.manifest);
    expect(
      new Set([
        again.sourceFingerprintSha256,
        again.deploymentFingerprintSha256,
        again.manifestFingerprintSha256,
      ]).size,
    ).toBe(3);
    expect(Object.isFrozen(again)).toBe(true);
  });

  it.each([
    'sourceFingerprintSha256',
    'deploymentFingerprintSha256',
    'manifestFingerprintSha256',
  ] as const)('rejects a mismatched constructor %s pin before transport use', async (key) => {
    const f = fixture();
    const pins = required(f);
    pins[key] = 'a'.repeat(64);
    await expectUnavailable(
      () => new MarginfiV2SolanaFinalizedTranscriptAdapter(f.manifest, pins, f.transport, f.clock),
    );
    expect(f.transport.calls).toHaveLength(0);
  });

  it('rejects partially supplied embedded fingerprints', async () => {
    const f = fixture();
    const definition = manifestDefinition(f.accounts, f.authority) as Record<string, unknown>;
    definition.sourceFingerprintSha256 = f.manifest.sourceFingerprintSha256;
    await expectUnavailable(() => createMarginfiV2SolanaManifest(definition));
  });

  it.each([
    [
      'marginfi commit',
      (value: Record<string, unknown>) => {
        (value.sources as Record<string, unknown>).marginfiV2CommitSha = 'a'.repeat(40);
      },
    ],
    [
      'SDK commit',
      (value: Record<string, unknown>) => {
        (value.sources as Record<string, unknown>).p0TsSdkCommitSha = 'a'.repeat(40);
      },
    ],
    [
      'asset registry',
      (value: Record<string, unknown>) => {
        (value.assetRegistry as Record<string, unknown>).fingerprintSha256 = 'a'.repeat(64);
      },
    ],
    [
      'program address',
      (value: Record<string, unknown>) => {
        (value.deployment as Record<string, unknown>).programAddress = ID.mainGroupAddress;
      },
    ],
    [
      'group identity',
      (value: Record<string, unknown>) => {
        (value.group as Record<string, unknown>).address = ID.usdcBankAddress;
      },
    ],
    [
      'bank identity',
      (value: Record<string, unknown>) => {
        (value.bank as Record<string, unknown>).address = ID.mainGroupAddress;
      },
    ],
    [
      'mint identity',
      (value: Record<string, unknown>) => {
        (value.asset as Record<string, unknown>).mintAddress = ID.usdcBankAddress;
      },
    ],
    [
      'oracle setup none',
      (value: Record<string, unknown>) => {
        (value.bank as Record<string, unknown>).expectedOracleSetupRaw = '0';
      },
    ],
    [
      'deprecated oracle',
      (value: Record<string, unknown>) => {
        (value.bank as Record<string, unknown>).expectedOracleSetupRaw = '1';
      },
    ],
    [
      'fixed oracle',
      (value: Record<string, unknown>) => {
        (value.bank as Record<string, unknown>).expectedOracleSetupRaw = '8';
      },
    ],
    [
      'too-small oracle age',
      (value: Record<string, unknown>) => {
        (value.bank as Record<string, unknown>).expectedOracleMaximumAgeSeconds = '9';
      },
    ],
    [
      'noncanonical deposit limit',
      (value: Record<string, unknown>) => {
        (value.bank as Record<string, unknown>).expectedDepositLimitAtomicRaw = '01';
      },
    ],
    [
      'vault bump',
      (value: Record<string, unknown>) => {
        ((value.vaults as Record<string, unknown>).fee as Record<string, unknown>).bump = 252;
      },
    ],
  ] as const)('rejects hostile manifest mutation: %s', async (_name, mutate) => {
    const f = fixture();
    const value = structuredClone(manifestDefinition(f.accounts, f.authority)) as unknown as Record<
      string,
      unknown
    >;
    mutate(value);
    await expectUnavailable(() => createMarginfiV2SolanaManifest(value));
  });

  it.each([
    [
      'discriminator',
      3,
      (data: Buffer) => {
        data[0] = (data[0] ?? 0) ^ 1;
      },
    ],
    [
      'mint',
      3,
      (data: Buffer) => {
        writeKey(data, 8, ID.mainGroupAddress);
      },
    ],
    [
      'mint decimals',
      3,
      (data: Buffer) => {
        data[40] = 5;
      },
    ],
    [
      'group link',
      3,
      (data: Buffer) => {
        writeKey(data, 41, ID.usdcBankAddress);
      },
    ],
    [
      'asset share value',
      3,
      (data: Buffer) => {
        data.fill(0xff, 80, 96);
      },
    ],
    [
      'liability share value',
      3,
      (data: Buffer) => {
        data.fill(0, 96, 112);
      },
    ],
    [
      'liquidity vault',
      3,
      (data: Buffer) => {
        writeKey(data, 112, ID.insuranceVaultAddress);
      },
    ],
    [
      'liquidity vault bump',
      3,
      (data: Buffer) => {
        data[144] = 251;
      },
    ],
    [
      'liquidity authority bump',
      3,
      (data: Buffer) => {
        data[145] = 252;
      },
    ],
    [
      'insurance vault',
      3,
      (data: Buffer) => {
        writeKey(data, 146, ID.feeVaultAddress);
      },
    ],
    [
      'insurance vault bump',
      3,
      (data: Buffer) => {
        data[178] = 253;
      },
    ],
    [
      'insurance authority bump',
      3,
      (data: Buffer) => {
        data[179] = 254;
      },
    ],
    [
      'fee vault',
      3,
      (data: Buffer) => {
        writeKey(data, 200, ID.liquidityVaultAddress);
      },
    ],
    [
      'fee vault bump',
      3,
      (data: Buffer) => {
        data[232] = 252;
      },
    ],
    [
      'fee authority bump',
      3,
      (data: Buffer) => {
        data[233] = 254;
      },
    ],
    [
      'negative total liabilities',
      3,
      (data: Buffer) => {
        data.fill(0xff, 256, 272);
      },
    ],
    [
      'negative total assets',
      3,
      (data: Buffer) => {
        data.fill(0xff, 272, 288);
      },
    ],
    [
      'zero bank last update',
      3,
      (data: Buffer) => {
        data.fill(0, 288, 296);
      },
    ],
    [
      'paused operational state',
      3,
      (data: Buffer) => {
        data[608] = 0;
      },
    ],
    [
      'unsupported oracle setup',
      3,
      (data: Buffer) => {
        data[609] = 8;
      },
    ],
    [
      'zero primary oracle',
      3,
      (data: Buffer) => {
        data.fill(0, 610, 642);
      },
    ],
    [
      'deposit limit drift',
      3,
      (data: Buffer) => {
        data.writeBigUInt64LE(9n, 360);
      },
    ],
    [
      'borrow limit drift',
      3,
      (data: Buffer) => {
        data.writeBigUInt64LE(9n, 776);
      },
    ],
    [
      'isolated risk tier',
      3,
      (data: Buffer) => {
        data[784] = 1;
      },
    ],
    [
      'non-default asset tag',
      3,
      (data: Buffer) => {
        data[785] = 1;
      },
    ],
    [
      'short oracle max age',
      3,
      (data: Buffer) => {
        data.writeUInt16LE(9, 800);
      },
    ],
    [
      'unknown bank flag',
      3,
      (data: Buffer) => {
        data.writeBigUInt64LE(8_192n, 840);
      },
    ],
    [
      'Token-2022 bank flag',
      3,
      (data: Buffer) => {
        data.writeBigUInt64LE(128n, 840);
      },
    ],
    [
      'zero cached oracle price',
      3,
      (data: Buffer) => {
        data.fill(0, 1_408, 1_424);
      },
    ],
    [
      'zero cached oracle timestamp',
      3,
      (data: Buffer) => {
        data.fill(0, 1_424, 1_432);
      },
    ],
    [
      'negative cached confidence',
      3,
      (data: Buffer) => {
        data.fill(0xff, 1_432, 1_448);
      },
    ],
    [
      'unknown liquidation cache flag',
      3,
      (data: Buffer) => {
        data[1_448] = 2;
      },
    ],
    [
      'integration account',
      3,
      (data: Buffer) => {
        writeKey(data, 1_560, ID.mainGroupAddress);
      },
    ],
    [
      'active circuit breaker',
      3,
      (data: Buffer) => {
        data[1_776] = 1;
      },
    ],
  ] as const)('rejects source-layout mutation: %s', async (_name, index, mutate) => {
    const f = fixture();
    mutateAccount(f, index, mutate);
    await expectUnavailable(adapter(f).read(REQUEST));
  });

  it.each([
    [
      'program state',
      0,
      (data: Buffer) => {
        data.writeUInt32LE(1, 0);
      },
    ],
    [
      'programdata link',
      0,
      (data: Buffer) => {
        writeKey(data, 4, ID.mainGroupAddress);
      },
    ],
    [
      'programdata state',
      1,
      (data: Buffer) => {
        data.writeUInt32LE(2, 0);
      },
    ],
    [
      'zero deployed slot',
      1,
      (data: Buffer) => {
        data.writeBigUInt64LE(0n, 4);
      },
    ],
    [
      'future deployed slot',
      1,
      (data: Buffer) => {
        data.writeBigUInt64LE(1_001n, 4);
      },
    ],
    [
      'invalid authority tag',
      1,
      (data: Buffer) => {
        data[12] = 2;
      },
    ],
    [
      'invalid ELF',
      1,
      (data: Buffer) => {
        data[45] = 0;
      },
    ],
    [
      'group discriminator',
      2,
      (data: Buffer) => {
        data[0] = (data[0] ?? 0) ^ 1;
      },
    ],
    [
      'zero group admin',
      2,
      (data: Buffer) => {
        data.fill(0, 8, 40);
      },
    ],
    [
      'unknown group flag',
      2,
      (data: Buffer) => {
        data.writeBigUInt64LE(2n, 40);
      },
    ],
    [
      'mint supply',
      4,
      (data: Buffer) => {
        data.writeBigUInt64LE(0n, 36);
      },
    ],
    [
      'mint decimals',
      4,
      (data: Buffer) => {
        data[44] = 5;
      },
    ],
    [
      'mint initialization',
      4,
      (data: Buffer) => {
        data[45] = 0;
      },
    ],
    [
      'mint authority option',
      4,
      (data: Buffer) => {
        data.writeUInt32LE(2, 0);
      },
    ],
    [
      'freeze authority option',
      4,
      (data: Buffer) => {
        data.writeUInt32LE(2, 46);
      },
    ],
  ] as const)('rejects linked account layout mutation: %s', async (_name, index, mutate) => {
    const f = fixture();
    mutateAccount(f, index, mutate);
    await expectUnavailable(adapter(f).read(REQUEST));
  });

  it.each([
    [
      'wrong mint',
      (data: Buffer) => {
        writeKey(data, 0, ID.mainGroupAddress);
      },
    ],
    [
      'wrong authority',
      (data: Buffer) => {
        writeKey(data, 32, ID.mainGroupAddress);
      },
    ],
    [
      'delegate',
      (data: Buffer) => {
        data.writeUInt32LE(1, 72);
        writeKey(data, 76, ID.mainGroupAddress);
      },
    ],
    [
      'invalid state',
      (data: Buffer) => {
        data[108] = 2;
      },
    ],
    [
      'native reserve',
      (data: Buffer) => {
        data.writeUInt32LE(1, 109);
        data.writeBigUInt64LE(1n, 113);
      },
    ],
    [
      'delegated amount',
      (data: Buffer) => {
        data.writeBigUInt64LE(1n, 121);
      },
    ],
    [
      'close authority',
      (data: Buffer) => {
        data.writeUInt32LE(1, 129);
        writeKey(data, 133, ID.mainGroupAddress);
      },
    ],
  ] as const)('rejects unsafe SPL vault state: %s', async (_name, mutate) => {
    const f = fixture();
    mutateAccount(f, 5, mutate);
    await expectUnavailable(adapter(f).read(REQUEST));
  });

  it.each([5, 6, 7])('binds vault account %i to the legacy SPL Token owner', async (index) => {
    const f = fixture();
    const account = f.accounts[index];
    if (!account) throw new Error('fixture account');
    account.owner = ID.programAddress;
    await expectUnavailable(adapter(f).read(REQUEST));
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'binds account %i bytes to a caller-pinned SHA-256 digest',
    async (index) => {
      const f = fixture();
      const account = f.accounts[index];
      if (!account) throw new Error('fixture account');
      const data = decodeAccount(account);
      data[data.byteLength - 1] = (data[data.byteLength - 1] ?? 0) ^ 1;
      account.data = [data.toString('base64'), 'base64'];
      await expectUnavailable(adapter(f).read(REQUEST));
    },
  );

  it.each([
    [
      'owner',
      (account: RpcAccount) => {
        account.owner = ID.mainGroupAddress;
      },
    ],
    [
      'executable',
      (account: RpcAccount) => {
        account.executable = true;
      },
    ],
    [
      'zero lamports',
      (account: RpcAccount) => {
        account.lamports = 0;
      },
    ],
    [
      'fractional lamports',
      (account: RpcAccount) => {
        account.lamports = 1.5;
      },
    ],
    [
      'negative rent epoch',
      (account: RpcAccount) => {
        account.rentEpoch = -1;
      },
    ],
    [
      'space mismatch',
      (account: RpcAccount) => {
        account.space -= 1;
      },
    ],
    [
      'wrong encoding',
      (account: RpcAccount) => {
        account.data = [account.data[0], 'base64'];
        (account.data as unknown[])[1] = 'base58';
      },
    ],
    [
      'noncanonical base64',
      (account: RpcAccount) => {
        account.data = [`${account.data[0]}=`, 'base64'];
      },
    ],
  ] as const)('rejects hostile RPC account metadata: %s', async (_name, mutate) => {
    const f = fixture();
    const account = f.accounts[5];
    if (!account) throw new Error('fixture account');
    mutate(account);
    await expectUnavailable(adapter(f).read(REQUEST));
  });

  it('rejects a null account or a non-exact atomic account list', async () => {
    const first = fixture();
    first.accountResult.value[3] = null;
    await expectUnavailable(adapter(first).read(REQUEST));

    const second = fixture();
    second.accountResult.value.pop();
    await expectUnavailable(adapter(second).read(REQUEST));
  });

  it.each([
    [
      'context before minimum',
      (f: Fixture) => {
        f.accountResult.context.slot = MINIMUM_SLOT - 1;
      },
    ],
    [
      'invalid API version',
      (f: Fixture) => {
        f.accountResult.context.apiVersion = 'latest';
      },
    ],
    [
      'progress regression',
      (f: Fixture) => {
        f.responses.set(5, envelope(5, SLOT - 1));
      },
    ],
    [
      'ending genesis mismatch',
      (f: Fixture) => {
        f.responses.set(7, envelope(7, ID.mainGroupAddress));
      },
    ],
    [
      'blockhash reorg',
      (f: Fixture) => {
        f.blockAfter.blockhash = ID.usdcMintAddress;
      },
    ],
    [
      'block time reorg',
      (f: Fixture) => {
        f.blockAfter.blockTime = NOW_SECONDS - 9;
      },
    ],
    [
      'non-parent slot',
      (f: Fixture) => {
        f.blockBefore.parentSlot = SLOT;
        f.blockAfter.parentSlot = SLOT;
      },
    ],
    [
      'identical block hashes',
      (f: Fixture) => {
        f.blockBefore.previousBlockhash = f.blockBefore.blockhash;
        f.blockAfter.previousBlockhash = f.blockAfter.blockhash;
      },
    ],
  ] as const)('rejects incoherent finalized transcript: %s', async (_name, mutate) => {
    const f = fixture();
    mutate(f);
    await expectUnavailable(adapter(f).read(REQUEST));
  });

  it.each([
    [
      'stale block',
      (f: Fixture) => {
        f.blockBefore.blockTime = NOW_SECONDS - 60;
        f.blockAfter.blockTime = NOW_SECONDS - 60;
      },
    ],
    [
      'future block',
      (f: Fixture) => {
        f.blockBefore.blockTime = NOW_SECONDS + 1;
        f.blockAfter.blockTime = NOW_SECONDS + 1;
      },
    ],
    [
      'stale bank update',
      (f: Fixture) => {
        mutateAccount(f, 3, (data) => data.writeBigInt64LE(BigInt(NOW_SECONDS - 60), 288));
      },
    ],
    [
      'future bank update vs block',
      (f: Fixture) => {
        mutateAccount(f, 3, (data) => data.writeBigInt64LE(BigInt(NOW_SECONDS - 9), 288));
      },
    ],
    [
      'stale cached oracle',
      (f: Fixture) => {
        mutateAccount(f, 3, (data) => data.writeBigInt64LE(BigInt(NOW_SECONDS - 60), 1_424));
      },
    ],
    [
      'future cached oracle vs block',
      (f: Fixture) => {
        mutateAccount(f, 3, (data) => data.writeBigInt64LE(BigInt(NOW_SECONDS - 9), 1_424));
      },
    ],
  ] as const)('rejects non-current time evidence: %s', async (_name, mutate) => {
    const f = fixture();
    mutate(f);
    await expectUnavailable(adapter(f).read(REQUEST));
  });

  it('uses the bank-configured oracle maximum age when it is tighter than the caller bound', async () => {
    const f = fixture();
    const definition = manifestDefinition(f.accounts, f.authority);
    const tightened = {
      ...definition,
      bank: { ...definition.bank, expectedOracleMaximumAgeSeconds: '10' },
    };
    mutateAccount(f, 3, (data) => data.writeUInt16LE(10, 800));
    f.manifest = createMarginfiV2SolanaManifest({
      ...tightened,
      bank: {
        ...tightened.bank,
        accountDataSha256: sha256(decodeAccount(f.accounts[3] as RpcAccount)),
      },
    });
    await expectUnavailable(adapter(f).read(REQUEST));
  });

  it.each([
    ['wrong JSON-RPC version', { jsonrpc: '1.0', id: 1, result: ID.genesisHash }],
    ['wrong response ID', { jsonrpc: '2.0', id: 2, result: ID.genesisHash }],
    ['error envelope', { jsonrpc: '2.0', id: 1, error: { code: -1, message: 'secret' } }],
    ['extra envelope member', { jsonrpc: '2.0', id: 1, result: ID.genesisHash, extra: true }],
  ] as const)('rejects hostile JSON-RPC envelope: %s', async (_name, response) => {
    const f = fixture();
    f.responses.set(1, response);
    await expectUnavailable(adapter(f).read(REQUEST));
  });

  it('sanitizes injected transport failures', async () => {
    const f = fixture();
    f.transport.throwAtId = 3;
    await expectUnavailable(adapter(f).read(REQUEST));
  });

  it('rejects cyclic, accessor-bearing, and oversized untrusted responses without access', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const cyclicFixture = fixture();
    cyclicFixture.responses.set(1, cyclic);
    await expectUnavailable(adapter(cyclicFixture).read(REQUEST));

    let invoked = false;
    const accessor = {};
    Object.defineProperty(accessor, 'jsonrpc', {
      enumerable: true,
      get: () => {
        invoked = true;
        return '2.0';
      },
    });
    const accessorFixture = fixture();
    accessorFixture.responses.set(1, accessor);
    await expectUnavailable(adapter(accessorFixture).read(REQUEST));
    expect(invoked).toBe(false);

    const oversizedFixture = fixture();
    oversizedFixture.responses.set(1, { value: 'x'.repeat(24 * 1024 * 1024 + 1) });
    await expectUnavailable(adapter(oversizedFixture).read(REQUEST));
  });

  it.each([
    ['wrong market', { ...REQUEST, marketId: 'other' }],
    ['extra member', { ...REQUEST, extra: true }],
    ['array request', []],
  ] as const)('rejects a hostile read request: %s', async (_name, request) => {
    const f = fixture();
    await expectUnavailable(
      adapter(f).read(request as unknown as ReadMarginfiV2SolanaTranscriptRequest),
    );
    expect(f.transport.calls).toHaveLength(0);
  });

  it.each([
    ['invalid date', new Date(Number.NaN)],
    ['subclassed date', new (class extends Date {})('2026-01-01T00:00:00.000Z')],
  ] as const)('rejects a noncanonical clock: %s', async (_name, date) => {
    const f = fixture();
    f.clock = { now: () => date };
    await expectUnavailable(adapter(f).read(REQUEST));
  });

  it('does not accept a caller-mutated embedded manifest fingerprint', async () => {
    const f = fixture();
    const changed = structuredClone(f.manifest) as unknown as Record<string, unknown>;
    changed.manifestFingerprintSha256 = 'a'.repeat(64);
    await expectUnavailable(() => createMarginfiV2SolanaManifest(changed));
  });
});
