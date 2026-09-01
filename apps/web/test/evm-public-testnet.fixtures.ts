import { encodeFunctionData, keccak256, stringToHex } from 'viem';

import {
  EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER,
  EVM_PUBLIC_TESTNET_AMOUNT_ATOMIC,
  EVM_PUBLIC_TESTNET_AMOUNT_HEX,
  EVM_PUBLIC_TESTNET_ATOKEN,
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_DATA_PROVIDER,
  EVM_PUBLIC_TESTNET_FAUCET_URL,
  EVM_PUBLIC_TESTNET_GATEWAY,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
  EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI,
  EVM_PUBLIC_TESTNET_RESERVE,
} from '../lib/evm-public-testnet/constants';
import type {
  EvmPublicTestnetExecutionRequest,
  EvmPublicTestnetSubmissionStatus,
} from '../lib/evm-public-testnet/execution';

export const EVM_PUBLIC_TESTNET_ACCOUNT = '0x1111111111111111111111111111111111111111' as const;
export const EVM_PUBLIC_TESTNET_INTENT_ID = '11111111-1111-4111-8111-111111111111';
export const EVM_PUBLIC_TESTNET_TRANSACTION_HASH = `0x${'22'.repeat(32)}`;
export const EVM_PUBLIC_TESTNET_NOW = new Date('2026-08-31T22:00:00.000Z');
export const EVM_PUBLIC_TESTNET_EXPIRES_AT = '2026-08-31T22:01:00.000Z';
export const EVM_PUBLIC_TESTNET_EVIDENCE_EXPIRES_AT = '2026-08-31T22:30:00.000Z';

