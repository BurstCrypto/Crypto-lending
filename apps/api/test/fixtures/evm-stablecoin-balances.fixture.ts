export const EVM_STABLECOIN_BALANCE_FIXTURE = Object.freeze({
  evidenceKind: 'DETERMINISTIC_NORMALIZED_ADAPTER_FIXTURE',
  liveEvidence: 'NOT_RUN_PENDING_AUTHORIZATION',
  environment: 'MAINNET',
  networkId: 'eip155:1',
  chainIdentity: '0x1',
  walletAddress: '0x1111111111111111111111111111111111111111',
  sourceBlock: Object.freeze({
    number: '20765432',
    hash: `0x${'ab'.repeat(32)}`,
    parentHash: `0x${'cd'.repeat(32)}`,
  }),
  recordedBalances: Object.freeze([
    Object.freeze({
      stablecoin: 'PYUSD',
      contractAddress: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
      balanceAtomic: '987654321',
    }),
    Object.freeze({
      stablecoin: 'USDC',
      contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      balanceAtomic: '1234567890123456',
    }),
    Object.freeze({
      stablecoin: 'USDT',
      contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      balanceAtomic: '0',
    }),
  ]),
} as const);
