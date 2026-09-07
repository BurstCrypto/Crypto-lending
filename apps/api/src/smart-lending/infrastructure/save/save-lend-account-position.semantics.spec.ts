import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { solanaWalletAddressBytes } from '../../../wallets/domain/wallet-identity';
import {
  createSaveLendOwnerDiscoveryPlan,
  evaluateSaveLendAccountPositionSnapshot,
  type EvaluateSaveLendAccountPositionSnapshotV1,
  projectSaveLendBorrowToLiquidityAtomic,
  projectSaveLendCollateralToLiquidityAtomic,
  SAVE_LEND_ACCOUNT_POSITION_CROSS_LANGUAGE_VECTORS,
  SAVE_LEND_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS,
  SAVE_LEND_ACCOUNT_POSITION_IDENTITIES as ID,
  SAVE_LEND_ACCOUNT_POSITION_LAYOUT,
  SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_USE,
  SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_VERSION,
  SAVE_LEND_ACCOUNT_POSITION_SOURCE_PINS,
  SaveLendAccountPositionSemanticsUnavailableError,
  type SaveLendSuppliedAccountV1,
} from './save-lend-account-position.semantics';

const OWNER = '6U6X3Xn9gcc4Bu1ubmvMbGmuHwHFR4KgvMzHw9mk5VVT';
const OBLIGATION_A = 'BKkAkaN9hzbY1SUu2kmZQYGm2yfngyjq1p8opdUVtEXU';
const OBLIGATION_B = '72v6pWXgaBx9sFRBC4J2knf1AWwAddFTzW3UvF1FYmUV';
const COLLATERAL_MINT = '2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9';
const ROOT_BLOCKHASH = '9yvBHzFpm1EtuhoaP8qo4ZtbWrg5vQqChbrP239DM57Z';
const SLOT = '250000000';
const WAD = 1_000_000_000_000_000_000n;

function writeKey(data: Buffer, offset: number, address: string): void {
  Buffer.from(solanaWalletAddressBytes(address)).copy(data, offset);
}

function writeUnsignedLittleEndian(
  data: Buffer,
  offset: number,
  bytes: number,
  value: bigint,
): void {
  let remainder = value;
  for (let index = 0; index < bytes; index += 1) {
    data[offset + index] = Number(remainder & 0xffn);
    remainder >>= 8n;
  }
  if (remainder !== 0n) throw new Error('fixture overflow');
}

function reserveData(options?: {
  readonly contextSlot?: bigint;
  readonly stale?: number;
  readonly availableAmount?: bigint;
  readonly borrowedAmountWads?: bigint;
  readonly cumulativeBorrowRateWads?: bigint;
  readonly accumulatedProtocolFeesWads?: bigint;
  readonly collateralMintTotalSupply?: bigint;
}): Buffer {
  const data = Buffer.alloc(619);
  data[0] = 1;
  writeUnsignedLittleEndian(data, 1, 8, options?.contextSlot ?? BigInt(SLOT));
  data[9] = options?.stale ?? 0;
  writeKey(data, 10, ID.lendingMarketAddress);
  writeKey(data, 42, ID.usdcMintAddress);
  data[74] = 6;
  writeUnsignedLittleEndian(data, 171, 8, options?.availableAmount ?? 1_000_000n);
  writeUnsignedLittleEndian(data, 179, 16, options?.borrowedAmountWads ?? 0n);
  writeUnsignedLittleEndian(data, 195, 16, options?.cumulativeBorrowRateWads ?? (WAD * 12n) / 10n);
  writeKey(data, 227, COLLATERAL_MINT);
  writeUnsignedLittleEndian(data, 259, 8, options?.collateralMintTotalSupply ?? 1_000_000n);
  writeUnsignedLittleEndian(data, 373, 16, options?.accumulatedProtocolFeesWads ?? 0n);
  return data;
}

