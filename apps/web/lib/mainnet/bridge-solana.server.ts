import { createHash, createPublicKey, verify } from 'node:crypto';
import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, PublicKey, TransactionMessage, VersionedTransaction, type AccountInfo } from '@solana/web3.js';
import type { Hex } from 'viem';

import { CCTP_MESSAGE_TRANSMITTER, CCTP_TOKEN_MESSENGER } from '../../../../onchain/src/solana-source';
import { SOLANA_USDC, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, associatedUsdcAccount } from '../../../../onchain/src/source-plan';
import type { SourceBridgePlan } from '../../../../onchain/src/source-plan';
import { KAMINO_PROGRAM, KAMINO_MARKET, KAMINO_USDC_RESERVE, KAMINO_COLLATERAL_MINT, KAMINO_LIQUIDITY_VAULT, kaminoUsdcSupplyInstructions } from '../../../../onchain/src/destination-lending';
import { fail } from './policy';
import { corroborateKaminoValue, kaminoPositionValue } from './kamino-position.server';
import type { BridgeConfig, BridgeStep } from './bridge-types';
export { solanaAddress } from './solana-address';

export const SOLANA_RPC_URLS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'] as const;
export const SOLANA_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const METHODS = new Set(['getGenesisHash', 'getSlot', 'getBlockTime', 'getBlockHeight', 'getEpochInfo', 'getAccountInfo', 'getMultipleAccounts',
  'getLatestBlockhash', 'isBlockhashValid', 'getFeeForMessage', 'getMinimumBalanceForRentExemption',
  'getSignatureStatuses', 'getSignaturesForAddress', 'getTransaction', 'simulateTransaction', 'getTokenSupply', 'getTokenAccountBalance']);
const PROGRAM_PINS = [
  [CCTP_MESSAGE_TRANSMITTER, '2w2zCf9f5iyr7qcuWQH4DFNNahBZHgYkL4UVU3p5T1iS', 343321624n],
  [CCTP_TOKEN_MESSENGER, '9ZEnLvCp3weopBnSaoSSjn7hoVk6zMXMpfH3LjNzBFFF', 343322709n],
  [KAMINO_PROGRAM, '9uSbGW1y9H5Av6H5TKxQ1wnFApSq2t3oEpfF2YfjDQGA', 440486775n],
] as const;
export const solanaPda = (program: PublicKey, ...seeds: (string | Buffer)[]) => PublicKey.findProgramAddressSync(seeds.map((seed) => typeof seed === 'string' ? Buffer.from(seed) : seed), program)[0];
export const collateralAccount = (wallet: PublicKey) => PublicKey.findProgramAddressSync(
  [wallet.toBuffer(), TOKEN_PROGRAM.toBuffer(), KAMINO_COLLATERAL_MINT.toBuffer()], ASSOCIATED_TOKEN_PROGRAM)[0];
export function signatureBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n, encoded = '';
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  while (value > 0n) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; encoded = '1' + encoded; }
  return encoded;
}
export function verifySolanaSignature(wallet: string, message: Uint8Array, signature: Uint8Array) {
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), new PublicKey(wallet).toBuffer()]), format: 'der', type: 'spki' });
  return signature.length === 64 && verify(null, message, key, signature);
}
function checkedAccount(account: AccountInfo<Buffer> | null, owner: string, minimum: number) {
  if (!account || account.owner.toBase58() !== owner || account.data.length < minimum || account.executable) return fail('A required Solana account has an unexpected owner or layout.');
  return account.data;
}
function tokenBalance(account: AccountInfo<Buffer> | null, wallet: PublicKey, mint: PublicKey): bigint {
  if (!account) return 0n;
  const d = checkedAccount(account, TOKEN_PROGRAM.toBase58(), 165);
  if (d.length !== 165 || !new PublicKey(d.subarray(0, 32)).equals(mint) || !new PublicKey(d.subarray(32, 64)).equals(wallet) || d[108] !== 1 ||
    d.readUInt32LE(72) !== 0 || d.readUInt32LE(129) !== 0) return fail('Use initialized, unfrozen Solana token accounts without delegates or a separate close authority.');
  return d.readBigUInt64LE(64);
}