const DEPOSIT_ETH_ABI = [
  {
    type: 'function',
    name: 'depositETH',
    stateMutability: 'payable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
] as const;

export function evmPublicTestnetInput(
  account: `0x${string}` = EVM_PUBLIC_TESTNET_ACCOUNT,
  intentId = EVM_PUBLIC_TESTNET_INTENT_ID,
): `0x${string}` {
  const call = encodeFunctionData({
    abi: DEPOSIT_ETH_ABI,
    functionName: 'depositETH',
    args: [EVM_PUBLIC_TESTNET_POOL, account, 0],
  });
  const marker = keccak256(stringToHex(`crypto-lending:base-sepolia-aave-v3-proof:v1:${intentId}`));
  return `${call}${marker.slice(2)}`;
}

export function evmPublicTestnetRequest(): EvmPublicTestnetExecutionRequest {
  return {
    portfolioSnapshotId: 'local-demo-portfolio:11111111111111111111111111111111',
    selection: {
      kind: 'PRESET',
      presetId: 'BALANCED',
      liquidReserveBasisPoints: 500,
    },
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: EVM_PUBLIC_TESTNET_ACCOUNT,
  };
}

export function evmPublicTestnetIntentResponse(
  intentId = EVM_PUBLIC_TESTNET_INTENT_ID,
  nonce = '0x7',
) {
  const request = evmPublicTestnetRequest();
  return {
    use: 'EVM_PUBLIC_TESTNET_SINGLE_POSITION_PROOF_ONLY',
    mayAuthorizeMainnetFinancialAction: false,
    intentId,
    expiresAt: EVM_PUBLIC_TESTNET_EXPIRES_AT,
    evidenceExpiresAt: EVM_PUBLIC_TESTNET_EVIDENCE_EXPIRES_AT,
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: EVM_PUBLIC_TESTNET_ACCOUNT,
    portfolioBinding: {
      portfolioSnapshotId: request.portfolioSnapshotId,
      selection: { ...request.selection },
    },
    proof: {
      kind: 'SINGLE_TESTNET_PROOF_POSITION',
      amountAtomic: EVM_PUBLIC_TESTNET_AMOUNT_ATOMIC,
      assetSymbol: 'ETH',
      assetDecimals: 18,
      notFullBlend: true,
    },
    transaction: {
      from: EVM_PUBLIC_TESTNET_ACCOUNT,
      to: EVM_PUBLIC_TESTNET_GATEWAY,
      value: EVM_PUBLIC_TESTNET_AMOUNT_HEX,
      input: evmPublicTestnetInput(EVM_PUBLIC_TESTNET_ACCOUNT, intentId),
      nonce,
      chainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
    },
    fundingReadiness: {
      status: 'READY',
      nativeBalanceWei: EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI,
      requiredNativeBalanceWei: EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI,
      faucetUrl: EVM_PUBLIC_TESTNET_FAUCET_URL,
    },
    liveObservation: {
      confirmation: 'LATEST_PREFLIGHT_OBSERVATION',
      blockNumber: '46223597',
      blockHash: `0x${'33'.repeat(32)}`,
      observedAt: '2026-08-31T21:59:59.000Z',
      aTokenBalanceBeforeAtomic: '0',
    },
    providerVisibility: 'ONCHAIN_TARGETS_PUBLIC_TO_SIGNER',
  };
}

export function evmPublicTestnetSubmissionResponse(
  status: EvmPublicTestnetSubmissionStatus = 'VERIFIED',
  transactionHash: string | null = EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
  intentId = EVM_PUBLIC_TESTNET_INTENT_ID,
) {
  const pending = status === 'PENDING';
  return {
    intentId,
    status,
    confirmation: 'LATEST_RECEIPT_AND_FINALITY_OBSERVATION',
    transaction: {
      status,
      transactionHash,
      blockNumber: pending ? null : '46223601',
      blockHash: pending ? null : `0x${'44'.repeat(32)}`,
    },
    position: {
      status,
      aTokenBalanceBeforeAtomic: '0',
      aTokenBalanceAfterAtomic: pending ? null : EVM_PUBLIC_TESTNET_AMOUNT_ATOMIC,
      increaseAtomic: pending ? null : EVM_PUBLIC_TESTNET_AMOUNT_ATOMIC,
    },
    consumed: !pending,
  };
}

export function evmPublicTestnetPositionResponse() {
  return {
    use: 'EVM_PUBLIC_TESTNET_READ_ONLY_POSITION',
    mayAuthorizeFinancialAction: false,
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: EVM_PUBLIC_TESTNET_ACCOUNT,
    provider: {
      name: 'Aave V3',
      pool: EVM_PUBLIC_TESTNET_POOL,
      addressesProvider: EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER,
      dataProvider: EVM_PUBLIC_TESTNET_DATA_PROVIDER,
      gateway: EVM_PUBLIC_TESTNET_GATEWAY,
      reserve: EVM_PUBLIC_TESTNET_RESERVE,
      aToken: EVM_PUBLIC_TESTNET_ATOKEN,
    },
    position: {
      status: 'OPEN',
      assetSymbol: 'ETH',
      assetDecimals: 18,
      suppliedLiquidityAtomic: EVM_PUBLIC_TESTNET_AMOUNT_ATOMIC,
      aTokenSymbol: 'aBaseSepoliaWETH',
      aTokenBalanceAtomic: EVM_PUBLIC_TESTNET_AMOUNT_ATOMIC,
      aTokenDecimals: 18,
    },
    rate: {
      kind: 'ONCHAIN_INDICATIVE_BASE_SUPPLY_APY',
      liquidityRateRay: '15591000000000000000000000',
      supplyApyBasisPoints: 157,
      variable: true,
      rewardsIncluded: false,
      riskAssessed: false,
      historyAvailable: false,
    },
    liveObservation: {
      confirmation: 'LATEST_POSITION_OBSERVATION',
      blockNumber: '46223602',
      blockHash: `0x${'55'.repeat(32)}`,
      finalizedBlockNumber: '46223000',
      finalizedBlockHash: `0x${'66'.repeat(32)}`,
      observedAt: '2026-08-31T22:00:01.000Z',
    },
  };
}
