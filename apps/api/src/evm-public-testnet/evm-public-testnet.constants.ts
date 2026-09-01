import { getAddress, keccak256, stringToHex, type Address, type Hex } from 'viem';

export const EVM_PUBLIC_TESTNET_CHAIN_ID = 'eip155:84532' as const;
export const EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID = '0x14a34' as const;
export const EVM_PUBLIC_TESTNET_CHAIN_NUMBER = 84_532n;
export const EVM_PUBLIC_TESTNET_RPC_ENDPOINT = 'https://sepolia.base.org/' as const;
export const EVM_PUBLIC_TESTNET_EXPLORER_TRANSACTION_URL =
  'https://sepolia-explorer.base.org/tx/' as const;
export const EVM_PUBLIC_TESTNET_FAUCET = 'https://portal.cdp.coinbase.com/products/faucet' as const;

export const EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI = 50_000_000_000_000n;
export const EVM_PUBLIC_TESTNET_PROOF_AMOUNT_WEI_TEXT = '50000000000000' as const;
export const EVM_PUBLIC_TESTNET_PROOF_AMOUNT_HEX = '0x2d79883d2000' as const;
export const EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI = 100_000_000_000_000n;
export const EVM_PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_WEI_TEXT = '100000000000000' as const;
export const EVM_PUBLIC_TESTNET_ASSET_DECIMALS = 18 as const;

export const EVM_PUBLIC_TESTNET_POOL = getAddress('0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27');
export const EVM_PUBLIC_TESTNET_ADDRESSES_PROVIDER = getAddress(
  '0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00',
);
export const EVM_PUBLIC_TESTNET_DATA_PROVIDER = getAddress(
  '0xBc9f5b7E248451CdD7cA54e717a2BFe1F32b566b',
);
export const EVM_PUBLIC_TESTNET_WETH_GATEWAY = getAddress(
  '0x0568130e794429D2eEBC4dafE18f25Ff1a1ed8b6',
);
export const EVM_PUBLIC_TESTNET_WETH = getAddress('0x4200000000000000000000000000000000000006');
export const EVM_PUBLIC_TESTNET_AWETH = getAddress('0x73a5bB60b0B0fc35710DDc0ea9c407031E31Bdbb');

export const EVM_PUBLIC_TESTNET_MAX_UINT256 = (1n << 256n) - 1n;
export const EVM_PUBLIC_TESTNET_MAX_UINT256_TEXT = EVM_PUBLIC_TESTNET_MAX_UINT256.toString();
export const EVM_PUBLIC_TESTNET_ZERO_VALUE_HEX = '0x0' as const;

export const EVM_PUBLIC_TESTNET_DEPOSIT_ETH_SELECTOR = '0x474cf53d' as const;
export const EVM_PUBLIC_TESTNET_SUPPLY_EVENT_TOPIC =
  '0x2b627736bca15cd5381dcf80b0bf11fd197d01a037c52b927a881a10fb73ba61' as const;
export const EVM_PUBLIC_TESTNET_APPROVAL_EVENT_TOPIC =
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925' as const;
export const EVM_PUBLIC_TESTNET_TRANSFER_EVENT_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const;
export const EVM_PUBLIC_TESTNET_WITHDRAW_EVENT_TOPIC =
  '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7' as const;
export const EVM_PUBLIC_TESTNET_WETH_WITHDRAWAL_EVENT_TOPIC =
  '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65' as const;
export const EVM_PUBLIC_TESTNET_INTENT_MARKER_DOMAIN =
  'crypto-lending:base-sepolia-aave-v3-proof:v1:' as const;
export const EVM_PUBLIC_TESTNET_WITHDRAWAL_INTENT_MARKER_DOMAIN =
  'crypto-lending:base-sepolia-aave-v3-full-withdrawal:v1:' as const;

export const EVM_PUBLIC_TESTNET_INTENT_TTL_MILLISECONDS = 5 * 60 * 1_000;
// Base finality normally exceeds the short wallet-authorization window. Keep
// successful evidence for an hour, then prune it; unresolved sends never age
// out merely because this deadline passes.
export const EVM_PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS = 60 * 60 * 1_000;
export const EVM_PUBLIC_TESTNET_MAX_INTENTS = 256;
export const EVM_PUBLIC_TESTNET_MAX_ACTIVE_INTENTS_PER_ACCOUNT = 8;
export const EVM_PUBLIC_TESTNET_MAX_LOG_BLOCK_RANGE = 2_048n;
export const EVM_PUBLIC_TESTNET_MAX_LOG_CANDIDATES = 16;

export function evmPublicTestnetIntentMarker(intentId: string): Hex {
  return keccak256(stringToHex(`${EVM_PUBLIC_TESTNET_INTENT_MARKER_DOMAIN}${intentId}`));
}

export function evmPublicTestnetWithdrawalIntentMarker(
  step: 'APPROVE_AWETH' | 'WITHDRAW_FULL_ETH',
  intentId: string,
): Hex {
  return keccak256(
    stringToHex(`${EVM_PUBLIC_TESTNET_WITHDRAWAL_INTENT_MARKER_DOMAIN}${step}:${intentId}`),
  );
}

export function evmPublicTestnetAddressTopic(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
}

export function evmPublicTestnetUintTopic(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, '0')}`;
}
