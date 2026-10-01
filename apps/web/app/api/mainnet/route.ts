import { mainnetAccess, MainnetAccessError } from '@/lib/mainnet/access.server';
import { MainnetTestError, fail } from '@/lib/mainnet/policy';
import { BRIDGE_ETHEREUM, BRIDGE_SOLANA, hasBothWallets, isDirectLendingStep, type LocalWalletConfig } from '@/lib/mainnet/bridge-types';
import { parseLocalWalletConfig } from '@/lib/mainnet/wallet-config';
import { MAINNET_TREASURIES } from '@/lib/mainnet/public-config';
import { walletSignInChallenge, verifyWalletSignIn } from '@/lib/mainnet/wallet-sign-in.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}
function errorResponse(error: unknown) {
  return json({ error: error instanceof MainnetAccessError || error instanceof MainnetTestError ? error.message : 'The mainnet check could not complete. Refresh to recover the original transaction.' }, error instanceof MainnetAccessError ? error.status : 400);
}
async function input(request: Request) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') || request.headers.has('content-encoding')) return fail('Send a small JSON request.');
  const reader = request.body?.getReader();
  if (!reader) return fail('A request body is required.');
  let size = 0; const chunks: Uint8Array[] = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8192) return fail('Request too large.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => undefined); }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Invalid request.');
  return body as Record<string, unknown>;
}
function exact(body: Record<string, unknown>, fields: string[]) {
  if (Object.keys(body).sort().join(',') !== ['operation', ...fields].sort().join(',')) return fail('Unexpected request fields.');
}
function id(value: unknown) {
  if (typeof value !== 'string' || !/^(?:0x[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.test(value)) return fail('Invalid identifier.');
  return value;
}
async function context(request: Request, mutation: boolean) {
  const access = await mainnetAccess(request, mutation);
  const service = access.kind === 'local' ? (await import('@/lib/local-mainnet/runtime.server')).localMainnetService()
    : (await import('@/lib/mainnet/runtime.server')).accountMainnetService(access.accountId);
  return { service, local: access.kind === 'local' };
}
export async function GET(request: Request) {
  try {
    const { service, local } = await context(request, false);
    let config: LocalWalletConfig;
    try { config = service.configuration.read(); }
    catch (error) { return json({ configured: false, config: null, authenticated: !local, localAccess: local, paused: service.journal.paused(), bridges: [], steps: [], lendingSteps: [], setupError: error instanceof MainnetTestError ? error.message : 'Connect your wallet.' }); }
    return json({ configured: true, config, authenticated: !local, localAccess: local, setupError: null, paused: service.journal.paused(), bridges: service.journal.bridges(),
      steps: service.journal.steps().filter((step) => !isDirectLendingStep(step)),
      lendingSteps: service.journal.steps().filter((step) => isDirectLendingStep(step) && (step.wallet === config.ethereumWallet || step.wallet === config.solanaWallet)) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const { service, local } = await context(request, true);
    const body = await input(request), journal = service.journal;
    const origin = request.headers.get('origin') ?? new URL(request.url).origin;
    if (body.operation === 'wallet-connection-error') {
      exact(body, ['network', 'stage', 'code', 'elapsedMs']);
      if (!local || (body.network !== BRIDGE_ETHEREUM && body.network !== BRIDGE_SOLANA) ||
        typeof body.stage !== 'string' || !['connect', 'network'].includes(body.stage) ||
        !(body.code === null || typeof body.code === 'number' && Number.isSafeInteger(body.code)) ||
        typeof body.elapsedMs !== 'number' || !Number.isSafeInteger(body.elapsedMs) || body.elapsedMs < 0 || body.elapsedMs > 120_000) return fail('Invalid connection diagnostic.');
      console.warn('[wallet-connection]', JSON.stringify({ network: body.network, stage: body.stage, code: body.code, elapsedMs: body.elapsedMs }));
      return json({ recorded: true });
    }
    if (body.operation === 'wallet-sign-in-challenge') {
      exact(body, ['network']); return json(walletSignInChallenge(journal, body.network, origin));
    }
    if (body.operation === 'wallet-sign-in-verify') {
      exact(body, ['id', 'wallet', 'message', 'signature']);
      return json(await verifyWalletSignIn(journal, id(body.id), body.wallet, body.message, body.signature, origin));
    }
    if (body.operation === 'configure') {
      exact(body, ['config']);
      if (journal.bridges().some((b) => !['LENT', 'SOURCE_FAILED', 'CANCELLED'].includes(b.status)) || journal.steps().some((s) => !['FINALIZED', 'FAILED', 'REJECTED', 'CANCELLED'].includes(s.state))) return fail('Finish or recover pending transactions before changing wallets.');
      const config = parseLocalWalletConfig(body.config);
      if (config.ethereumTreasury !== MAINNET_TREASURIES.ethereumTreasury || config.solanaTreasury !== MAINNET_TREASURIES.solanaTreasury) return fail('Use the configured platform treasury recipients.');
      service.configuration.write(config); return json({ configured: true });
    }
    const config = service.configuration.read();
    if (body.operation === 'preflight') { exact(body, []); return json(await service.inspectWallets(config)); }
    if (body.operation === 'markets') { exact(body, []); return json(await service.smartLending.markets(config)); }
    if (typeof body.operation === 'string' && body.operation.startsWith('smart-lending-')) {
      if (body.operation === 'smart-lending-compare') {
        exact(body, ['input']); return json(await service.smartLending.compare(config, body.input, false));
      }
      if (body.operation === 'smart-lending-prepare') {
        exact(body, ['id']); return json(await service.smartLending.prepare(config, id(body.id)));
      }
      if (body.operation === 'smart-lending-continue') {
        exact(body, ['id']);
        const step = service.lending.assertStep(journal.step(id(body.id)), config);
        if (step.state !== 'FINALIZED' || !['DEPLOY_LENDING', 'LENDING_APPROVAL', 'LENDING_REVOKE'].includes(step.kind) || !step.evidence.smartQuoteId) return fail('Verify the previous lending setup or approval before continuing.');
        if (step.kind === 'DEPLOY_LENDING') {
          const previous = service.smartLending.read(JSON.parse(step.evidence.config!), step.evidence.smartQuoteId, true);
          const fresh = await service.smartLending.compare(config, previous.input);
          return json(await service.smartLending.prepare(config, fresh.id));
        }
        return json(await service.smartLending.prepare(config, step.evidence.smartQuoteId, true));
      }
      return fail('Unsupported smart lending operation.');
    }
    if (typeof body.operation === 'string' && body.operation.startsWith('lending-')) {
      if (body.operation === 'lending-prepare') {
        exact(body, ['network', 'action', 'amount', ...(body.provider === undefined ? [] : ['provider'])]);
        return json(await service.lending.prepare(config, body.network, body.action, body.amount, {}, body.provider));
      }
      service.lending.assertStep(journal.step(id(body.id)), config);
      switch (body.operation) {
        case 'lending-wallet-error':
          exact(body, ['id', 'message']);
          if (typeof body.message !== 'string' || !body.message || body.message.length > 500) return fail('Invalid wallet error.');
          return json(journal.changeStep(id(body.id), ['RESERVED', 'REJECTED', 'SIGNED', 'SUBMITTED', 'CONFIRMED'], { walletError: body.message }));
        case 'lending-reserve': exact(body, ['id']); return json(await service.reserve(id(body.id)));
        case 'lending-signed': exact(body, ['id', 'serialized']); return json(await service.signed(id(body.id), body.serialized));
        case 'lending-dispatch-solana': exact(body, ['id']); return json(await service.dispatchSolana(id(body.id)));
        case 'lending-submitted': exact(body, ['id', 'transactionId']); return json(await service.submitted(id(body.id), body.transactionId));
        case 'lending-reconcile': exact(body, ['id']); return json(await service.reconcile(id(body.id)));
        case 'lending-recover-wallet-request': exact(body, ['id']); return json(await service.recoverWalletRequest(id(body.id)));
        case 'lending-cancel-step': exact(body, ['id']); return json(service.cancelStep(id(body.id)));
        case 'lending-rejected': exact(body, ['id', 'code']); if (body.code !== 4001) return fail('Only an explicit wallet rejection can close this request.'); return json(service.rejected(id(body.id)));
        default: return fail('Unsupported lending operation.');
      }
    }
    if (!hasBothWallets(config)) return fail('Connect both Ethereum and Solana wallets to bridge between chains.');
    if (['reserve', 'signed', 'dispatch-solana', 'submitted', 'reconcile', 'cancel-step', 'rejected'].includes(String(body.operation)) && isDirectLendingStep(journal.step(id(body.id)))) return fail('Use the local lending workflow for this transaction.');
    switch (body.operation) {
      case 'deploy': exact(body, ['kind']); return json(await service.deploy(config, body.kind));
      case 'create': exact(body, ['sourceNetwork', 'amount']); return json(await service.create(body.sourceNetwork, body.amount, config));
      case 'source': exact(body, ['id', 'quoteSignature']); return json(await service.source(id(body.id), body.quoteSignature));
      case 'attestation': exact(body, ['id']); return json(await service.attestation(id(body.id)));
      case 'destination': exact(body, ['id', 'mode']); return json(await service.destination(id(body.id), body.mode));
      case 'lookup': exact(body, ['id']); return json(await service.lookup(id(body.id)));
      case 'reserve': exact(body, ['id']); return json(await service.reserve(id(body.id)));
      case 'signed': exact(body, ['id', 'serialized']); return json(await service.signed(id(body.id), body.serialized));
      case 'dispatch-solana': exact(body, ['id']); return json(await service.dispatchSolana(id(body.id)));
      case 'submitted': exact(body, ['id', 'transactionId']); return json(await service.submitted(id(body.id), body.transactionId));
      case 'reconcile': exact(body, ['id']); return json(await service.reconcile(id(body.id)));
      case 'cancel-step': exact(body, ['id']); return json(service.cancelStep(id(body.id)));
      case 'cancel-bridge': exact(body, ['id']); return json(service.cancelBridge(id(body.id)));
      case 'rejected': exact(body, ['id', 'code']); if (body.code !== 4001) return fail('Only an explicit wallet rejection can close this request.'); return json(service.rejected(id(body.id)));
      case 'pause': exact(body, ['paused']); if (typeof body.paused !== 'boolean') return fail('Invalid pause state.'); journal.pause(body.paused); return json({ paused: body.paused });
      default: return fail('Unsupported local bridge operation.');
    }
  } catch (error) { return errorResponse(error); }
}