const readSchedule = new Map<string, number>();
async function scheduleRead(endpoint: string) {
  const now = Date.now(), start = Math.max(now, readSchedule.get(endpoint) ?? now);
  readSchedule.set(endpoint, start + 180);
  if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
}
const readBoundedRpc: typeof fetch = async (input, init) => {
  const body = JSON.parse(String(init?.body)) as { method: string };
  if (!METHODS.has(body.method)) return fail('The local server cannot broadcast Solana transactions.');
  // Shared pacing avoids bursts when four Solana providers read at once. Only
  // read/simulate methods reach this transport; it cannot send transactions.
  await scheduleRead(String(input));
  let response = await fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(12_000) });
  if (response.status === 429) {
    await response.body?.cancel();
    const seconds = Number(response.headers.get('retry-after') ?? '2');
    await new Promise((resolve) => setTimeout(resolve, Math.min(5000, Math.max(2000, Number.isFinite(seconds) ? seconds * 1000 : 2000))));
    await scheduleRead(String(input));
    response = await fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(12_000) });
  }
  if (!response.ok || !response.body) return fail(`Solana ${body.method} is unavailable (HTTP ${response.status}). Retry the read when the endpoint recovers.`);
  const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 2 * 1024 * 1024) return fail('Solana response exceeded the byte limit.'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => undefined); }
  return new Response(Buffer.concat(chunks), { status: response.status, headers: { 'Content-Type': 'application/json' } });
};
const pendingReads = new Map<string, Promise<Record<string, unknown>>>();
const boundedFetch: typeof fetch = async (input, init) => {
  const request = JSON.parse(String(init?.body)) as { id: string | number; method: string; params: unknown[] };
  if (!METHODS.has(request.method)) return fail('The local server cannot broadcast Solana transactions.');
  // Providers often ask for the same chain head or account at the same time.
  // Share only identical in-flight reads on the same endpoint; retain neither
  // completed results nor cross-provider evidence. Each caller keeps its RPC id.
  const key = JSON.stringify([String(input), request.method, request.params]);
  let promise = pendingReads.get(key);
  if (!promise) {
    promise = readBoundedRpc(input, init).then(async (response) => {
      const value = await response.json() as Record<string, unknown>;
      if (!value || value.jsonrpc !== '2.0' || value.id !== request.id) return fail('Invalid Solana RPC response identity.');
      return value;
    });
    pendingReads.set(key, promise);
  }
  try { return Response.json({ ...await promise, id: request.id }); }
  finally { if (pendingReads.get(key) === promise) pendingReads.delete(key); }
};

