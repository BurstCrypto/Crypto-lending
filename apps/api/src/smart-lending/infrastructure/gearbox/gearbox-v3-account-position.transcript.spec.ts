import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256 } from './gearbox-v3-account-position.semantics';
import {
  DormantGearboxV3AccountPositionTranscriptEvaluator,
  GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_APPROVAL_USE,
  GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_USE,
  GearboxV3AccountPositionTranscriptUnavailableError,
  gearboxV3AccountPositionTranscriptApprovalFingerprintSha256,
  gearboxV3AccountPositionTranscriptExecutionOrder,
} from './gearbox-v3-account-position.transcript';
import { gearboxV3ManifestFingerprintSha256 } from './gearbox-v3-ethereum-usdc.manifest';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const blockHash = (value: string): string => `0x${sha(value)}`;
const address = (digit: string): string => `0x${digit.repeat(40)}`;

const contracts = {
  addressProvider: '0x9ea7b04da02a5373317d745c1571c84aad03321d',
  contractsRegister: '0xa50d4e7d8946a7c90652339cdbd262c375d54d99',
  pool: '0xda00000035fef4082f78def6a8903bee419fbf8e',
  underlying: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
} as const;

const manifest = {
  schemaVersion: 1,
  providerId: 'gearbox',
  protocolId: 'gearbox-v3',
  networkId: 'eip155:1',
  expectedChainId: '0x1',
  blockSelector: 'finalized',
  blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
  maximumBlockAgeSeconds: '3600',
  marketId: 'gearbox-v3-ethereum-usdc',
  deploymentModel: 'DIRECT_IMMUTABLE_POOL_V3_00',
  contracts,
  asset: { symbol: 'USDC', decimals: 6 },
  assetRegistry: {
    environment: 'MAINNET',
    version: 1,
    fingerprintSha256: '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
  },
  runtimeCodeSha256: Object.fromEntries(Object.keys(contracts).map((key) => [key, sha(key)])),
  officialSource: {
    securityRepository: 'Gearbox-protocol/security',
    securityCommit: '684522eae18dea73a8aecda25d8743bfa724446a',
    deploymentPath: 'bug-bounty/v3-scope.md',
    coreRepository: 'Gearbox-protocol/core-v3',
    coreCommit: 'e16559ae82f0f24c3dc29693c444f40d676ebff9',
    poolPath: 'contracts/pool/PoolV3.sol',
    interfacePath: 'contracts/interfaces/IPoolV3.sol',
  },
} as const;

const manifestFingerprint = gearboxV3ManifestFingerprintSha256(manifest);
const walletAddress = address('1');
const otherBorrower = address('7');
const accountFactoryAddress = '0x444cd42baeddeb707eed823f7177b9abcc779c04';
const quotaKeeperAddress = address('2');
const managerAddress = address('3');
const facadeAddress = address('4');
const firstAccountAddress = address('5');
const secondAccountAddress = address('6');
const selectedHash = blockHash('selected');
const selectedBlock = {
  number: '100',
  hash: selectedHash,
  parentHash: blockHash('parent'),
  stateRoot: blockHash('state-root'),
  timestamp: '1000',
};

