import type { Hex } from 'viem';
import {
  ETHEREUM,
  SOLANA,
  MAX_U64,
  assertSourceBridgePlan,
  type SourceNetwork,
  type SourceBridgePlan,
} from './source-plan.ts';
import { bindCctpMintMessage, type BoundCctpMessage, type CctpDeployment } from './cctp-mint.ts';

const origin = 'https://iris-api.circle.com';
const maxResponseBytes = 64 * 1024;
const domain = (network: SourceNetwork) => {
  if (network !== ETHEREUM && network !== SOLANA) throw new Error('UNSUPPORTED_CCTP_NETWORK');
  return network === ETHEREUM ? 0 : 5;
};

async function getJson(
  path: string,
  fetcher: typeof fetch,
  allowMissing = false,
): Promise<unknown> {
  const response = await fetcher(`${origin}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  if (allowMissing && response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('CIRCLE_API_UNAVAILABLE');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > maxResponseBytes) throw new Error('CIRCLE_RESPONSE_TOO_LARGE');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** Current Circle Standard Transfer fee, rounded UP in USDC atomic units. The platform fee is separate. */
export async function getCircleStandardFee(input: {
  sourceNetwork: SourceNetwork;
  principal: bigint;
  fetcher?: typeof fetch;
}): Promise<bigint> {
  const sourceDomain = domain(input.sourceNetwork);
  if (input.principal <= 0n || input.principal > MAX_U64) throw new Error('INVALID_PRINCIPAL');
  const data = await getJson(
    `/v2/burn/USDC/fees/${sourceDomain}/${sourceDomain === 0 ? 5 : 0}`,
    input.fetcher ?? fetch,
  );
  if (!Array.isArray(data) || data.length > 8) throw new Error('INVALID_CIRCLE_FEES');
  const rows = data.filter((row) => row && row.finalityThreshold === 2000);
  if (
    rows.length !== 1 ||
    typeof rows[0].minimumFee !== 'number' ||
    !Number.isFinite(rows[0].minimumFee)
  ) {
    throw new Error('INVALID_CIRCLE_FEES');
  }
  const rate = String(rows[0].minimumFee);
  if (!/^(?:0|[1-9][0-9]{0,3})(?:\.[0-9]{1,6})?$/u.test(rate))
    throw new Error('INVALID_CIRCLE_FEES');
  const [whole, fraction = ''] = rate.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const scaledBps = BigInt(whole!) * scale + BigInt(fraction || '0');
  const denominator = 10_000n * scale;
  return (input.principal * scaledBps + denominator - 1n) / denominator;
}

/** One bounded poll, after the host verifies source finality and fee payment. Never retries the source burn. */
export async function pollCircleAttestation(input: {
  plan: SourceBridgePlan;
  deployment: CctpDeployment;
  sourceTransactionId: string;
  fetcher?: typeof fetch;
}): Promise<{ status: 'PENDING' } | { status: 'READY'; bound: BoundCctpMessage }> {
  assertSourceBridgePlan(input.plan);
  const sourceDomain = domain(input.plan.sourceNetwork);
  const transactionPattern =
    sourceDomain === 0 ? /^0x[0-9a-f]{64}$/iu : /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u;
  if (!transactionPattern.test(input.sourceTransactionId))
    throw new Error('INVALID_SOURCE_TRANSACTION_ID');
  const data = await getJson(
    `/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(input.sourceTransactionId)}`,
    input.fetcher ?? fetch,
    true,
  );
  if (data === null) return { status: 'PENDING' };
  if (
    typeof data !== 'object' ||
    !('messages' in data) ||
    !Array.isArray(data.messages) ||
    data.messages.length > 32
  ) {
    throw new Error('INVALID_CIRCLE_MESSAGES');
  }
  // The authenticated on-chain message and source receipt are authoritative. The API's decodedMessage is ignored.
  const matches: BoundCctpMessage[] = [];
  let pending = false;
  for (const entry of data.messages as unknown[]) {
    if (!entry || typeof entry !== 'object' || !('status' in entry))
      throw new Error('INVALID_CIRCLE_MESSAGES');
    if (entry.status === 'pending' || entry.status === 'pending_confirmations') {
      pending = true;
      continue;
    }
    if (
      entry.status !== 'complete' ||
      !('cctpVersion' in entry) ||
      entry.cctpVersion !== 2 ||
      !('message' in entry) ||
      !('attestation' in entry)
    )
      throw new Error('INVALID_CIRCLE_MESSAGES');
    try {
      matches.push(
        bindCctpMintMessage({
          ...input,
          message: entry.message as Hex,
          attestation: entry.attestation as Hex,
        }),
      );
    } catch {
      /* A source transaction can contain messages for other intents; admit only the exact bound intent. */
    }
  }
  if (matches.length > 1) throw new Error('AMBIGUOUS_CCTP_MESSAGES');
  if (matches.length === 1) return { status: 'READY', bound: matches[0]! };
  if (pending || data.messages.length === 0) return { status: 'PENDING' };
  throw new Error('CCTP_INTENT_MESSAGE_NOT_FOUND');
}