function obligationData(options?: {
  readonly owner?: string;
  readonly lendingMarket?: string;
  readonly contextSlot?: bigint;
  readonly stale?: number;
  readonly collateralAmount?: bigint;
  readonly borrowedAmountWads?: bigint;
  readonly obligationCumulativeBorrowRateWads?: bigint;
  readonly depositsLength?: number;
  readonly borrowsLength?: number;
}): Buffer {
  const data = Buffer.alloc(1_300);
  data[0] = 1;
  writeUnsignedLittleEndian(data, 1, 8, options?.contextSlot ?? BigInt(SLOT));
  data[9] = options?.stale ?? 0;
  writeKey(data, 10, options?.lendingMarket ?? ID.lendingMarketAddress);
  writeKey(data, 42, options?.owner ?? OWNER);
  const depositsLength = options?.depositsLength ?? 1;
  const borrowsLength = options?.borrowsLength ?? 1;
  data[202] = depositsLength;
  data[203] = borrowsLength;
  if (depositsLength > 0) {
    writeKey(data, 204, ID.reserveAddress);
    writeUnsignedLittleEndian(data, 236, 8, options?.collateralAmount ?? 250_000n);
  }
  if (borrowsLength > 0) {
    const offset = 204 + depositsLength * 88;
    if (offset + 112 <= data.byteLength) {
      writeKey(data, offset, ID.reserveAddress);
      writeUnsignedLittleEndian(
        data,
        offset + 32,
        16,
        options?.obligationCumulativeBorrowRateWads ?? WAD,
      );
      writeUnsignedLittleEndian(
        data,
        offset + 48,
        16,
        options?.borrowedAmountWads ?? (WAD * 25n) / 10n,
      );
    }
  }
  return data;
}

function envelope(
  accountAddress: string,
  data: Buffer,
  contextSlot = SLOT,
): SaveLendSuppliedAccountV1 {
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
  readonly reserve?: SaveLendSuppliedAccountV1;
  readonly obligations?: readonly SaveLendSuppliedAccountV1[];
}): EvaluateSaveLendAccountPositionSnapshotV1 {
  return {
    semanticsVersion: SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_VERSION,
    use: SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_USE,
    mayPersist: false,
    mayAuthorizeFinancialAction: false,
    mayEstablishCompletePosition: false,
    networkId: ID.networkId,
    genesisHash: ID.genesisHash,
    programAddress: ID.programAddress,
    lendingMarketAddress: ID.lendingMarketAddress,
    reserveAddress: ID.reserveAddress,
    assetMintAddress: ID.usdcMintAddress,
    assetDecimals: 6,
    ownerAddress: OWNER,
    commitment: 'finalized',
    contextSlot: SLOT,
    finalizedRootSlot: SLOT,
    finalizedRootBlockhash: ROOT_BLOCKHASH,
    accountSetStatus: 'CALLER_ASSERTED_COMPLETE_UNVERIFIED',
    responseTruncated: false,
    reserveAccount: options?.reserve ?? envelope(ID.reserveAddress, reserveData()),
    obligationAccounts: options?.obligations ?? [envelope(OBLIGATION_A, obligationData())],
  };
}

function rebindData(account: SaveLendSuppliedAccountV1, data: Buffer): void {
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
    expect(error).toBeInstanceOf(SaveLendAccountPositionSemanticsUnavailableError);
    expect(error).toMatchObject({
      name: 'SaveLendAccountPositionSemanticsUnavailableError',
      code: 'SAVE_LEND_ACCOUNT_POSITION_SEMANTICS_UNAVAILABLE',
      message: 'Save Lend account-position semantics are unavailable.',
    });
  }
}

