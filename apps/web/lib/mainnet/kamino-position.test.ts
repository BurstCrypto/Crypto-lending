// @vitest-environment node
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { KAMINO_COLLATERAL_MINT, KAMINO_MARKET } from '../../../../onchain/src/destination-lending';
import { SOLANA_USDC } from '../../../../onchain/src/source-plan';
import { corroborateKaminoValue, kaminoPositionValue } from './kamino-position.server';

const SCALE = 1n << 60n;
function fraction(data: Buffer, offset: number, value: bigint) {
  data.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  data.writeBigUInt64LE(value >> 64n, offset + 8);
}
function reserve() {
  const data = Buffer.alloc(8624);
  createHash('sha256').update('account:Reserve').digest().copy(data, 0, 0, 8);
  data.writeBigUInt64LE(1n, 8);
  KAMINO_MARKET.toBuffer().copy(data, 32);
  SOLANA_USDC.toBuffer().copy(data, 128);
  data.writeBigUInt64LE(6n, 272);
  KAMINO_COLLATERAL_MINT.toBuffer().copy(data, 2560);
  // 800 available + 280 borrowed - 80 in protocol/referral fees = 1000 USDC,
  // represented by 800 receipt tokens. Eight receipt tokens are worth 10 USDC.
  data.writeBigUInt64LE(800_000_000n, 224);
  fraction(data, 232, 280_000_000n * SCALE);
  fraction(data, 344, 50_000_000n * SCALE);
  fraction(data, 360, 20_000_000n * SCALE);
  fraction(data, 376, 10_000_000n * SCALE);
  data.writeBigUInt64LE(800_000_000n, 2592);
  return data;
}

it('values receipt tokens in USDC after excluding protocol and referral fees, and tracks accrued interest', () => {
  const data = reserve();
  expect(kaminoPositionValue(data, 8_000_000n)).toEqual({
    supplied: 10_000_000n,
    receiptExchangeRate: 1_250_000_000_000_000_000n,
  });
  fraction(data, 232, 290_000_000n * SCALE);
  expect(kaminoPositionValue(data, 8_000_000n)).toEqual({
    supplied: 10_100_000n,
    receiptExchangeRate: 1_262_500_000_000_000_000n,
  });
  expect(kaminoPositionValue(data, 0n).supplied).toBe(0n);
  expect(kaminoPositionValue(data, 1n).supplied).toBe(1n);
});

it('keeps exact atomic units above the JavaScript safe integer limit and rounds down only at the end', () => {
  const data = reserve();
  data.writeBigUInt64LE(27_021_597_764_222_979n, 224);
  data.writeBigUInt64LE(18_014_398_509_481_986n, 2592);
  for (const offset of [232, 344, 360, 376]) fraction(data, offset, 0n);
  expect(kaminoPositionValue(data, 9_007_199_254_740_993n)).toEqual({
    supplied: 13_510_798_882_111_489n,
    receiptExchangeRate: 1_500_000_000_000_000_000n,
  });
});

it('rejects a changed reserve identity, decimals or invalid accounting instead of treating receipts as USDC', () => {
  const changes = [
    (data: Buffer) => data.subarray(0, 100),
    (data: Buffer) => {
      data[0] = data[0]! ^ 255;
      return data;
    },
    (data: Buffer) => {
      data.writeBigUInt64LE(2n, 8);
      return data;
    },
    (data: Buffer) => {
      data.fill(0, 128, 160);
      return data;
    },
    (data: Buffer) => {
      data.writeBigUInt64LE(9n, 272);
      return data;
    },
    (data: Buffer) => {
      data.writeBigUInt64LE(0n, 2592);
      return data;
    },
    (data: Buffer) => {
      fraction(data, 344, 2_000_000_000n * SCALE);
      return data;
    },
  ];
  for (const change of changes)
    expect(() => kaminoPositionValue(change(reserve()), 8_000_000n)).toThrow(/exchange.rate/);
  expect(() => kaminoPositionValue(reserve(), -1n)).toThrow(/exchange rate/);
  expect(() => kaminoPositionValue(reserve(), 800_000_001n)).toThrow(/exchange rate/);
});

it('uses corroborated conservative values and leaves the USDC value unavailable when sources disagree', () => {
  const left = kaminoPositionValue(reserve(), 8_000_000n);
  const right = {
    supplied: 10_000_010n,
    receiptExchangeRate: left.receiptExchangeRate + 1_250_000_000_000n,
  };
  expect(corroborateKaminoValue(left, right)).toEqual({
    supplied: '10000000',
    receiptExchangeRate: '1250000000000000000',
  });
  expect(corroborateKaminoValue(right, left)).toEqual(corroborateKaminoValue(left, right));
  expect(
    corroborateKaminoValue(left, { ...right, receiptExchangeRate: 1_300_000_000_000_000_000n }),
  ).toEqual({ supplied: null, receiptExchangeRate: null });
});
