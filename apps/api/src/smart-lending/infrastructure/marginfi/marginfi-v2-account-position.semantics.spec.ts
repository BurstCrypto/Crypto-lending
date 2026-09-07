import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { solanaWalletAddressBytes } from '../../../wallets/domain/wallet-identity';
import {
  createMarginfiV2AuthorityDiscoveryPlan,
  evaluateMarginfiV2SuppliedAccountSnapshot,
  MARGINFI_V2_ACCOUNT_POSITION_CROSS_LANGUAGE_VECTORS,
  MARGINFI_V2_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS,
  MARGINFI_V2_ACCOUNT_POSITION_IDENTITIES as ID,
  MARGINFI_V2_ACCOUNT_POSITION_LAYOUT,
  MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_USE,
  MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_VERSION,
  MARGINFI_V2_ACCOUNT_POSITION_SOURCE_PINS,
  MarginfiV2AccountPositionSemanticsUnavailableError,
  projectMarginfiV2I80F48SharesToAtomic,
  type EvaluateMarginfiV2SuppliedAccountSnapshotV1,
  type MarginfiV2SuppliedAccountV1,
} from './marginfi-v2-account-position.semantics';

const AUTHORITY = '6U6X3Xn9gcc4Bu1ubmvMbGmuHwHFR4KgvMzHw9mk5VVT';
const ACCOUNT_A = 'BKkAkaN9hzbY1SUu2kmZQYGm2yfngyjq1p8opdUVtEXU';
const ACCOUNT_B = '72v6pWXgaBx9sFRBC4J2knf1AWwAddFTzW3UvF1FYmUV';
const ROOT_BLOCKHASH = '9yvBHzFpm1EtuhoaP8qo4ZtbWrg5vQqChbrP239DM57Z';
const SLOT = '250000000';
const SCALE = 1n << 48n;
const ACCOUNT_BYTES = 2_312;
const BANK_BYTES = 1_864;
const BALANCES_OFFSET = 72;
const BALANCE_BYTES = 104;
const ACCOUNT_DISCRIMINATOR = Buffer.from([67, 178, 130, 109, 126, 114, 28, 42]);
const BANK_DISCRIMINATOR = Buffer.from([142, 49, 166, 242, 50, 66, 97, 188]);

interface BalanceFixture {
  readonly bankAddress?: string;
  readonly active?: number;
  readonly assetTag?: number;
  readonly assetSharesRaw?: bigint;
  readonly liabilitySharesRaw?: bigint;
  readonly emissionsRaw?: bigint;
}

function writeKey(data: Buffer, offset: number, address: string): void {
  Buffer.from(solanaWalletAddressBytes(address)).copy(data, offset);
}

function writeI80F48Raw(data: Buffer, offset: number, value: bigint): void {
  const unsigned = value < 0n ? (1n << 128n) + value : value;
  let remainder = unsigned;
  for (let index = 0; index < 16; index += 1) {
    data[offset + index] = Number(remainder & 0xffn);
    remainder >>= 8n;
  }
}

function i80F48LeHex(value: bigint): string {
  const bytes = Buffer.alloc(16);
  writeI80F48Raw(bytes, 0, value);
  return bytes.toString('hex');
}

function accountData(
  balances: readonly BalanceFixture[] = [],
  authority = AUTHORITY,
  group = ID.groupAddress,
): Buffer {
  const data = Buffer.alloc(ACCOUNT_BYTES);
  ACCOUNT_DISCRIMINATOR.copy(data, 0);
  writeKey(data, 8, group);
  writeKey(data, 40, authority);
  balances.forEach((balance, index) => {
    const offset = BALANCES_OFFSET + index * BALANCE_BYTES;
    data[offset] = balance.active ?? 1;
    writeKey(data, offset + 1, balance.bankAddress ?? ID.bankAddress);
    data[offset + 33] = balance.assetTag ?? 0;
    data.writeUInt16LE(index + 1, offset + 34);
    writeI80F48Raw(data, offset + 40, balance.assetSharesRaw ?? 0n);
    writeI80F48Raw(data, offset + 56, balance.liabilitySharesRaw ?? 0n);
    writeI80F48Raw(data, offset + 72, balance.emissionsRaw ?? 0n);
    data.writeBigUInt64LE(1_725_642_000n, offset + 88);
  });
  return data;
}