// Test builders intentionally preserve their exact inferred mutable fixture shapes.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function approvalWithManagers(includeManagers = true) {
  return {
    approvalVersion: 1,
    use: GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_APPROVAL_USE,
    mayEstablishRecommendationEligibility: false,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    mayCreatePositionSnapshot: false,
    maySign: false,
    mayAccessWalletPrivateKey: false,
    manifestFingerprintSha256: manifestFingerprint,
    semanticsFingerprintSha256: GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
    root: {
      accountFactoryAddress,
      accountFactoryRuntimeCodeSha256: sha('account-factory'),
      poolQuotaKeeperAddress: quotaKeeperAddress,
      poolQuotaKeeperRuntimeCodeSha256: sha('quota-keeper'),
    },
    managers: includeManagers
      ? [
          {
            managerAddress,
            managerRuntimeCodeSha256: sha('manager'),
            facadeAddress,
            facadeRuntimeCodeSha256: sha('facade'),
            creditAccounts: [
              {
                accountAddress: firstAccountAddress,
                runtimeCodeSha256: sha('first-account'),
              },
              {
                accountAddress: secondAccountAddress,
                runtimeCodeSha256: sha('second-account'),
              },
            ],
          },
        ]
      : [],
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function accountTranscript(
  accountAddress: string,
  runtimeCodeSha256: string,
  borrowerAddress: string,
  debtAtomic: string,
  accruedInterestAtomic: string,
  accruedFeesAtomic: string,
  creditManagerAddress = managerAddress,
) {
  return {
    accountAddress,
    runtimeCodeSha256,
    creditManager: creditManagerAddress,
    factory: accountFactoryAddress,
    version: '300',
    creditAccountInfo: {
      debtAtomic,
      cumulativeIndexLastUpdate: '12',
      cumulativeQuotaInterest: '3',
      quotaFees: '4',
      enabledTokensMask: '5',
      flags: '0',
      lastDebtUpdate: '900',
      borrowerAddress,
    },
    debtOnly: {
      debtAtomic,
      cumulativeIndexNow: '13',
      cumulativeIndexLastUpdate: '12',
      cumulativeQuotaInterest: '3',
      accruedInterestAtomic,
      accruedFeesAtomic,
      totalDebtUsd: '0',
      totalValue: '0',
      totalValueUsd: '0',
      twvUsd: '0',
      enabledTokensMask: '5',
      quotedTokensMask: '0',
      quotedTokenAddresses: [],
      poolQuotaKeeper: quotaKeeperAddress,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function fixture(includeManagers = true) {
  const approval = approvalWithManagers(includeManagers);
  const approvalFingerprint = gearboxV3AccountPositionTranscriptApprovalFingerprintSha256(approval);
  const manager = approval.managers[0];
  const firstApprovedAccount = manager?.creditAccounts[0];
  const secondApprovedAccount = manager?.creditAccounts[1];
  if (manager && (!firstApprovedAccount || !secondApprovedAccount)) {
    throw new Error('invalid test fixture');
  }
  const approvedRuntimeHash = (index: number): string => {
    const account = manager?.creditAccounts[index];
    if (!account) throw new Error('invalid test fixture');
    return account.runtimeCodeSha256;
  };
  const managers = manager
    ? [
        {
          managerAddress,
          blockHash: selectedHash,
          requireCanonical: true,
          managerRuntimeCodeSha256: manager.managerRuntimeCodeSha256,
          pool: contracts.pool,
          underlying: contracts.underlying,
          addressProvider: contracts.addressProvider,
          accountFactory: accountFactoryAddress,
          creditFacade: facadeAddress,
          poolQuotaKeeper: quotaKeeperAddress,
          version: '300',
          facadeRuntimeCodeSha256: manager.facadeRuntimeCodeSha256,
          facadeCreditManager: managerAddress,
          facadeVersion: '300',
          creditAccountsLengthBefore: '2',
          pages: [
            {
              offset: '0',
              limit: '2',
              accountAddresses: [firstAccountAddress, secondAccountAddress],
            },
          ],
          accounts: [
            accountTranscript(
              firstAccountAddress,
              approvedRuntimeHash(0),
              walletAddress,
              '5',
              '2',
              '1',
            ),
            accountTranscript(
              secondAccountAddress,
              approvedRuntimeHash(1),
              otherBorrower,
              '99',
              '1',
              '0',
            ),
          ],
          creditAccountsLengthAfter: '2',
        },
      ]
    : [];
  const managerAddresses = manager ? [managerAddress] : [];
  const transcript = {
    transcriptVersion: 1,
    use: GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_USE,
    mayEstablishRecommendationEligibility: false,
    mayAuthorizeFinancialAction: false,
    mayPersist: false,
    mayCreatePositionSnapshot: false,
    maySign: false,
    mayAccessWalletPrivateKey: false,
    manifestFingerprintSha256: manifestFingerprint,
    semanticsFingerprintSha256: GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
    approvalFingerprintSha256: approvalFingerprint,
    walletAddress,
    evaluatedAt: '1970-01-01T00:20:00.000Z',
    chainIdBefore: '0x1',
    blockSelector: 'finalized',
    selectedBlock: { ...selectedBlock },
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    continuityFloor: {
      kind: 'EVM_BLOCK',
      blockNumber: '99',
      blockHash: blockHash('floor'),
    },
    staticCodeReads: [
      {
        role: 'ADDRESS_PROVIDER',
        address: contracts.addressProvider,
        blockHash: selectedHash,
        requireCanonical: true,
        observedRuntimeCodeSha256: manifest.runtimeCodeSha256.addressProvider,
      },
      {
        role: 'CONTRACTS_REGISTER',
        address: contracts.contractsRegister,
        blockHash: selectedHash,
        requireCanonical: true,
        observedRuntimeCodeSha256: manifest.runtimeCodeSha256.contractsRegister,
      },
      {
        role: 'POOL',
        address: contracts.pool,
        blockHash: selectedHash,
        requireCanonical: true,
        observedRuntimeCodeSha256: manifest.runtimeCodeSha256.pool,
      },
      {
        role: 'UNDERLYING',
        address: contracts.underlying,
        blockHash: selectedHash,
        requireCanonical: true,
        observedRuntimeCodeSha256: manifest.runtimeCodeSha256.underlying,
      },
    ],
    root: {
      blockHash: selectedHash,
      requireCanonical: true,
      contractsRegisterFromAddressProvider: contracts.contractsRegister,
      accountFactoryFromAddressProvider: accountFactoryAddress,
      poolRegistered: true,
      poolAddressProvider: contracts.addressProvider,
      poolUnderlying: contracts.underlying,
      poolAsset: contracts.underlying,
      poolVersion: '300',
      poolDecimals: 6,
      underlyingDecimals: 6,
      poolQuotaKeeper: quotaKeeperAddress,
      poolQuotaKeeperRuntimeCodeSha256: approval.root.poolQuotaKeeperRuntimeCodeSha256,
      poolQuotaKeeperPool: contracts.pool,
      poolQuotaKeeperUnderlying: contracts.underlying,
      poolQuotaKeeperVersion: '300',
      accountFactoryRuntimeCodeSha256: approval.root.accountFactoryRuntimeCodeSha256,
      accountFactoryVersion: '300',
    },
    managerAddressesBefore: [...managerAddresses],
    supply: {
      blockHash: selectedHash,
      requireCanonical: true,
      walletAddress,
      sharesAtomic: '3',
      totalAssetsAtomic: '10',
      totalSupplyAtomic: '4',
    },
    managers,
    managerAddressesAfter: [...managerAddresses],
    closeoutBlock: { ...selectedBlock },
    chainIdAfter: '0x1',
    executionOrder: [...gearboxV3AccountPositionTranscriptExecutionOrder(approval)],
  };
  return { approval, approvalFingerprint, transcript };
}

function evaluatorFor(value = fixture()): DormantGearboxV3AccountPositionTranscriptEvaluator {
  return new DormantGearboxV3AccountPositionTranscriptEvaluator(
    manifest,
    manifestFingerprint,
    GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
    value.approval,
    value.approvalFingerprint,
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type Transcript = ReturnType<typeof fixture>['transcript'];
type TranscriptManager = Transcript['managers'][number];
type TranscriptAccount = TranscriptManager['accounts'][number];

function requiredManager(candidate: Transcript): TranscriptManager {
  const manager = candidate.managers[0];
  if (!manager) throw new Error('invalid test fixture');
  return manager;
}

function requiredAccount(candidate: Transcript, index: number): TranscriptAccount {
  const account = requiredManager(candidate).accounts[index];
  if (!account) throw new Error('invalid test fixture');
  return account;
}

const derivedAddress = (seed: string): string => `0x${sha(seed).slice(0, 40)}`;

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function multiManagerFixture() {
  const empty = fixture(false);
  const approval = clone(empty.approval);
  approval.managers = [129, 2].map((accountCount, managerIndex) => {
    const dynamicManagerAddress = derivedAddress(`manager-${managerIndex}`);
    const dynamicFacadeAddress = derivedAddress(`facade-${managerIndex}`);
    return {
      managerAddress: dynamicManagerAddress,
      managerRuntimeCodeSha256: sha(`manager-code-${managerIndex}`),
      facadeAddress: dynamicFacadeAddress,
      facadeRuntimeCodeSha256: sha(`facade-code-${managerIndex}`),
      creditAccounts: Array.from({ length: accountCount }, (_, accountIndex) => ({
        accountAddress: derivedAddress(`account-${managerIndex}-${accountIndex}`),
        runtimeCodeSha256: sha(`account-code-${managerIndex}-${accountIndex}`),
      })),
    };
  });
  const approvalFingerprint = gearboxV3AccountPositionTranscriptApprovalFingerprintSha256(approval);
  const transcript = clone(empty.transcript);
  transcript.approvalFingerprintSha256 = approvalFingerprint;
  transcript.managerAddressesBefore = approval.managers.map((manager) => manager.managerAddress);
  transcript.managerAddressesAfter = approval.managers.map((manager) => manager.managerAddress);
  transcript.managers = approval.managers.map((manager) => {
    const accountAddresses = manager.creditAccounts.map((account) => account.accountAddress);
    const pages = [] as Array<{
      offset: string;
      limit: string;
      accountAddresses: string[];
    }>;
    for (let offset = 0; offset < accountAddresses.length; offset += 128) {
      const limit = Math.min(128, accountAddresses.length - offset);
      pages.push({
        offset: offset.toString(10),
        limit: limit.toString(10),
        accountAddresses: accountAddresses.slice(offset, offset + limit),
      });
    }
    return {
      managerAddress: manager.managerAddress,
      blockHash: selectedHash,
      requireCanonical: true,
      managerRuntimeCodeSha256: manager.managerRuntimeCodeSha256,
      pool: contracts.pool,
      underlying: contracts.underlying,
      addressProvider: contracts.addressProvider,
      accountFactory: accountFactoryAddress,
      creditFacade: manager.facadeAddress,
      poolQuotaKeeper: quotaKeeperAddress,
      version: '300',
      facadeRuntimeCodeSha256: manager.facadeRuntimeCodeSha256,
      facadeCreditManager: manager.managerAddress,
      facadeVersion: '300',
      creditAccountsLengthBefore: accountAddresses.length.toString(10),
      pages,
      accounts: manager.creditAccounts.map((account, accountIndex) =>
        accountTranscript(
          account.accountAddress,
          account.runtimeCodeSha256,
          accountIndex === 0 ? walletAddress : otherBorrower,
          '1',
          '0',
          '0',
          manager.managerAddress,
        ),
      ),
      creditAccountsLengthAfter: accountAddresses.length.toString(10),
    };
  });
  transcript.executionOrder = [...gearboxV3AccountPositionTranscriptExecutionOrder(approval)];
  return { approval, approvalFingerprint, transcript };
}

function expectUnavailable(action: () => unknown): void {
  try {
    action();
    throw new Error('expected unavailable');
  } catch (error) {
    expect(error).toBeInstanceOf(GearboxV3AccountPositionTranscriptUnavailableError);
    expect(error).toMatchObject({
      name: 'GearboxV3AccountPositionTranscriptUnavailableError',
      code: 'GEARBOX_V3_ACCOUNT_POSITION_TRANSCRIPT_UNAVAILABLE',
      message: 'Gearbox V3 account-position transcript is unavailable.',
    });
  }
}

describe('DormantGearboxV3AccountPositionTranscriptEvaluator', () => {
  it('validates exhaustive caller-approved topology but never authenticates a complete position', () => {
    const value = fixture();
    const result = evaluatorFor(value).evaluate(value.transcript);

    expect(result).toMatchObject({
      mayEstablishRecommendationEligibility: false,
      mayAuthorizeFinancialAction: false,
      mayPersist: false,
      mayCreatePositionSnapshot: false,
      maySign: false,
      mayAccessWalletPrivateKey: false,
      mayEstablishCompletePosition: false,
      transcriptCoverageStatus: 'COMPLETE_TRANSCRIPT_NOT_AUTHENTICATED',
      completenessStatus: 'NOT_ESTABLISHED_PENDING_INDEPENDENT_AUTHENTICITY',
      providerId: 'gearbox',
      protocolId: 'gearbox-v3',
      networkId: 'eip155:1',
      marketId: 'gearbox-v3-ethereum-usdc',
      walletAddress,
      blockNumber: '100',
      blockHash: selectedHash,
      managerCount: '1',
      creditAccountCount: '2',
      walletOwnedCreditAccountCount: '1',
      suppliedUnderlyingAtomicFloor: '7',
      borrowedUnderlyingAtomic: '8',
      manifestFingerprintSha256: manifestFingerprint,
      semanticsFingerprintSha256: GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
      approvalFingerprintSha256: value.approvalFingerprint,
    });
    expect(result.transcriptFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.supplyProjection)).toBe(true);
    expect(evaluatorFor(value).evaluate(clone(value.transcript))).toEqual(result);
  });

  it('permits a zero-position projection only after validating an explicitly empty manager universe', () => {
    const value = fixture(false);
    const result = evaluatorFor(value).evaluate(value.transcript);

    expect(result).toMatchObject({
      managerCount: '0',
      creditAccountCount: '0',
      walletOwnedCreditAccountCount: '0',
      borrowedUnderlyingAtomic: '0',
      mayEstablishCompletePosition: false,
      transcriptCoverageStatus: 'COMPLETE_TRANSCRIPT_NOT_AUTHENTICATED',
    });
  });

  it('requires every approval and semantics fingerprint separately and ships no topology defaults', () => {
    const value = fixture();
    expectUnavailable(
      () =>
        new DormantGearboxV3AccountPositionTranscriptEvaluator(
          manifest,
          manifestFingerprint,
          GEARBOX_V3_ACCOUNT_POSITION_SEMANTICS_FINGERPRINT_SHA256,
          value.approval,
          sha('wrong-approval'),
        ),
    );
    expectUnavailable(
      () =>
        new DormantGearboxV3AccountPositionTranscriptEvaluator(
          manifest,
          manifestFingerprint,
          sha('wrong-semantics'),
          value.approval,
          value.approvalFingerprint,
        ),
    );

    const changed = clone(value.approval);
    changed.root.poolQuotaKeeperRuntimeCodeSha256 = sha('changed');
    expectUnavailable(() => evaluatorFor({ ...value, approval: changed }));
    expectUnavailable(() => gearboxV3AccountPositionTranscriptApprovalFingerprintSha256({}));
  });

  it('rejects every dynamic-to-static alias and an identical manager/facade identity', () => {
    const mutations: Array<(candidate: ReturnType<typeof approvalWithManagers>) => void> = [
      (candidate) => {
        candidate.root.poolQuotaKeeperAddress = contracts.pool;
      },
      (candidate) => {
        const manager = candidate.managers[0];
        if (!manager) throw new Error('invalid test fixture');
        manager.managerAddress = contracts.contractsRegister;
      },
      (candidate) => {
        const manager = candidate.managers[0];
        if (!manager) throw new Error('invalid test fixture');
        manager.facadeAddress = contracts.underlying;
      },
      (candidate) => {
        const manager = candidate.managers[0];
        if (!manager) throw new Error('invalid test fixture');
        manager.facadeAddress = manager.managerAddress;
      },
      (candidate) => {
        const account = candidate.managers[0]?.creditAccounts[0];
        if (!account) throw new Error('invalid test fixture');
        account.accountAddress = contracts.addressProvider;
      },
    ];
    for (const mutate of mutations) {
      const candidate = clone(approvalWithManagers());
      mutate(candidate);
      expectUnavailable(() =>
        gearboxV3AccountPositionTranscriptApprovalFingerprintSha256(candidate),
      );
    }
  });

  it('requires the exact manager universe in the same order before and after all account reads', () => {
    const value = fixture();
    const missingBefore = clone(value.transcript);
    missingBefore.managerAddressesBefore = [];
    expectUnavailable(() => evaluatorFor(value).evaluate(missingBefore));

    const changedAfter = clone(value.transcript);
    changedAfter.managerAddressesAfter = [facadeAddress];
    expectUnavailable(() => evaluatorFor(value).evaluate(changedAfter));

    const missingManager = clone(value.transcript);
    missingManager.managers = [];
    expectUnavailable(() => evaluatorFor(value).evaluate(missingManager));
  });

  it('rejects root, manager, facade, quota-keeper, and account-factory topology drift', () => {
    const value = fixture();
    const cases: Array<(candidate: typeof value.transcript) => void> = [
      (candidate) => {
        candidate.root.poolRegistered = false;
      },
      (candidate) => {
        candidate.root.poolQuotaKeeperRuntimeCodeSha256 = sha('wrong');
      },
      (candidate) => {
        candidate.root.accountFactoryVersion = '301';
      },
      (candidate) => {
        Object.assign(requiredManager(candidate), { pool: contracts.underlying });
      },
      (candidate) => {
        requiredManager(candidate).facadeCreditManager = facadeAddress;
      },
      (candidate) => {
        requiredManager(candidate).managerRuntimeCodeSha256 = sha('wrong');
      },
      (candidate) => {
        requiredAccount(candidate, 1).factory = quotaKeeperAddress;
      },
    ];
    for (const mutate of cases) {
      const candidate = clone(value.transcript);
      mutate(candidate);
      expectUnavailable(() => evaluatorFor(value).evaluate(candidate));
    }
  });

  it('requires gapless exact pages, repeated lengths, ordered accounts, and unique approval identities', () => {
    const value = fixture();
    const badOffset = clone(value.transcript);
    const badPage = requiredManager(badOffset).pages[0];
    if (!badPage) throw new Error('invalid test fixture');
    badPage.offset = '1';
    expectUnavailable(() => evaluatorFor(value).evaluate(badOffset));

    const changedLength = clone(value.transcript);
    requiredManager(changedLength).creditAccountsLengthAfter = '1';
    expectUnavailable(() => evaluatorFor(value).evaluate(changedLength));

    const reversed = clone(value.transcript);
    const reversedPage = requiredManager(reversed).pages[0];
    if (!reversedPage) throw new Error('invalid test fixture');
    reversedPage.accountAddresses.reverse();
    expectUnavailable(() => evaluatorFor(value).evaluate(reversed));

    const duplicateApproval = clone(value.approval);
    const duplicateManager = duplicateApproval.managers[0];
    const duplicateAccount = duplicateManager?.creditAccounts[1];
    if (!duplicateAccount) throw new Error('invalid test fixture');
    duplicateAccount.accountAddress = firstAccountAddress;
    expectUnavailable(() =>
      gearboxV3AccountPositionTranscriptApprovalFingerprintSha256(duplicateApproval),
    );
  });

  it('validates bounded multi-manager pagination and rejects gaps, overlaps, reorder, and cross-manager duplicates', () => {
    const value = multiManagerFixture();
    expect(evaluatorFor(value).evaluate(value.transcript)).toMatchObject({
      managerCount: '2',
      creditAccountCount: '131',
      walletOwnedCreditAccountCount: '2',
      borrowedUnderlyingAtomic: '2',
    });
    expect(value.transcript.managers[0]?.pages).toEqual([
      expect.objectContaining({ offset: '0', limit: '128' }),
      expect.objectContaining({ offset: '128', limit: '1' }),
    ]);

    for (const offset of ['129', '127']) {
      const candidate = clone(value.transcript);
      const secondPage = candidate.managers[0]?.pages[1];
      if (!secondPage) throw new Error('invalid test fixture');
      secondPage.offset = offset;
      expectUnavailable(() => evaluatorFor(value).evaluate(candidate));
    }

    const reordered = clone(value.transcript);
    const firstPage = reordered.managers[0]?.pages[0];
    if (!firstPage) throw new Error('invalid test fixture');
    [firstPage.accountAddresses[0], firstPage.accountAddresses[1]] = [
      firstPage.accountAddresses[1] ?? '',
      firstPage.accountAddresses[0] ?? '',
    ];
    expectUnavailable(() => evaluatorFor(value).evaluate(reordered));

    const duplicateAcrossManagers = clone(value.approval);
    const first = duplicateAcrossManagers.managers[0]?.creditAccounts[0];
    const second = duplicateAcrossManagers.managers[1]?.creditAccounts[0];
    if (!first || !second) throw new Error('invalid test fixture');
    second.accountAddress = first.accountAddress;
    expectUnavailable(() =>
      gearboxV3AccountPositionTranscriptApprovalFingerprintSha256(duplicateAcrossManagers),
    );
  });

  it('uses only same-block borrower ownership and still validates every non-wallet account', () => {
    const value = fixture();
    const recycled = clone(value.transcript);
    requiredAccount(recycled, 0).creditAccountInfo.borrowerAddress = otherBorrower;
    expect(evaluatorFor(value).evaluate(recycled)).toMatchObject({
      walletOwnedCreditAccountCount: '0',
      borrowedUnderlyingAtomic: '0',
    });

    const invalidOtherAccount = clone(value.transcript);
    requiredAccount(invalidOtherAccount, 1).runtimeCodeSha256 = sha('wrong');
    expectUnavailable(() => evaluatorFor(value).evaluate(invalidOtherAccount));
  });

  it('content-binds every validated transcript field with order-independent object keys', () => {
    const value = fixture();
    const baseline = evaluatorFor(value).evaluate(value.transcript);
    const changedNonWalletEvidence = clone(value.transcript);
    requiredAccount(changedNonWalletEvidence, 1).debtOnly.totalValue = '1';
    const changed = evaluatorFor(value).evaluate(changedNonWalletEvidence);
    expect(changed.borrowedUnderlyingAtomic).toBe(baseline.borrowedUnderlyingAtomic);
    expect(changed.transcriptFingerprintSha256).not.toBe(baseline.transcriptFingerprintSha256);

    const reorderedKeys = clone(value.transcript);
    reorderedKeys.root = Object.fromEntries(
      Object.entries(reorderedKeys.root).reverse(),
    ) as typeof reorderedKeys.root;
    expect(evaluatorFor(value).evaluate(reorderedKeys).transcriptFingerprintSha256).toBe(
      baseline.transcriptFingerprintSha256,
    );
  });

  it('matches fixed approval and complete-transcript SHA-256 golden vectors', () => {
    const value = fixture();
    expect(value.approvalFingerprint).toBe(
      'd626694cf288238daba87f043207a84738006fc4310f978c56869bb149566927',
    );
    expect(evaluatorFor(value).evaluate(value.transcript).transcriptFingerprintSha256).toBe(
      'a676268f7507b4450a7044023c258bb7316e982968ba8fd9464e7c7aa9f81ae9',
    );
  });

  it('cross-checks principal, index, mask, quota keeper, and checked debt aggregation', () => {
    const value = fixture();
    const cases: Array<(candidate: typeof value.transcript) => void> = [
      (candidate) => {
        requiredAccount(candidate, 0).debtOnly.debtAtomic = '6';
      },
      (candidate) => {
        requiredAccount(candidate, 0).debtOnly.cumulativeIndexLastUpdate = '11';
      },
      (candidate) => {
        requiredAccount(candidate, 0).debtOnly.enabledTokensMask = '6';
      },
      (candidate) => {
        requiredAccount(candidate, 0).debtOnly.poolQuotaKeeper = accountFactoryAddress;
      },
      (candidate) => {
        const account = requiredAccount(candidate, 0);
        account.creditAccountInfo.debtAtomic = ((1n << 256n) - 1n).toString(10);
        account.debtOnly.debtAtomic = ((1n << 256n) - 1n).toString(10);
        account.debtOnly.accruedInterestAtomic = '1';
      },
      (candidate) => {
        requiredAccount(candidate, 0).creditAccountInfo.flags = '65536';
      },
      (candidate) => {
        requiredAccount(candidate, 0).debtOnly.cumulativeQuotaInterest = (1n << 128n).toString(10);
      },
    ];
    for (const mutate of cases) {
      const candidate = clone(value.transcript);
      mutate(candidate);
      expectUnavailable(() => evaluatorFor(value).evaluate(candidate));
    }
  });

  it('applies supply-side floor rounding and rejects impossible same-block share state', () => {
    const value = fixture();
    const fractional = clone(value.transcript);
    fractional.supply.sharesAtomic = '1';
    fractional.supply.totalAssetsAtomic = '2';
    fractional.supply.totalSupplyAtomic = '3';
    expect(evaluatorFor(value).evaluate(fractional)).toMatchObject({
      suppliedUnderlyingAtomicFloor: '0',
    });

    const impossible = clone(value.transcript);
    impossible.supply.sharesAtomic = '5';
    impossible.supply.totalSupplyAtomic = '4';
    expectUnavailable(() => evaluatorFor(value).evaluate(impossible));
  });

  it('binds every observation to one block, a continuity floor, freshness, and closeout', () => {
    const value = fixture();
    const cases: Array<(candidate: typeof value.transcript) => void> = [
      (candidate) => {
        const codeRead = candidate.staticCodeReads[0];
        if (!codeRead) throw new Error('invalid test fixture');
        codeRead.blockHash = blockHash('wrong');
      },
      (candidate) => {
        requiredManager(candidate).blockHash = blockHash('wrong');
      },
      (candidate) => {
        candidate.closeoutBlock.stateRoot = blockHash('wrong');
      },
      (candidate) => {
        candidate.continuityFloor.blockNumber = '101';
      },
      (candidate) => {
        candidate.continuityFloor.blockNumber = '100';
        candidate.continuityFloor.blockHash = blockHash('wrong');
      },
      (candidate) => {
        candidate.evaluatedAt = '1970-01-01T01:16:40.000Z';
      },
      (candidate) => {
        candidate.chainIdAfter = '0x2';
      },
    ];
    for (const mutate of cases) {
      const candidate = clone(value.transcript);
      mutate(candidate);
      expectUnavailable(() => evaluatorFor(value).evaluate(candidate));
    }
  });

  it('requires the exact declared execution order', () => {
    const value = fixture();
    const reordered = clone(value.transcript);
    const first = reordered.executionOrder[0];
    const second = reordered.executionOrder[1];
    if (!first || !second) throw new Error('invalid test fixture');
    reordered.executionOrder[0] = second;
    reordered.executionOrder[1] = first;
    expectUnavailable(() => evaluatorFor(value).evaluate(reordered));

    const omitted = clone(value.transcript);
    omitted.executionOrder.pop();
    expectUnavailable(() => evaluatorFor(value).evaluate(omitted));
  });

  it('rejects accessors, proxies, cycles, sparse arrays, symbols, and custom prototypes', () => {
    const value = fixture();
    let invoked = false;
    const accessor = clone(value.transcript);
    Object.defineProperty(accessor, 'walletAddress', {
      enumerable: true,
      get: () => {
        invoked = true;
        return walletAddress;
      },
    });
    expectUnavailable(() => evaluatorFor(value).evaluate(accessor));
    expect(invoked).toBe(false);

    expectUnavailable(() => evaluatorFor(value).evaluate(new Proxy(value.transcript, {})));

    const shallowSchemaFailure = clone(value.transcript) as typeof value.transcript & {
      unexpected?: unknown[];
    };
    shallowSchemaFailure.unexpected = [];
    shallowSchemaFailure.unexpected.length = 4_000_000_000;
    expectUnavailable(() => evaluatorFor(value).evaluate(shallowSchemaFailure));

    const cyclic = clone(value.transcript) as typeof value.transcript & {
      cycle?: unknown;
    };
    cyclic.cycle = cyclic;
    expectUnavailable(() => evaluatorFor(value).evaluate(cyclic));

    const sparse = clone(value.transcript);
    delete sparse.executionOrder[1];
    expectUnavailable(() => evaluatorFor(value).evaluate(sparse));

    const hugeSparse = clone(value.transcript);
    hugeSparse.executionOrder = [];
    hugeSparse.executionOrder.length = 4_000_000_000;
    expectUnavailable(() => evaluatorFor(value).evaluate(hugeSparse));

    const symbolic = clone(value.transcript) as typeof value.transcript & {
      [key: symbol]: unknown;
    };
    symbolic[Symbol('unexpected')] = true;
    expectUnavailable(() => evaluatorFor(value).evaluate(symbolic));

    const customPrototype = clone(value.transcript);
    Object.setPrototypeOf(customPrototype.root, { hostile: true });
    expectUnavailable(() => evaluatorFor(value).evaluate(customPrototype));
  });

  it('contains no endpoint, ambient configuration, I/O, runtime registration, or transaction authority', () => {
    const source = readFileSync(__filename.replace(/\.spec\.ts$/u, '.ts'), 'utf8');
    expect(source).not.toMatch(
      /process\.env|fetch\s*\(|axios|https?:\/\/|@(Injectable|Module|Controller)|readTranscript|sendTransaction|signTransaction|privateKey|\.adapter['"]|node:(?:fs|http|https|net|tls)|@nestjs\//u,
    );
    expect(source).toContain("from './gearbox-v3-ethereum-usdc.manifest'");
    expect(source).toContain("from './gearbox-v3-account-position.semantics'");
    expect(source).toContain('mayEstablishCompletePosition: false');
    expect(source).toContain('COMPLETE_TRANSCRIPT_NOT_AUTHENTICATED');
  });
});
