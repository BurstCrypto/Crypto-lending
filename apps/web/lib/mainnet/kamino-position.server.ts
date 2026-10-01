import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { KAMINO_COLLATERAL_MINT, KAMINO_MARKET } from '../../../../onchain/src/destination-lending';
import { SOLANA_USDC } from '../../../../onchain/src/source-plan';
import { fail } from './policy';

const FRACTION_SCALE = 1n << 60n;
const RATE_SCALE = 10n ** 18n;
const u128 = (data: Buffer, offset: number) => data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);

/** USDC atoms and USDC per receipt token (18 decimals), using the finalized reserve exchange rate. */
export function kaminoPositionValue(reserve: Buffer, shares: bigint) {
  // Layout and fixed-point formula from klend-sdk 38845294447623f6de3afc9dec29875f959f6f48:
  // src/@codegen/klend/{accounts/Reserve,types/ReserveLiquidity,types/ReserveCollateral}.ts
  // src/classes/reserve.ts getTotalSupplySf / getCollateralExchangeRate; Fraction uses 60 bits.
  if (reserve.length !== 8624 || reserve.readBigUInt64LE(8) !== 1n ||
    !reserve.subarray(0, 8).equals(createHash('sha256').update('account:Reserve').digest().subarray(0, 8)) ||
    !new PublicKey(reserve.subarray(32, 64)).equals(KAMINO_MARKET) ||
    !new PublicKey(reserve.subarray(128, 160)).equals(SOLANA_USDC) || reserve.readBigUInt64LE(272) !== 6n ||
    !new PublicKey(reserve.subarray(2560, 2592)).equals(KAMINO_COLLATERAL_MINT)) return fail('The Kamino USDC exchange-rate layout changed.');

  const supply = reserve.readBigUInt64LE(2592);
  const totalLiquidity = reserve.readBigUInt64LE(224) * FRACTION_SCALE + u128(reserve, 232)
    - u128(reserve, 344) - u128(reserve, 360) - u128(reserve, 376);
  if (shares < 0n || shares > supply || supply === 0n || totalLiquidity <= 0n) return fail('The Kamino USDC exchange rate is unavailable.');
  const denominator = supply * FRACTION_SCALE;
  // Calculate the balance directly before rounding; never multiply by a rounded display rate.
  return { supplied: shares * totalLiquidity / denominator, receiptExchangeRate: totalLiquidity * RATE_SCALE / denominator };
}

export function corroborateKaminoValue(left: ReturnType<typeof kaminoPositionValue>, right: ReturnType<typeof kaminoPositionValue>) {
  const lower = left.receiptExchangeRate <= right.receiptExchangeRate ? left : right;
  const upper = lower === left ? right : left;
  // Finalized sources can straddle reserve interest updates. Admit at most one
  // basis point of rate drift and display the lower value; never substitute the token count.
  if (lower.receiptExchangeRate <= 0n || (upper.receiptExchangeRate - lower.receiptExchangeRate) * 10_000n > lower.receiptExchangeRate) {
    return { supplied: null, receiptExchangeRate: null };
  }
  return { supplied: lower.supplied.toString(), receiptExchangeRate: lower.receiptExchangeRate.toString() };
}