function bankData(assetShareValueRaw = SCALE, liabilityShareValueRaw = SCALE): Buffer {
  const data = Buffer.alloc(BANK_BYTES);
  BANK_DISCRIMINATOR.copy(data, 0);
  writeKey(data, 8, ID.usdcMintAddress);
  data[40] = 6;
  writeKey(data, 41, ID.groupAddress);
  writeI80F48Raw(data, 80, assetShareValueRaw);
  writeI80F48Raw(data, 96, liabilityShareValueRaw);
  data[608] = 1;
  data[784] = 0;
  data[785] = 0;
  return data;
}

function envelope(
  accountAddress: string,
  data: Buffer,
  contextSlot = SLOT,
): MarginfiV2SuppliedAccountV1 {
  return {
    accountAddress,
    ownerProgramAddress: ID.programAddress,
    executable: false,
    contextSlot,
    space: data.byteLength.toString(10),
    accountDataBase64: data.toString('base64'),
    accountDataSha256: createHash('sha256').update(data).digest('hex'),
  };
}

function snapshot(options?: {
  readonly bankAssetShareValueRaw?: bigint;
  readonly bankLiabilityShareValueRaw?: bigint;
  readonly accounts?: readonly MarginfiV2SuppliedAccountV1[];
}): EvaluateMarginfiV2SuppliedAccountSnapshotV1 {
  const bank = bankData(
    options?.bankAssetShareValueRaw ?? SCALE,
    options?.bankLiabilityShareValueRaw ?? SCALE,
  );
  return {
    semanticsVersion: MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_VERSION,
    use: MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_USE,
    mayPersist: false,
    mayAuthorizeFinancialAction: false,
    mayEstablishCompletePosition: false,
    networkId: ID.networkId,
    genesisHash: ID.genesisHash,
    programAddress: ID.programAddress,
    groupAddress: ID.groupAddress,
    bankAddress: ID.bankAddress,
    assetMintAddress: ID.usdcMintAddress,
    assetDecimals: 6,
    authorityAddress: AUTHORITY,
    commitment: 'finalized',
    contextSlot: SLOT,
    finalizedRootSlot: SLOT,
    finalizedRootBlockhash: ROOT_BLOCKHASH,
    accountSetStatus: 'CALLER_ASSERTED_COMPLETE_UNVERIFIED',
    responseTruncated: false,
    bankAccount: envelope(ID.bankAddress, bank),
    accounts: options?.accounts ?? [],
  };
}

function rebindData(account: MarginfiV2SuppliedAccountV1, data: Buffer): void {
  const mutable = account as unknown as Record<string, unknown>;
  mutable.space = data.byteLength.toString(10);
  mutable.accountDataBase64 = data.toString('base64');
  mutable.accountDataSha256 = createHash('sha256').update(data).digest('hex');
}

async function expectUnavailable(action: () => unknown): Promise<void> {
  try {
    await action();
    throw new Error('expected unavailable');
  } catch (error) {
    expect(error).toBeInstanceOf(MarginfiV2AccountPositionSemanticsUnavailableError);
    expect(error).toMatchObject({
      name: 'MarginfiV2AccountPositionSemanticsUnavailableError',
      code: 'MARGINFI_V2_ACCOUNT_POSITION_SEMANTICS_UNAVAILABLE',
      message: 'Marginfi v2 account-position semantics are unavailable.',
    });
  }
}