export class BridgeSolana {
  readonly connections: readonly [Connection, Connection];
  constructor(connections?: readonly [Connection, Connection]) {
    this.connections = connections ?? [
      new Connection(SOLANA_RPC_URLS[0], { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: boundedFetch }),
      new Connection(SOLANA_RPC_URLS[1], { commitment: 'finalized', disableRetryOnRateLimit: true, fetch: boundedFetch }),
    ];
  }
  async chain() {
    const values = await Promise.all(this.connections.map(async (c) => {
      if (await c.getGenesisHash() !== SOLANA_GENESIS) return fail('Both Solana endpoints must report the full mainnet genesis hash.');
      const slot = await c.getSlot('finalized'), timestamp = await c.getBlockTime(slot);
      if (!timestamp || Date.now() - timestamp * 1000 > 120_000 || timestamp * 1000 > Date.now() + 15_000) return fail('Solana finalized data is stale.');
      return slot;
    }));
    if (Math.abs(values[0]! - values[1]!) > 128) return fail('The Solana finalized sources disagree.');
    return Math.min(...values);
  }
  async accounts(keys: PublicKey[], minimumSlot: number) {
    const responses = await Promise.all(this.connections.map(async (c) => {
      // PublicNode blocks large account lists. Keep the same finalized slot floor for every small batch.
      const batches = [];
      for (let offset = 0; offset < keys.length; offset += 3) {
        const batch = await c.getMultipleAccountsInfoAndContext(keys.slice(offset, offset + 3), { commitment: 'finalized', minContextSlot: minimumSlot });
        if (batch.context.slot < minimumSlot || batch.context.slot > minimumSlot + 128) return fail('Solana account data is outside the admitted slot window.');
        batches.push(batch);
      }
      return { context: { slot: Math.max(...batches.map((b) => b.context.slot)) }, value: batches.flatMap((b) => b.value) };
    }));
    if (responses.some((r) => r.context.slot < minimumSlot || r.context.slot > minimumSlot + 128)) return fail('Solana account data is outside the admitted slot window.');
    return responses;
  }
  async inspect(config: Pick<BridgeConfig, 'solanaWallet' | 'solanaTreasury'>) {
    const slot = await this.chain(), wallet = new PublicKey(config.solanaWallet), treasury = new PublicKey(config.solanaTreasury);
    const keys = [
      ...PROGRAM_PINS.map(([p]) => p),
      solanaPda(CCTP_TOKEN_MESSENGER, 'token_messenger'), solanaPda(CCTP_MESSAGE_TRANSMITTER, 'message_transmitter'),
      KAMINO_USDC_RESERVE, KAMINO_MARKET, SOLANA_USDC, KAMINO_COLLATERAL_MINT,
      associatedUsdcAccount(wallet), wallet, associatedUsdcAccount(treasury), collateralAccount(wallet), KAMINO_LIQUIDITY_VAULT,
    ];
    const responses = await this.accounts(keys, slot);
    const summaries = responses.map(({ value }) => {
      for (const [i, [, programData]] of PROGRAM_PINS.entries()) {
        const a = value[i];
        if (!a?.executable || a.owner.toBase58() !== LOADER || a.data.length !== 36 || a.data.readUInt32LE(0) !== 2 ||
          new PublicKey(a.data.subarray(4, 36)).toBase58() !== programData) return fail('A pinned Solana program changed.');
      }
      const tm = checkedAccount(value[3]!, CCTP_TOKEN_MESSENGER.toBase58(), 177);
      if (!tm.subarray(0, 8).equals(createHash('sha256').update('account:TokenMessenger').digest().subarray(0, 8)) || tm.readUInt32LE(104) !== 1) return fail('Invalid Circle TokenMessenger state.');
      const transmitter = checkedAccount(value[4]!, CCTP_MESSAGE_TRANSMITTER.toBase58(), 149);
      if (!transmitter.subarray(0, 8).equals(createHash('sha256').update('account:MessageTransmitter').digest().subarray(0, 8)) ||
        transmitter[136] !== 0 || transmitter.readUInt32LE(137) !== 5 || transmitter.readUInt32LE(141) !== 1) return fail('Circle Solana is paused or its chain/version changed.');
      const reserve = checkedAccount(value[5]!, KAMINO_PROGRAM.toBase58(), 8624);
      const market = checkedAccount(value[6]!, KAMINO_PROGRAM.toBase58(), 4664);
      if (reserve.length !== 8624 || market.length !== 4664 || reserve.readBigUInt64LE(8) !== 1n || market.readBigUInt64LE(8) !== 1n ||
        !reserve.subarray(0, 8).equals(createHash('sha256').update('account:Reserve').digest().subarray(0, 8)) ||
        !new PublicKey(reserve.subarray(32, 64)).equals(KAMINO_MARKET) || !new PublicKey(reserve.subarray(128, 160)).equals(SOLANA_USDC) ||
        !new PublicKey(reserve.subarray(160, 192)).equals(KAMINO_LIQUIDITY_VAULT) || reserve.readBigUInt64LE(272) !== 6n ||
        !new PublicKey(reserve.subarray(2560, 2592)).equals(KAMINO_COLLATERAL_MINT)) return fail('The Kamino reserve deployment changed.');
      const mint = checkedAccount(value[7]!, TOKEN_PROGRAM.toBase58(), 82);
      if (mint.length !== 82 || mint[44] !== 6 || mint[45] !== 1) return fail('Invalid Solana USDC mint.');
      const collateralMint = checkedAccount(value[8]!, TOKEN_PROGRAM.toBase58(), 82);
      if (collateralMint.length !== 82 || collateralMint[44] !== 6 || collateralMint[45] !== 1) return fail('Invalid Kamino USDC receipt-token mint.');
      const native = value[10];
      if (native && (native.owner.toBase58() !== '11111111111111111111111111111111' || native.data.length !== 0 || native.executable)) return fail('Use an ordinary Solana wallet account.');
      const usdc = tokenBalance(value[9]!, wallet, SOLANA_USDC), collateral = tokenBalance(value[12]!, wallet, KAMINO_COLLATERAL_MINT);
      tokenBalance(value[11]!, treasury, SOLANA_USDC);
      return { usdc: usdc.toString(), collateral: collateral.toString(), lamports: String(native?.lamports ?? 0),
        circleFeeRecipient: new PublicKey(tm.subarray(109, 141)).toBase58(), minimumFeeBps: tm.readUInt32LE(173) };
    });
    if (JSON.stringify(summaries[0]) !== JSON.stringify(summaries[1])) return fail('Solana balances or Circle fee settings disagree.');
    await Promise.all(this.connections.flatMap((c) => PROGRAM_PINS.map(async ([, dataAddress, upgradeSlot]) => {
        const result = await c.getAccountInfo(new PublicKey(dataAddress), { commitment: 'finalized', minContextSlot: slot, dataSlice: { offset: 0, length: 45 } });
        const data = checkedAccount(result, LOADER, 45);
        if (data.readUInt32LE(0) !== 3 || data.readBigUInt64LE(4) !== upgradeSlot) return fail('A Solana program was upgraded. Review its deployment before continuing.');
    })));
    const valuations = responses.map(({ value }) => kaminoPositionValue(value[5]!.data, BigInt(summaries[0]!.collateral)));
    return { ...summaries[0]!, slot, ...corroborateKaminoValue(valuations[0]!, valuations[1]!) };
  }
  async routingFeeAccount(treasuryAddress: string, slot: number) {
    const treasury = new PublicKey(treasuryAddress);
    const results = await Promise.all(this.connections.map(async (connection) => {
      const account = await connection.getAccountInfo(associatedUsdcAccount(treasury), { commitment: 'finalized', minContextSlot: slot });
      return { balance: tokenBalance(account, treasury, SOLANA_USDC), rent: account ? 0n : BigInt(await connection.getMinimumBalanceForRentExemption(165, 'finalized')) };
    }));
    if (results[0]!.balance !== results[1]!.balance || results[0]!.rent !== results[1]!.rent) return fail('The routing fee account checks disagree.');
    return results[0]!;
  }
  async lendingCost(walletAddress: string, action: 'supply' | 'withdraw', slot: number, serialized?: string) {
    const wallet = new PublicKey(walletAddress);
    const account = action === 'supply' ? collateralAccount(wallet) : associatedUsdcAccount(wallet);
    const mint = action === 'supply' ? KAMINO_COLLATERAL_MINT : SOLANA_USDC;
    // For rate comparisons, a one-signature deposit message has the same base fee
    // as the eventual direct deposit/withdrawal. The explicit zero price also
    // prevents Phantom from inserting a priority fee after the review.
    const message = serialized ? VersionedTransaction.deserialize(Buffer.from(serialized, 'base64')).message :
      new TransactionMessage({ payerKey: wallet, recentBlockhash: (await this.blockhash(slot)).blockhash,
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
          ...kaminoUsdcSupplyInstructions({ user: wallet, principal: 1n })] }).compileToV0Message();
    const costs = await Promise.all(this.connections.map(async (c) => {
      const [fee, existing, rent] = await Promise.all([
        c.getFeeForMessage(message, 'confirmed'), c.getAccountInfo(account, { commitment: 'finalized', minContextSlot: slot }),
        c.getMinimumBalanceForRentExemption(165, 'finalized'),
      ]);
      if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value < 0 || !Number.isSafeInteger(rent) || rent < 0) return fail('Solana transaction fees are unavailable.');
      if (existing) tokenBalance(existing, wallet, mint);
      return BigInt(fee.value) + (existing ? 0n : BigInt(rent));
    }));
    if (costs[0] !== costs[1] || costs[0]! > 20_000_000n) return fail('Solana fees or account rent changed. Refresh the review.');
    return costs[0]!;
  }
  async blockhash(slot: number) {
    // The newest finalized hash at a faster RPC may not exist yet at the other.
    // Choose the older finalized head, then still require both sources to validate it.
    const heads = await Promise.all(this.connections.map((c) => c.getLatestBlockhashAndContext({ commitment: 'finalized', minContextSlot: slot })));
    const shared = heads.reduce((older, current) => current.context.slot < older.context.slot ? current : older);
    const validity = await Promise.all(this.connections.map((c) => c.isBlockhashValid(shared.value.blockhash, { commitment: 'finalized', minContextSlot: shared.context.slot })));
    if (validity.some((result) => !result.value)) return fail('The Solana blockhash is not valid on both sources.');
    return { ...shared.value, contextSlot: shared.context.slot };
  }
  async tables(addresses: string[], slot: number): Promise<AddressLookupTableAccount[]> {
    const tables: AddressLookupTableAccount[] = [];
    for (const key of addresses) {
      const values = await Promise.all(this.connections.map((c) => c.getAddressLookupTable(new PublicKey(key), { commitment: 'finalized', minContextSlot: slot })));
      const left = values[0]!.value, right = values[1]!.value;
      if (!left || !right || !left.isActive() || !right.isActive() || left.state.lastExtendedSlot >= slot || right.state.lastExtendedSlot >= slot ||
        JSON.stringify(left.state.addresses.map(String)) !== JSON.stringify(right.state.addresses.map(String))) return fail('The lookup table is missing, inactive, recently extended, or inconsistent.');
      tables.push(left);
    }
    return tables;
  }
  async simulate(serialized: string, lastValidBlockHeight: number, slot: number, previewWallet?: string, fee?: { treasury: string; balance: bigint; amount: bigint }) {
    const bytes = Buffer.from(serialized, 'base64');
    if (bytes.length > 1232) return fail('A Solana lookup table is required for this transaction.');
    const tx = VersionedTransaction.deserialize(bytes);
    const wallet = previewWallet ? new PublicKey(previewWallet) : null;
    const projected: { usdc: string; collateral: string }[] = [];
    for (const c of this.connections) {
      // Read height together with its slot. PublicNode's confirmed getBlockHeight
      // currently returns a slot; slots cannot be compared with a block-height expiry.
      const epoch = await c.getEpochInfo({ commitment: 'confirmed', minContextSlot: slot });
      if (!Number.isSafeInteger(epoch.blockHeight) || epoch.blockHeight! < 0 || epoch.absoluteSlot < slot) return fail('The Solana block height is unavailable or stale.');
      if (epoch.blockHeight! >= lastValidBlockHeight - 8) return fail('The Solana transaction is expiring. Prepare a fresh review.');
      const result = await c.simulateTransaction(tx, { commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: false, minContextSlot: slot,
        ...(wallet ? { accounts: { encoding: 'base64', addresses: [associatedUsdcAccount(wallet).toBase58(), collateralAccount(wallet).toBase58(), ...(fee ? [associatedUsdcAccount(new PublicKey(fee.treasury)).toBase58()] : [])] } } : {}) });
      if (result.value.err !== null || (result.value.unitsConsumed ?? 1_400_001) > 1_400_000) return fail('The Solana transaction simulation failed. Refresh balances and review again.');
      if (wallet) {
        if (result.value.accounts?.length !== (fee ? 3 : 2)) return fail('The simulated lending account balances are unavailable.');
        const amounts = result.value.accounts.map((account, index) => {
          if (!account) return 0n;
          if (account.data[1] !== 'base64' || typeof account.data[0] !== 'string') return fail('Invalid simulated token account encoding.');
          return tokenBalance({ ...account, owner: new PublicKey(account.owner), data: Buffer.from(account.data[0], 'base64') }, index === 2 ? new PublicKey(fee!.treasury) : wallet, index === 1 ? KAMINO_COLLATERAL_MINT : SOLANA_USDC);
        });
        if (fee && amounts[2]! - fee.balance !== fee.amount) return fail('The simulated routing fee did not reach the treasury.');
        projected.push({ usdc: amounts[0]!.toString(), collateral: amounts[1]!.toString() });
      }
    }
    if (wallet && JSON.stringify(projected[0]) !== JSON.stringify(projected[1])) return fail('The simulated lending balances disagree. Refresh before preparing a transaction.');
    return projected[0];
  }
  verifySigned(step: BridgeStep, serialized: string) {
    if (!step.solana || !/^[A-Za-z0-9+/]+={0,2}$/.test(serialized) || serialized.length > 1644) return fail('Invalid signed Solana transaction.');
    const bytes = Buffer.from(serialized, 'base64'), tx = VersionedTransaction.deserialize(bytes);
    if (bytes.toString('base64') !== serialized || bytes.length > 1232 ||
      tx.message.staticAccountKeys[0]?.toBase58() !== step.wallet || tx.signatures.length !== tx.message.header.numRequiredSignatures) return fail('The wallet changed the prepared Solana transaction.');
    if (Buffer.from(tx.message.serialize()).toString('base64') !== step.solana.message) {
      const original = VersionedTransaction.deserialize(Buffer.from(step.solana.serialized, 'base64'));
      const programs = (transaction: VersionedTransaction) => transaction.message.compiledInstructions.map((ix) => transaction.message.staticAccountKeys[ix.programIdIndex]?.toBase58());
      const before = programs(original), added = programs(tx).filter((program) => program && !before.includes(program));
      const compute = (transaction: VersionedTransaction) => transaction.message.compiledInstructions
        .filter((ix) => transaction.message.staticAccountKeys[ix.programIdIndex]?.equals(ComputeBudgetProgram.programId))
        .map((ix) => Buffer.from(ix.data).toString('hex')).join(',');
      // Keep the mismatch actionable without logging a signed payload or replacing
      // the saved review. Wallet protection instructions still need verification.
      const changes = [
        tx.version !== original.version ? 'transaction version' : '',
        tx.message.recentBlockhash !== original.message.recentBlockhash ? 'blockhash' : '',
        compute(tx) !== compute(original) ? 'network fee settings' : '',
        added.some((program) => ['L1TEVtgA75k273wWz1s6XMmDhQY5i3MwcvKb4VbZzfK', 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'].includes(program!)) ? 'wallet protection instructions' : '',
      ].filter(Boolean);
      return fail(`The wallet changed the prepared Solana transaction (${changes.join(', ') || 'instructions or accounts'}). This app did not send it.`);
    }
    for (const [index, signature] of tx.signatures.entries()) {
      if (!verifySolanaSignature(tx.message.staticAccountKeys[index]!.toBase58(), tx.message.serialize(), signature)) return fail('A required Solana signature is invalid.');
    }
    return { serialized, transactionId: signatureBase58(tx.signatures[0]!) };
  }
  async receipt(step: BridgeStep, signature: string) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature) || !step.solana) return fail('Invalid Solana transaction signature.');
    await this.chain();
    const values = await Promise.all(this.connections.map((c) => c.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 })));
    if (values.some((value) => !value)) return { state: 'SUBMITTED' as const, receipt: null };
    for (const value of values) {
      if (value!.transaction.signatures[0] !== signature || Buffer.from(value!.transaction.message.serialize()).toString('base64') !== step.solana.message ||
        value!.slot !== values[0]!.slot || JSON.stringify(value!.meta?.err) !== JSON.stringify(values[0]!.meta?.err) ||
        !value!.meta || !Number.isSafeInteger(value!.meta.fee) || BigInt(value!.meta.fee) > BigInt(step.maxNetworkCost) ||
        !Number.isSafeInteger(value!.meta.preBalances[0]) || !Number.isSafeInteger(value!.meta.postBalances[0]) ||
        BigInt(value!.meta.preBalances[0]!) - BigInt(value!.meta.postBalances[0]!) > BigInt(step.maxNetworkCost)) return fail('The finalized Solana transaction does not match the prepared message or cost limit.');
      const tokenView = (meta: NonNullable<typeof value>['meta']) => JSON.stringify([meta?.preTokenBalances, meta?.postTokenBalances]);
      if (tokenView(value!.meta) !== tokenView(values[0]!.meta)) return fail('The finalized Solana token balance evidence disagrees.');
    }
    return { state: values[0]!.meta!.err === null ? 'FINALIZED' as const : 'FAILED' as const, receipt: values[0]! };
  }
  async recoverExpiredWalletRequest(step: BridgeStep): Promise<string | null> {
    if (!step.solana || step.state !== 'RESERVED' || step.transactionId) return fail('This is not an unsigned wallet request.');
    await this.chain();
    const { contextSlot, lastValidBlockHeight } = step.solana;
    const heads = await Promise.all(this.connections.map((connection) => connection.getEpochInfo({ commitment: 'finalized', minContextSlot: contextSlot })));
    if (heads.some((head) => !Number.isSafeInteger(head.blockHeight) || head.blockHeight! <= lastValidBlockHeight || head.absoluteSlot < contextSlot)) return fail('The wallet request is still open. Approve or decline it in your wallet, or wait for it to expire.');
    const histories = await Promise.all(this.connections.map((connection) => connection.getSignaturesForAddress(new PublicKey(step.wallet), { limit: 1000, minContextSlot: contextSlot }, 'finalized')));
    if (histories.some((history) => history.length === 1000 && history.at(-1)!.slot >= contextSlot)) return fail('More wallet history is needed to recover this request. Keep the original review.');
    const relevant = histories.map((history) => history.filter((entry) => entry.slot >= contextSlot).map(({ signature, slot }) => ({ signature, slot })));
    if (JSON.stringify(relevant[0]) !== JSON.stringify(relevant[1])) return fail('The Solana sources disagree about wallet history. Check again shortly.');
    for (const entry of relevant[0]!) {
      const transactions = await Promise.all(this.connections.map((connection) => connection.getTransaction(entry.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 })));
      if (transactions.some((transaction) => !transaction)) return fail('A finalized wallet transaction is not available from both sources yet. Check again shortly.');
      const matches = transactions.map((transaction) => transaction!.transaction.signatures[0] === entry.signature && Buffer.from(transaction!.transaction.message.serialize()).toString('base64') === step.solana!.message);
      if (matches[0] !== matches[1]) return fail('The Solana sources disagree about this transaction.');
      if (matches[0]) return entry.signature;
    }
    return null;
  }
  async expiredSignedRequest(step: BridgeStep): Promise<boolean> {
    if (!step.solana || !step.transactionId || !['SIGNED', 'SUBMITTED'].includes(step.state)) return false;
    await this.chain();
    const heads = await Promise.all(this.connections.map((c) => c.getEpochInfo({ commitment: 'finalized', minContextSlot: step.solana!.contextSlot })));
    if (heads.some((head) => !Number.isSafeInteger(head.blockHeight) || head.blockHeight! <= step.solana!.lastValidBlockHeight || head.absoluteSlot < step.solana!.contextSlot)) return false;
    const evidence = await Promise.all(this.connections.map(async (c, index) => {
      const [statuses, transaction] = await Promise.all([
        c.getSignatureStatuses([step.transactionId!], { searchTransactionHistory: true }),
        c.getTransaction(step.transactionId!, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }),
      ]);
      return statuses.context.slot >= heads[index]!.absoluteSlot && statuses.value.length === 1 && statuses.value[0] === null && transaction === null;
    }));
    // A signed request can be closed only after its original blockhash has
    // expired on both finalized chains and neither source has the signature.
    return evidence.every(Boolean);
  }
  async emittedMessage(step: BridgeStep): Promise<Hex> {
    const event = new PublicKey(step.evidence.eventAccount!);
    const slot = await this.chain(), responses = await this.accounts([event], slot);
    const messages = responses.map(({ value }) => {
      const data = checkedAccount(value[0]!, CCTP_MESSAGE_TRANSMITTER.toBase58(), 464);
      if (!data.subarray(0, 8).equals(createHash('sha256').update('account:MessageSent').digest().subarray(0, 8)) ||
        !new PublicKey(data.subarray(8, 40)).equals(new PublicKey(step.wallet)) || data.readUInt32LE(48) !== 412 || data.length !== 464) return fail('The Circle source event account does not match this wallet and message.');
      return `0x${data.subarray(52).toString('hex')}` as Hex;
    });
    if (messages[0] !== messages[1]) return fail('The Solana sources disagree on the Circle burn message.');
    return messages[0]!;
  }
  async minted(nonce: Hex): Promise<boolean> {
    const key = solanaPda(CCTP_MESSAGE_TRANSMITTER, 'used_nonce', Buffer.from(nonce.slice(2), 'hex'));
    const values = await this.accounts([key], await this.chain());
    const used = values.map(({ value }) => {
      if (!value[0]) return false;
      const data = checkedAccount(value[0], CCTP_MESSAGE_TRANSMITTER.toBase58(), 9);
      if (data.length !== 9 || !data.subarray(0, 8).equals(createHash('sha256').update('account:UsedNonce').digest().subarray(0, 8)) || data[8] !== 1) return fail('Invalid Circle used-nonce state.');
      return true;
    });
    if (used[0] !== used[1]) return fail('The Solana sources disagree on destination mint completion.');
    return used[0]!;
  }
  tokenChange(meta: unknown, wallet: string, mint: string): bigint {
    if (!meta || typeof meta !== 'object') return fail('Solana token balance evidence is missing.');
    const r = meta as Record<string, unknown>;
    const sum = (rows: unknown) => {
      if (!Array.isArray(rows)) return fail('Solana token balance evidence is missing.');
      let total = 0n;
      for (const entry of rows as { owner?: string; mint: string; uiTokenAmount: { amount: string } }[]) {
        if (entry.owner !== wallet || entry.mint !== mint) continue;
        if (!/^(?:0|[1-9][0-9]{0,19})$/.test(entry.uiTokenAmount.amount)) return fail('Invalid Solana token amount.');
        total += BigInt(entry.uiTokenAmount.amount);
      }
      return total;
    };
    return sum(r.postTokenBalances) - sum(r.preTokenBalances);
  }
  verifySourceBalances(meta: unknown, plan: SourceBridgePlan) {
    if (this.tokenChange(meta, plan.sourceWallet, SOLANA_USDC.toBase58()) !== -plan.totalSourceDebit ||
      this.tokenChange(meta, plan.treasury, SOLANA_USDC.toBase58()) !== plan.platformFee) return fail('The finalized Solana source debit and treasury fee do not match the bridge intent.');
  }
}
