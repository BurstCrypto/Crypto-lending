/** Public fee recipients used by the shared production and local mainnet workspace. */
export const MAINNET_TREASURIES = Object.freeze({
  ethereumTreasury: '0x4c3144f8613a021e926e9a43a7f8e46683c01931',
  solanaTreasury: '5RnhqcVwTLiJSpCkdipni2euX2PXxFnVNNYpfoN347XK',
});

// Solana's public api.mainnet-beta endpoint rejects browser Origin requests.
// Keep the browser transport and its narrowly scoped CSP exception in sync.
export const SOLANA_BROWSER_RPC_URL = 'https://solana-rpc.publicnode.com';
