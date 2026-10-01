import { randomBytes } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { getAddress, isAddress, type Address, type Hex } from 'viem';

import {
  calculateRoutingFeeAtomicAmount,
  ROUTING_FEE_V1_BASIS_POINTS,
  type RoutingFeeTier,
} from '../../apps/api/src/routing-fees/domain/routing-fee.ts';

export const ETHEREUM = 'eip155:1' as const;
export const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
export const ETHEREUM_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
export const SOLANA_USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);
export const MAX_U64 = (1n << 64n) - 1n;

export type SourceNetwork = typeof ETHEREUM | typeof SOLANA;
export interface SourceBridgePlan {
  readonly intentId: Hex;
  readonly sourceNetwork: SourceNetwork;
  readonly destinationNetwork: SourceNetwork;
  readonly sourceWallet: string;
  readonly destinationWallet: string;
  readonly sourceAsset: string;
  readonly treasury: string;
  readonly mintRecipient: Hex;
  readonly principal: bigint;
  readonly platformFee: bigint;
  readonly totalSourceDebit: bigint;
  readonly maxBridgeFee: bigint;
  readonly minimumDestinationAmount: bigint;
  readonly feeBps: 20 | 12 | 8;
  readonly deadline: bigint;
}

const plans = new WeakSet<SourceBridgePlan>();
export function assertSourceBridgePlan(plan: SourceBridgePlan): void {
  if (!plans.has(plan)) throw new Error('UNVALIDATED_SOURCE_PLAN');
}

export function associatedUsdcAccount(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), SOLANA_USDC.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

function ethereumAddress(value: string): Address {
  if (!isAddress(value) || /^0x0{40}$/iu.test(value)) throw new Error('INVALID_ETHEREUM_ADDRESS');
  return getAddress(value);
}

function solanaAddress(value: string, signer = false): PublicKey {
  const key = new PublicKey(value);
  if (
    key.toBase58() !== value ||
    key.equals(PublicKey.default) ||
    (signer && !PublicKey.isOnCurve(key.toBytes()))
  )
    throw new Error('INVALID_SOLANA_ADDRESS');
  return key;
}

/** Server-side builder: tier must come from authenticated entitlement state, never request JSON. */
export function createSourceBridgePlan(input: {
  sourceNetwork: SourceNetwork;
  sourceWallet: string;
  destinationWallet: string;
  principal: bigint;
  maxBridgeFee: bigint;
  minimumDestinationAmount: bigint;
  tier?: RoutingFeeTier;
  treasuries: Readonly<{ ethereum: string; solana: string }>;
  nowSeconds: bigint;
  deadline: bigint;
  intentId?: Hex;
}): SourceBridgePlan {
  if (input.sourceNetwork !== ETHEREUM && input.sourceNetwork !== SOLANA)
    throw new Error('UNSUPPORTED_SOURCE_CHAIN');
  const feeBps = ROUTING_FEE_V1_BASIS_POINTS[input.tier ?? 'FREE'];
  if (feeBps !== 20 && feeBps !== 12 && feeBps !== 8) throw new Error('INVALID_FEE_TIER');
  for (const value of [
    input.principal,
    input.maxBridgeFee,
    input.minimumDestinationAmount,
    input.nowSeconds,
    input.deadline,
  ]) {
    if (typeof value !== 'bigint' || value < 0n || value > MAX_U64)
      throw new Error('INVALID_AMOUNT_OR_TIME');
  }
  if (
    input.principal === 0n ||
    input.maxBridgeFee >= input.principal ||
    input.minimumDestinationAmount === 0n ||
    input.minimumDestinationAmount > input.principal - input.maxBridgeFee ||
    input.deadline <= input.nowSeconds ||
    input.deadline > input.nowSeconds + 300n
  ) {
    throw new Error('INVALID_BRIDGE_LIMITS');
  }
  const fee = BigInt(
    calculateRoutingFeeAtomicAmount(
      input.principal.toString(),
      { mantissa: String(feeBps), scale: 4 },
      'HALF_EVEN',
    ),
  );
  if (input.principal + fee > MAX_U64) throw new Error('AMOUNT_OVERFLOW');
  const fromEthereum = input.sourceNetwork === ETHEREUM;
  const sourceWallet = fromEthereum
    ? ethereumAddress(input.sourceWallet)
    : solanaAddress(input.sourceWallet, true).toBase58();
  const destinationWallet = fromEthereum
    ? solanaAddress(input.destinationWallet, true).toBase58()
    : ethereumAddress(input.destinationWallet);
  const treasury = fromEthereum
    ? ethereumAddress(input.treasuries.ethereum)
    : solanaAddress(input.treasuries.solana).toBase58();
  if (treasury === sourceWallet) throw new Error('TREASURY_EQUALS_SOURCE_WALLET');
  const mintRecipient = fromEthereum
    ? (`0x${associatedUsdcAccount(new PublicKey(destinationWallet)).toBuffer().toString('hex')}` as Hex)
    : (`0x${destinationWallet.slice(2).toLowerCase().padStart(64, '0')}` as Hex);
  const intentId = input.intentId ?? `0x${randomBytes(32).toString('hex')}`;
  if (!/^0x[0-9a-f]{64}$/u.test(intentId) || /^0x0{64}$/u.test(intentId))
    throw new Error('INVALID_INTENT_ID');
  const plan: SourceBridgePlan = Object.freeze({
    intentId,
    sourceNetwork: input.sourceNetwork,
    destinationNetwork: fromEthereum ? SOLANA : ETHEREUM,
    sourceWallet,
    destinationWallet,
    sourceAsset: fromEthereum ? ETHEREUM_USDC : SOLANA_USDC.toBase58(),
    treasury,
    mintRecipient,
    principal: input.principal,
    platformFee: fee,
    totalSourceDebit: input.principal + fee,
    maxBridgeFee: input.maxBridgeFee,
    minimumDestinationAmount: input.minimumDestinationAmount,
    feeBps,
    deadline: input.deadline,
  });
  plans.add(plan);
  return plan;
}

export const BRIDGE_INTENT_TYPES = {
  BridgeIntent: [
    { name: 'intentId', type: 'bytes32' },
    { name: 'user', type: 'address' },
    { name: 'mintRecipient', type: 'bytes32' },
    { name: 'principal', type: 'uint256' },
    { name: 'maxBridgeFee', type: 'uint256' },
    { name: 'minimumDestinationAmount', type: 'uint256' },
    { name: 'feeBps', type: 'uint16' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export function ethereumBridgeIntent(plan: SourceBridgePlan) {
  assertSourceBridgePlan(plan);
  if (plan.sourceNetwork !== ETHEREUM) throw new Error('WRONG_SOURCE_CHAIN');
  return {
    intentId: plan.intentId,
    user: plan.sourceWallet as Address,
    mintRecipient: plan.mintRecipient,
    principal: plan.principal,
    maxBridgeFee: plan.maxBridgeFee,
    minimumDestinationAmount: plan.minimumDestinationAmount,
    feeBps: plan.feeBps,
    deadline: plan.deadline,
  };
}
