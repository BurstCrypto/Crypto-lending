export interface WalletSignInInput {
  domain: string;
  uri: string;
  statement: string;
  version: '1';
  chainId: '1' | 'solana:mainnet';
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}
export interface WalletSignInChallenge { id: string; input: WalletSignInInput }

/** The SIWE / SIWS message for the fields requested by this application. */
export function walletSignInMessage(input: WalletSignInInput, address: string) {
  return `${input.domain} wants you to sign in with your ${input.chainId === '1' ? 'Ethereum' : 'Solana'} account:\n${address}\n\n${input.statement}\n\nURI: ${input.uri}\nVersion: ${input.version}\nChain ID: ${input.chainId}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expirationTime}`;
}