describe('Marginfi v2 account-position semantics', () => {
  it('pins the two immutable official source trees and every reviewed source file', () => {
    expect(MARGINFI_V2_ACCOUNT_POSITION_SOURCE_PINS).toEqual({
      sourceFileHashBytes: 'GIT_BLOB_CONTENT_AT_PINNED_COMMIT',
      marginfiV2Repository: '0dotxyz/marginfi-v2',
      marginfiV2CommitSha: '5c97c5efb68a24f68041d2bb7d90917b8dc989e2',
      p0TsSdkRepository: '0dotxyz/p0-ts-sdk',
      p0TsSdkCommitSha: '64773b237961c17e5dacbbf4bfe87b8af22e885b',
      rustUserAccountPath: 'type-crate/src/types/user_account.rs',
      rustUserAccountSha256: '2d0e1a62870f91a6a6a7e5d6125181ed2aebf534fd78106b26d695796c757854',
      rustBankPath: 'type-crate/src/types/bank.rs',
      rustBankSha256: '5c69b0563487c6021aea604d7af2febf8b936969b086ffa8035ba57bb9daf634',
      rustWrappedI80F48Path: 'type-crate/src/types/wrapped_i80f48.rs',
      rustWrappedI80F48Sha256: '2a9108b2e7971ebd95116c83430eef8f435942d077292c1cba8f5772459d1a92',
      rustConstantsPath: 'type-crate/src/constants.rs',
      rustConstantsSha256: '4c7ccf066a02ef349ebc6e467de0f43212272d0e1f7746a2d81017e06a62a522',
      rustAccountStatePath: 'programs/marginfi/src/state/marginfi_account.rs',
      rustAccountStateSha256: 'a187a9dbb67aa9c8dab0df0d7fea12fbf295926999b5084e5a747271322fbd85',
      sdkDiscoveryPath: 'src/services/account/utils/fetch.utils.ts',
      sdkDiscoverySha256: '61952621b02b8c729373f8109af1d5e7fcf9869a4da824b75e281b2bc3a410f6',
      sdkI80F48Path: 'src/utils/conversion.utils.ts',
      sdkI80F48Sha256: '55c672e3844ed9b85100f709078ee07e8f7641474e4f8b8c88e3d91980d7bae7',
      sdkShareConversionPath: 'src/services/bank/utils/compute/share-conversions.utils.ts',
      sdkShareConversionSha256: 'beac5ede978a3d6c1d788da37e6bffc24a6e0e25b6bdf198765342ac52b36114',
      sdkIdlPath: 'src/idl/marginfi_0.1.11.json',
      sdkIdlSha256: '3722ae1bcb29bcbdff1b0194802c3f77ab27af8ada34cbb2bb89c5228ef4cb95',
    });
    expect(Object.isFrozen(MARGINFI_V2_ACCOUNT_POSITION_SOURCE_PINS)).toBe(true);
  });

  it('pins the only proven account layout and all sixteen bank-key offsets', () => {
    expect(MARGINFI_V2_ACCOUNT_POSITION_LAYOUT).toMatchObject({
      unsupportedAccountLengthPolicy: 'REJECT',
      activeBytePolicy: 'ONLY_CANONICAL_0_OR_1_DUE_TO_PINNED_RUST_SDK_DISAGREEMENT',
      emptyBalanceThresholdI80F48Raw: SCALE.toString(10),
      supportedAccountVersions: [
        {
          id: 'MARGINFI_ACCOUNT_0_1_11_CURRENT',
          discriminator: [67, 178, 130, 109, 126, 114, 28, 42],
          discriminatorBase58: 'CKkRR4La3xu',
          payloadBytes: 2_304,
          accountBytes: ACCOUNT_BYTES,
          groupOffset: 8,
          authorityOffset: 40,
          balancesOffset: 72,
          balanceCount: 16,
          balanceBytes: 104,
          balanceOffsets: {
            active: 0,
            bankPublicKey: 1,
            bankAssetTag: 33,
            tag: 34,
            padding: 36,
            assetShares: 40,
            liabilityShares: 56,
            emissionsOutstanding: 72,
            lastUpdate: 88,
            trailingPadding: 96,
          },
        },
      ],
      bank: {
        id: 'BANK_0_1_11_CURRENT',
        payloadBytes: 1_856,
        accountBytes: BANK_BYTES,
        discriminator: [142, 49, 166, 242, 50, 66, 97, 188],
        mintOffset: 8,
        mintDecimalsOffset: 40,
        groupOffset: 41,
        assetShareValueOffset: 80,
        liabilityShareValueOffset: 96,
        operationalStateOffset: 608,
        riskTierOffset: 784,
        assetTagOffset: 785,
        integrationAccountsOffset: 1_560,
        integrationAccountsBytes: 96,
      },
    });
    expect(MARGINFI_V2_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS.bankPublicKeyOffsets).toEqual([
      73, 177, 281, 385, 489, 593, 697, 801, 905, 1009, 1113, 1217, 1321, 1425, 1529, 1633,
    ]);
  });

  it('builds the exact authority/group discovery plan without granting completeness', () => {
    const plan = createMarginfiV2AuthorityDiscoveryPlan(AUTHORITY);
    expect(plan).toEqual({
      method: 'getProgramAccounts',
      programAddress: ID.programAddress,
      configuration: {
        commitment: 'finalized',
        encoding: 'base64',
        withContext: true,
        minContextSlot: 'AUTHENTICATED_DURABLE_FLOOR_REQUIRED',
        filters: [
          { memcmp: { offset: 0, bytes: 'CKkRR4La3xu' } },
          { dataSize: ACCOUNT_BYTES },
          { memcmp: { offset: 8, bytes: ID.groupAddress } },
          { memcmp: { offset: 40, bytes: AUTHORITY } },
        ],
      },
      postDecodeBankAddress: ID.bankAddress,
      bankPublicKeyOffsets:
        MARGINFI_V2_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS.bankPublicKeyOffsets,
      completenessStatus: 'NOT_ESTABLISHED_BY_STANDARD_JSON_RPC',
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(MARGINFI_V2_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS).toMatchObject({
      inspectEveryReturnedAccountAndEveryBalanceSlot: true,
      deduplicateByAccountAddress: true,
      sameContextRequirement:
        'BANK_AND_EVERY_WALLET_ACCOUNT_MUST_SHARE_THE_EXACT_FINALIZED_ROOT_SLOT_AND_BLOCKHASH',
      standardJsonRpcCompletenessLimitation:
        'NO_AUTHENTICATED_NON_TRUNCATION_OR_SAME_SLOT_CROSS_CALL_PROOF',
      mayEstablishCompletePosition: false,
    });
  });

  it.each(MARGINFI_V2_ACCOUNT_POSITION_CROSS_LANGUAGE_VECTORS)(
    'matches pinned Rust and SDK share multiplication vector $id',
    (vector) => {
      expect(
        projectMarginfiV2I80F48SharesToAtomic(
          vector.sharesI80F48LeHexRaw,
          vector.shareValueI80F48LeHexRaw,
          'SUPPLY_FLOOR',
        ).atomic,
      ).toBe(vector.expectedSupplyAtomicFloor);
      expect(
        projectMarginfiV2I80F48SharesToAtomic(
          vector.sharesI80F48LeHexRaw,
          vector.shareValueI80F48LeHexRaw,
          'BORROW_CEIL',
        ).atomic,
      ).toBe(vector.expectedBorrowAtomicCeil);
    },
  );

  it('decodes and aggregates supply and debt across multiple current accounts', () => {
    const supply = envelope(
      ACCOUNT_A,
      accountData([
        {
          bankAddress: ID.groupAddress,
          assetSharesRaw: 9_000_000n * SCALE,
        },
        { assetSharesRaw: 2_000_000n * SCALE },
      ]),
    );
    const borrow = envelope(ACCOUNT_B, accountData([{ liabilitySharesRaw: (3n * SCALE) / 2n }]));
    const result = evaluateMarginfiV2SuppliedAccountSnapshot(
      snapshot({
        bankAssetShareValueRaw: (5n * SCALE) / 4n,
        bankLiabilityShareValueRaw: SCALE + 1n,
        accounts: [supply, borrow],
      }),
    );
    expect(result).toMatchObject({
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
      mayEstablishCompletePosition: false,
      calculationStatus: 'OFFLINE_SUPPLIED_ACCOUNT_SET_ONLY',
      completenessStatus: 'NOT_ESTABLISHED',
      currentInterestStatus: 'RECORDED_ON_CHAIN_SHARE_VALUES_ONLY_NOT_HYPOTHETICALLY_ACCRUED',
      contextSlot: SLOT,
      suppliedAccountCount: '2',
      matchedBalanceCount: '2',
      supply: { rounding: 'SUPPLY_FLOOR', atomic: '2500000' },
      borrow: { rounding: 'BORROW_CEIL', atomic: '2' },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(AUTHORITY);
    expect(JSON.stringify(result)).not.toContain(ACCOUNT_A);
    expect(JSON.stringify(result)).not.toContain(ACCOUNT_B);
  });

  it('applies the pinned one-native-unit dust boundary to supply and debt', () => {
    const result = evaluateMarginfiV2SuppliedAccountSnapshot(
      snapshot({
        accounts: [
          envelope(ACCOUNT_A, accountData([{ assetSharesRaw: SCALE - 1n }])),
          envelope(ACCOUNT_B, accountData([{ liabilitySharesRaw: SCALE - 1n }])),
        ],
      }),
    );
    expect(result).toMatchObject({
      suppliedAccountCount: '2',
      matchedBalanceCount: '2',
      completenessStatus: 'NOT_ESTABLISHED',
      supply: { atomic: '0' },
      borrow: { atomic: '0' },
    });
  });

  it('aggregates exact rationals before conservative rounding', () => {
    const first = envelope(ACCOUNT_A, accountData([{ assetSharesRaw: SCALE }]));
    const second = envelope(ACCOUNT_B, accountData([{ assetSharesRaw: SCALE }]));
    const result = evaluateMarginfiV2SuppliedAccountSnapshot(
      snapshot({
        bankAssetShareValueRaw: SCALE / 2n + 1n,
        accounts: [first, second],
      }),
    );
    expect(result.supply).toMatchObject({
      atomic: '1',
      fractionalRemainder: (2n * SCALE).toString(),
    });
  });

  it('keeps a supplied empty set explicitly non-authoritative', () => {
    expect(evaluateMarginfiV2SuppliedAccountSnapshot(snapshot())).toMatchObject({
      suppliedAccountCount: '0',
      matchedBalanceCount: '0',
      completenessStatus: 'NOT_ESTABLISHED',
      mayEstablishCompletePosition: false,
      supply: { atomic: '0' },
      borrow: { atomic: '0' },
    });
  });

  it.each([
    ['network', { networkId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' }],
    ['genesis', { genesisHash: ID.groupAddress }],
    ['program', { programAddress: ID.groupAddress }],
    ['group', { groupAddress: ID.bankAddress }],
    ['bank', { bankAddress: ID.groupAddress }],
    ['mint', { assetMintAddress: ID.bankAddress }],
    ['commitment', { commitment: 'confirmed' }],
    ['capability', { mayPersist: true }],
    ['complete authority', { mayEstablishCompletePosition: true }],
    ['truncation', { responseTruncated: true }],
    ['caller coverage', { accountSetStatus: 'COMPLETE' }],
    ['extra member', { endpoint: 'forbidden' }],
  ])('rejects snapshot %s drift', async (_label, override) => {
    await expectUnavailable(() =>
      evaluateMarginfiV2SuppliedAccountSnapshot({ ...snapshot(), ...override }),
    );
  });

  it.each([
    ['root slot', (value: Record<string, unknown>) => (value.finalizedRootSlot = '250000001')],
    ['root hash', (value: Record<string, unknown>) => (value.finalizedRootBlockhash = 'invalid')],
    [
      'bank context',
      (value: Record<string, unknown>) =>
        ((value.bankAccount as unknown as Record<string, unknown>).contextSlot = '250000001'),
    ],
    [
      'wallet context',
      (value: Record<string, unknown>) =>
        (((value.accounts as unknown[])[0] as unknown as Record<string, unknown>).contextSlot =
          '250000001'),
    ],
  ])('rejects non-identical finalized context: %s', async (_label, mutate) => {
    const value = snapshot({
      accounts: [envelope(ACCOUNT_A, accountData([{ assetSharesRaw: SCALE }]))],
    }) as unknown as Record<string, unknown>;
    mutate(value);
    await expectUnavailable(() => evaluateMarginfiV2SuppliedAccountSnapshot(value));
  });

  it.each([
    [
      'discriminator',
      (data: Buffer) => {
        data[0] = (data[0] ?? 0) ^ 1;
      },
    ],
    [
      'group',
      (data: Buffer) => {
        writeKey(data, 8, ID.bankAddress);
      },
    ],
    [
      'authority',
      (data: Buffer) => {
        writeKey(data, 40, ID.groupAddress);
      },
    ],
    [
      'noncanonical active byte',
      (data: Buffer) => {
        data[72] = 2;
      },
    ],
    [
      'negative asset shares',
      (data: Buffer) => {
        writeI80F48Raw(data, 72 + 40, -SCALE);
      },
    ],
    [
      'simultaneous supply and debt',
      (data: Buffer) => {
        writeI80F48Raw(data, 72 + 56, SCALE);
      },
    ],
    [
      'target bank asset tag',
      (data: Buffer) => {
        data[72 + 33] = 1;
      },
    ],
    [
      'reserved padding',
      (data: Buffer) => {
        data[72 + 36] = 1;
      },
    ],
  ])('rejects hostile current-account layout: %s', async (_label, mutate) => {
    const data = accountData([{ assetSharesRaw: SCALE }]);
    mutate(data);
    const account = envelope(ACCOUNT_A, data);
    await expectUnavailable(() =>
      evaluateMarginfiV2SuppliedAccountSnapshot(snapshot({ accounts: [account] })),
    );
  });

  it('rejects dirty inactive slots, duplicate target balances, and unsorted active banks', async () => {
    const dirtyInactive = accountData();
    dirtyInactive[73] = 1;
    await expectUnavailable(() =>
      evaluateMarginfiV2SuppliedAccountSnapshot(
        snapshot({ accounts: [envelope(ACCOUNT_A, dirtyInactive)] }),
      ),
    );

    const duplicateTarget = accountData([{ assetSharesRaw: SCALE }, { assetSharesRaw: SCALE }]);
    await expectUnavailable(() =>
      evaluateMarginfiV2SuppliedAccountSnapshot(
        snapshot({ accounts: [envelope(ACCOUNT_A, duplicateTarget)] }),
      ),
    );

    const unsorted = accountData([
      { bankAddress: ID.groupAddress, assetTag: 0, assetSharesRaw: SCALE },
      { bankAddress: ID.bankAddress, assetSharesRaw: SCALE },
    ]);
    if (
      Buffer.compare(
        Buffer.from(solanaWalletAddressBytes(ID.groupAddress)),
        Buffer.from(solanaWalletAddressBytes(ID.bankAddress)),
      ) > 0
    ) {
      writeKey(unsorted, 73, ID.bankAddress);
      writeKey(unsorted, 177, ID.groupAddress);
    }
    await expectUnavailable(() =>
      evaluateMarginfiV2SuppliedAccountSnapshot(
        snapshot({ accounts: [envelope(ACCOUNT_A, unsorted)] }),
      ),
    );

    const activeAfterInactive = accountData();
    const laterActive = accountData([{ assetSharesRaw: SCALE }]).subarray(
      BALANCES_OFFSET,
      BALANCES_OFFSET + BALANCE_BYTES,
    );
    laterActive.copy(activeAfterInactive, BALANCES_OFFSET + BALANCE_BYTES);
    await expectUnavailable(() =>
      evaluateMarginfiV2SuppliedAccountSnapshot(
        snapshot({ accounts: [envelope(ACCOUNT_A, activeAfterInactive)] }),
      ),
    );
  });

  it('rejects duplicate accounts and exact account-envelope drift', async () => {
    const account = envelope(ACCOUNT_A, accountData([{ assetSharesRaw: SCALE }]));
    await expectUnavailable(() =>
      evaluateMarginfiV2SuppliedAccountSnapshot(snapshot({ accounts: [account, account] })),
    );

    for (const mutate of [
      (value: Record<string, unknown>) => (value.ownerProgramAddress = ID.groupAddress),
      (value: Record<string, unknown>) => (value.executable = true),
      (value: Record<string, unknown>) => (value.space = '2311'),
      (value: Record<string, unknown>) => (value.accountDataSha256 = 'a'.repeat(64)),
      (value: Record<string, unknown>) => (value.accountAddress = 'invalid'),
    ]) {
      const changed = { ...account } as unknown as Record<string, unknown>;
      mutate(changed);
      await expectUnavailable(() =>
        evaluateMarginfiV2SuppliedAccountSnapshot(snapshot({ accounts: [changed as never] })),
      );
    }
  });

  it('rejects unsupported account lengths even when metadata and hash agree', async () => {
    const data = accountData([{ assetSharesRaw: SCALE }]).subarray(0, ACCOUNT_BYTES - 1);
    const account = envelope(ACCOUNT_A, Buffer.from(data));
    await expectUnavailable(() =>
      evaluateMarginfiV2SuppliedAccountSnapshot(snapshot({ accounts: [account] })),
    );
  });

  it('rejects bank identity, state, integration, and share-value drift', async () => {
    for (const mutate of [
      (data: Buffer) => (data[0] = (data[0] ?? 0) ^ 1),
      (data: Buffer) => writeKey(data, 8, ID.bankAddress),
      (data: Buffer) => (data[40] = 5),
      (data: Buffer) => writeKey(data, 41, ID.bankAddress),
      (data: Buffer) => (data[608] = 0),
      (data: Buffer) => (data[784] = 1),
      (data: Buffer) => (data[785] = 1),
      (data: Buffer) => (data[1560] = 1),
      (data: Buffer) => writeI80F48Raw(data, 80, 0n),
      (data: Buffer) => writeI80F48Raw(data, 96, -SCALE),
    ]) {
      const value = snapshot();
      const bytes = Buffer.from(value.bankAccount.accountDataBase64, 'base64');
      mutate(bytes);
      rebindData(value.bankAccount, bytes);
      await expectUnavailable(() => evaluateMarginfiV2SuppliedAccountSnapshot(value));
    }
  });

  it.each([
    ['negative shares', i80F48LeHex(-SCALE), i80F48LeHex(SCALE), 'SUPPLY_FLOOR'],
    ['zero share value', i80F48LeHex(SCALE), i80F48LeHex(0n), 'SUPPLY_FLOOR'],
    [
      'I80F48 product overflow',
      i80F48LeHex((1n << 127n) - 1n),
      i80F48LeHex(2n * SCALE),
      'SUPPLY_FLOOR',
    ],
    ['invalid rounding', i80F48LeHex(SCALE), i80F48LeHex(SCALE), 'ROUND_NEAREST'],
    ['malformed bytes', '00', i80F48LeHex(SCALE), 'SUPPLY_FLOOR'],
  ])('rejects unsafe share math: %s', async (_label, shares, value, rounding) => {
    await expectUnavailable(() => projectMarginfiV2I80F48SharesToAtomic(shares, value, rounding));
  });

  it('rejects output beyond the u64 position contract', async () => {
    const shares = 1n << 113n;
    await expectUnavailable(() =>
      projectMarginfiV2I80F48SharesToAtomic(
        i80F48LeHex(shares),
        i80F48LeHex(SCALE),
        'SUPPLY_FLOOR',
      ),
    );
  });

  it('rejects accessors without invoking them', async () => {
    let invoked = false;
    const value = Object.defineProperty({}, 'semanticsVersion', {
      enumerable: true,
      get: () => {
        invoked = true;
        return 1;
      },
    });
    await expectUnavailable(() => evaluateMarginfiV2SuppliedAccountSnapshot(value));
    expect(invoked).toBe(false);
  });

  it('contains no endpoint, ambient configuration, runtime registration, or signing path', () => {
    const source = readFileSync(__filename.replace(/\.spec\.ts$/u, '.ts'), 'utf8');
    expect(source).not.toMatch(
      /process\.env|fetch\s*\(|axios|https?:\/\/|@(Injectable|Module|Controller)|sendTransaction|signTransaction|privateKey/u,
    );
    expect(source).toContain('mayEstablishCompletePosition: false');
    expect(source).toContain('OFFLINE_SUPPLIED_ACCOUNT_SET_ONLY');
  });
});