describe('Save Lend account-position semantics', () => {
  it('pins immutable program and SDK sources by commit and content digest', () => {
    expect(SAVE_LEND_ACCOUNT_POSITION_SOURCE_PINS).toEqual({
      programRepository: 'solendprotocol/solana-program-library',
      programCommitSha: 'd04ce00bbf4356c4fd32b3be38eb9760b696bb3e',
      rustObligationPath: 'token-lending/sdk/src/state/obligation.rs',
      rustObligationSha256: '836e2120836970196994becb01f03129e88cb88ec234e297e810e5f508c27b91',
      rustReservePath: 'token-lending/sdk/src/state/reserve.rs',
      rustReserveSha256: '3f470697c67ba43e12e6b61638607cf025d129c0f59884e80c58cbb2b94c7c85',
      rustStatePath: 'token-lending/sdk/src/state/mod.rs',
      rustStateSha256: '5ebfe1021ba6bb9d63c97eebbaafae2b9b4cdbc55e6605815558bd13107546a0',
      rustDecimalPath: 'token-lending/sdk/src/math/decimal.rs',
      rustDecimalSha256: '7cabaf64a733dd2891a2c8c64459f952b3a623b7e9c6eb1655024a5e0b8ffec7',
      rustMathCommonPath: 'token-lending/sdk/src/math/common.rs',
      rustMathCommonSha256: '889d649766e06bf8e5c3b86aa6d7e0f77c98bc14dfcbbe67b893cffe0bff1409',
      publicRepository: 'solendprotocol/public',
      publicCommitSha: 'b3b46ffbc2f5162b6e5680dd3cad1042c2eb3f8e',
      sdkObligationPath: 'solend-sdk/src/state/obligation.ts',
      sdkObligationSha256: '2f150df321c08739cdeb18187f6dd0c3df898f3e8b383c7f2b177f1438f6852b',
      sdkReservePath: 'solend-sdk/src/state/reserve.ts',
      sdkReserveSha256: '81e41065981ecfc3bd30508d78eb1ac9393d5d882b00ace5ada87bdb78a66b16',
    });
    expect(Object.isFrozen(SAVE_LEND_ACCOUNT_POSITION_SOURCE_PINS)).toBe(true);
  });

  it('records exact account offsets and the deliberately incomplete discovery status', () => {
    expect(SAVE_LEND_ACCOUNT_POSITION_LAYOUT).toMatchObject({
      obligation: {
        accountBytes: 1_300,
        lendingMarketOffset: 10,
        ownerOffset: 42,
        depositsLengthOffset: 202,
        borrowsLengthOffset: 203,
        dataOffset: 204,
        dataBytes: 1_096,
        collateralEntryBytes: 88,
        borrowEntryBytes: 112,
        maximumCombinedEntries: 10,
      },
      reserve: {
        accountBytes: 619,
        liquidityAvailableAmountOffset: 171,
        liquidityBorrowedAmountWadsOffset: 179,
        liquidityCumulativeBorrowRateWadsOffset: 195,
        collateralMintTotalSupplyOffset: 259,
        accumulatedProtocolFeesWadsOffset: 373,
      },
      decimal: { scale: 18, wad: WAD.toString(10), serializedBytes: 16 },
    });
    expect(SAVE_LEND_ACCOUNT_POSITION_DISCOVERY_REQUIREMENTS).toMatchObject({
      method: 'getProgramAccounts',
      commitment: 'finalized',
      withContext: true,
      filters: [
        { dataSize: 1_300 },
        { memcmp: { offset: 10, bytes: ID.lendingMarketAddress } },
        { memcmp: { offset: 42, bytes: 'OWNER_ADDRESS' } },
      ],
      mayEstablishCompletePosition: false,
    });
  });

  it('replays the pinned Rust floor, ceiling, protocol-fee, and WAD vectors', () => {
    for (const vector of SAVE_LEND_ACCOUNT_POSITION_CROSS_LANGUAGE_VECTORS) {
      if ('collateralAmount' in vector) {
        expect(
          projectSaveLendCollateralToLiquidityAtomic({
            collateralAmount: BigInt(vector.collateralAmount),
            availableAmount: BigInt(vector.availableAmount),
            reserveBorrowedAmountWads: BigInt(vector.reserveBorrowedAmountWads),
            accumulatedProtocolFeesWads: BigInt(vector.accumulatedProtocolFeesWads),
            collateralMintTotalSupply: BigInt(vector.collateralMintTotalSupply),
          }).toString(10),
        ).toBe(vector.expectedSupplyAtomicFloor);
      } else {
        expect(
          projectSaveLendBorrowToLiquidityAtomic({
            borrowedAmountWads: BigInt(vector.borrowedAmountWads),
            obligationCumulativeBorrowRateWads: BigInt(vector.obligationCumulativeBorrowRateWads),
            reserveCumulativeBorrowRateWads: BigInt(vector.reserveCumulativeBorrowRateWads),
          }).toString(10),
        ).toBe(vector.expectedBorrowAtomicCeil);
      }
    }
  });

  it('builds but never sends the exact finalized owner-and-market discovery request', () => {
    expect(createSaveLendOwnerDiscoveryPlan(OWNER, SLOT)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'getProgramAccounts',
      params: [
        ID.programAddress,
        {
          commitment: 'finalized',
          encoding: 'base64',
          withContext: true,
          minContextSlot: 250_000_000,
          filters: [
            { dataSize: 1_300 },
            { memcmp: { offset: 10, bytes: ID.lendingMarketAddress } },
            { memcmp: { offset: 42, bytes: OWNER } },
          ],
        },
      ],
    });
  });

  it('decodes supplied collateral and conservatively accrued debt without claiming completeness', () => {
    const result = evaluateSaveLendAccountPositionSnapshot(snapshot());
    expect(result).toMatchObject({
      providerId: 'save',
      protocolId: 'save-lend',
      networkId: ID.networkId,
      ownerAddress: OWNER,
      sourcePosition: SLOT,
      obligationAccountCount: 1,
      matchedDepositCount: 1,
      matchedBorrowCount: 1,
      suppliedAtomicFloor: '250000',
      borrowedAtomicCeil: '3',
      completeness: 'INCOMPLETE_UNVERIFIED_DISCOVERY',
      mayPersist: false,
      mayAuthorizeFinancialAction: false,
      mayEstablishCompletePosition: false,
    });
    expect(result.snapshotFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('is order-independent while binding every account digest into the fingerprint', () => {
    const empty = obligationData({ depositsLength: 0, borrowsLength: 0 });
    const first = envelope(OBLIGATION_A, obligationData());
    const second = envelope(OBLIGATION_B, empty);
    const left = evaluateSaveLendAccountPositionSnapshot(
      snapshot({ obligations: [first, second] }),
    );
    const right = evaluateSaveLendAccountPositionSnapshot(
      snapshot({ obligations: [second, first] }),
    );
    expect(left.snapshotFingerprintSha256).toBe(right.snapshotFingerprintSha256);

    const changed = obligationData({ depositsLength: 0, borrowsLength: 0, stale: 1 });
    const changedResult = evaluateSaveLendAccountPositionSnapshot(
      snapshot({ obligations: [first, envelope(OBLIGATION_B, changed)] }),
    );
    expect(changedResult.snapshotFingerprintSha256).not.toBe(left.snapshotFingerprintSha256);
  });

  it('rejects mismatched ownership, market, context, hashes, truncation, and stale reserves', async () => {
    const cases: unknown[] = [];

    const wrongOwner = snapshot();
    rebindData(wrongOwner.obligationAccounts[0]!, obligationData({ owner: OBLIGATION_B }));
    cases.push(wrongOwner);

    const wrongMarket = snapshot();
    rebindData(wrongMarket.obligationAccounts[0]!, obligationData({ lendingMarket: OBLIGATION_B }));
    cases.push(wrongMarket);

    const contextMismatch = snapshot();
    (contextMismatch.obligationAccounts[0] as unknown as Record<string, unknown>).contextSlot =
      '249999999';
    cases.push(contextMismatch);

    const badHash = snapshot();
    (badHash.reserveAccount as unknown as Record<string, unknown>).accountDataSha256 = '1'.repeat(
      64,
    );
    cases.push(badHash);

    const truncated = snapshot() as unknown as Record<string, unknown>;
    truncated.responseTruncated = true;
    cases.push(truncated);

    const staleReserve = snapshot({
      reserve: envelope(ID.reserveAddress, reserveData({ stale: 1 })),
    });
    cases.push(staleReserve);

    for (const candidate of cases) {
      await expectUnavailable(() => evaluateSaveLendAccountPositionSnapshot(candidate));
    }
  });

  it('rejects impossible accounting, entry counts, duplicates, negative interest, and shapes', async () => {
    const impossibleFees = snapshot({
      reserve: envelope(
        ID.reserveAddress,
        reserveData({ availableAmount: 0n, accumulatedProtocolFeesWads: 1n }),
      ),
    });
    await expectUnavailable(() => evaluateSaveLendAccountPositionSnapshot(impossibleFees));

    const zeroDeposit = snapshot();
    rebindData(zeroDeposit.obligationAccounts[0]!, obligationData({ collateralAmount: 0n }));
    await expectUnavailable(() => evaluateSaveLendAccountPositionSnapshot(zeroDeposit));

    const overflowCounts = snapshot();
    rebindData(
      overflowCounts.obligationAccounts[0]!,
      obligationData({ depositsLength: 10, borrowsLength: 0 }),
    );
    await expectUnavailable(() => evaluateSaveLendAccountPositionSnapshot(overflowCounts));

    const duplicate = snapshot();
    (duplicate.obligationAccounts as SaveLendSuppliedAccountV1[]).push(
      duplicate.obligationAccounts[0]!,
    );
    await expectUnavailable(() => evaluateSaveLendAccountPositionSnapshot(duplicate));

    await expectUnavailable(() =>
      projectSaveLendBorrowToLiquidityAtomic({
        borrowedAmountWads: WAD,
        obligationCumulativeBorrowRateWads: WAD * 2n,
        reserveCumulativeBorrowRateWads: WAD,
      }),
    );

    const extraKey = snapshot() as unknown as Record<string, unknown>;
    extraKey.endpoint = 'https://rpc.invalid';
    await expectUnavailable(() => evaluateSaveLendAccountPositionSnapshot(extraKey));
  });

  it('contains no endpoint, environment, client, signing, persistence, or broadcast capability', () => {
    const source = readFileSync(__filename.replace(/\.spec\.ts$/u, '.ts'), 'utf8');
    expect(source).not.toMatch(
      /(?:\bfetch\s*\(|\bprocess\.env\b|\b(?:axios|undici|WebSocket)\b|\b(?:signTransaction|sendTransaction|broadcast|persist|write)\s*\()/u,
    );
    expect(source).not.toContain('mayAuthorizeFinancialAction: true');
    expect(source).not.toContain('mayEstablishCompletePosition: true');
  });
});
