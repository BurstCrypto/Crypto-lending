import { randomBytes, randomUUID } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import { getAddress, verifyMessage, type Hex } from 'viem';
import type { BridgeJournal } from './bridge-journal.server';
import { BRIDGE_ETHEREUM, BRIDGE_SOLANA } from './bridge-types';
import { verifySolanaSignature } from './bridge-solana.server';
import { fail } from './policy';
import { walletSignInMessage, type WalletSignInChallenge, type WalletSignInInput } from './wallet-sign-in';

export function walletSignInChallenge(journal: BridgeJournal, network: unknown, origin: string): WalletSignInChallenge {
  if (network !== BRIDGE_ETHEREUM && network !== BRIDGE_SOLANA) return fail('Choose Ethereum or Solana to sign in.');
  const now = Date.now(), expires = now + 180_000, id = randomUUID();
  const input: WalletSignInInput = { domain: new URL(origin).host, uri: `${origin}/portfolio`, version: '1',
    statement: 'Sign in to Bonsai Lending. This does not move funds or approve spending.',
    chainId: network === BRIDGE_ETHEREUM ? '1' : 'solana:mainnet', nonce: randomBytes(24).toString('hex'),
    issuedAt: new Date(now).toISOString(), expirationTime: new Date(expires).toISOString() };
  journal.db.prepare('DELETE FROM challenges WHERE expires<=?').run(now);
  journal.db.prepare('INSERT INTO challenges VALUES (?,?,?,?)').run(id, `wallet-sign-in:${network}`, JSON.stringify(input), expires);
  return { id, input };
}

export async function verifyWalletSignIn(journal: BridgeJournal, id: string, wallet: unknown, message: unknown, signature: unknown, origin: string) {
  const challenge = journal.readChallenge(id);
  if (!challenge || !challenge.wallet.startsWith('wallet-sign-in:')) return fail('This wallet sign-in expired. Click Connect wallet again.');
  const input = JSON.parse(challenge.message) as WalletSignInInput;
  if (input.domain !== new URL(origin).host || input.uri !== `${origin}/portfolio` || typeof wallet !== 'string' ||
    typeof message !== 'string' || message.length > 4096 || typeof signature !== 'string' || signature.length > 256) return fail('The wallet sign-in response is invalid.');
  let valid = false;
  try {
    const address = input.chainId === '1' ? getAddress(wallet) : new PublicKey(wallet).toBase58();
    const bytes = Buffer.from(message, 'base64');
    if (bytes.toString('base64') !== message || bytes.toString('utf8') !== walletSignInMessage(input, address)) return fail('The wallet signed a different sign-in message.');
    valid = input.chainId === '1'
      ? /^0x[0-9a-fA-F]{130}$/.test(signature) && await verifyMessage({ address: address as Hex, message: bytes.toString('utf8'), signature: signature as Hex })
      : verifySolanaSignature(address, bytes, Buffer.from(signature, 'base64'));
  } catch { return fail('The wallet sign-in signature could not be verified.'); }
  if (!valid) return fail('The wallet sign-in signature could not be verified.');
  const consumed = journal.db.prepare('DELETE FROM challenges WHERE id=? AND expires>?').run(id, Date.now());
  if (consumed.changes !== 1) return fail('This wallet sign-in expired or was already used. Connect again.');
  return { verified: true, wallet };
}
