import { createHash } from 'node:crypto';
import { MainnetTestJournal } from './journal.server';
import { MAINNET_TEST, fail } from './policy';
import { BRIDGE_ETHEREUM, BRIDGE_SOLANA, completedStep, isDirectLendingStep, type BridgeRecord, type BridgeStep, type BridgeStepState } from './bridge-types';
import { assertRefreshedSolanaReview } from '../lending/solana-refresh';

export const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class BridgeJournal extends MainnetTestJournal {
  constructor(path: string) {
    super(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bridges (id TEXT PRIMARY KEY, status TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_bridge ON bridges((1)) WHERE status NOT IN ('LENT','SOURCE_FAILED','CANCELLED');
      CREATE TABLE IF NOT EXISTS bridge_steps (
        id TEXT PRIMARY KEY, bridge_id TEXT, wallet TEXT NOT NULL, state TEXT NOT NULL, network TEXT NOT NULL,
        body TEXT NOT NULL, reserved_at INTEGER, principal INTEGER NOT NULL DEFAULT 0, cost INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_bridge_step ON bridge_steps(wallet)
        WHERE state IN ('PREPARED','RESERVED','SIGNED','SUBMITTED','CONFIRMED');
      CREATE TABLE IF NOT EXISTS bridge_signed (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lending_quotes (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    `);
  }
  bridges(): BridgeRecord[] {
    return this.db.prepare('SELECT body FROM bridges ORDER BY rowid DESC LIMIT 40').all().map((row) => JSON.parse(String(row.body)) as BridgeRecord);
  }
  bridge(id: string): BridgeRecord {
    const row = this.db.prepare('SELECT body FROM bridges WHERE id=?').get(id);
    if (!row) return fail('Bridge intent not found.');
    return JSON.parse(String(row.body)) as BridgeRecord;
  }
  createBridge(bridge: BridgeRecord) {
    try { this.db.prepare('INSERT INTO bridges VALUES (?,?,?,?)').run(bridge.id, bridge.status, bridge.revision, JSON.stringify(bridge)); }
    catch { return fail('Complete or recover the current bridge before starting another.'); }
  }
  updateBridge(bridge: BridgeRecord): BridgeRecord {
    const updated = { ...bridge, revision: bridge.revision + 1 };
    const result = this.db.prepare('UPDATE bridges SET status=?,revision=?,body=? WHERE id=? AND revision=?')
      .run(updated.status, updated.revision, JSON.stringify(updated), bridge.id, bridge.revision);
    if (result.changes !== 1) return fail('The bridge changed in another request. Refresh its status.');
    return updated;
  }
  steps(): BridgeStep[] {
    return this.db.prepare('SELECT body FROM bridge_steps ORDER BY rowid DESC LIMIT 100').all().map((row) => JSON.parse(String(row.body)) as BridgeStep);
  }
  step(id: string): BridgeStep {
    const row = this.db.prepare('SELECT body FROM bridge_steps WHERE id=?').get(id);
    if (!row) return fail('Bridge transaction not found.');
    return JSON.parse(String(row.body)) as BridgeStep;
  }
  createStep(step: BridgeStep) {
    if (step.fingerprint !== fingerprint({ ethereum: step.ethereum, solana: step.solana, evidence: step.evidence })) return fail('Invalid preparation fingerprint.');
    this.transaction(() => {
      for (const existing of this.steps()) {
        if (existing.state === 'PREPARED' && existing.expiresAt <= step.createdAt) this.writeStep({ ...existing, state: 'CANCELLED' });
      }
      if (this.steps().some((existing) => existing.wallet === step.wallet && !completedStep(existing.state))) return fail('Resolve the pending transaction for this wallet first.');
      this.db.prepare('INSERT INTO bridge_steps(id,bridge_id,wallet,state,network,body) VALUES (?,?,?,?,?,?)')
        .run(step.id, step.bridgeId, step.wallet, step.state, step.network, JSON.stringify(step));
    });
    return step;
  }
  reserveStep(id: string, now = Date.now(), refreshedSolana?: BridgeStep['solana']) {
    return this.transaction(() => {
      let step = this.step(id);
      if (step.state !== 'PREPARED' || step.expiresAt <= now) return fail('This transaction cannot be reserved again.');
      if (refreshedSolana) {
        if (!isDirectLendingStep(step) || step.network !== BRIDGE_SOLANA || !step.solana || step.transactionId) return fail('Only an unsigned Solana lending review can be refreshed.');
        assertRefreshedSolanaReview(step.solana, refreshedSolana);
        step = { ...step, solana: refreshedSolana, expiresAt: now + 60_000 };
        step.fingerprint = fingerprint({ ethereum: step.ethereum, solana: step.solana, evidence: step.evidence });
      }
      if (this.paused() && ['SOURCE_BURN', 'SOURCE_APPROVAL', 'LENDING_SUPPLY', 'LENDING_APPROVAL'].includes(step.kind)) return fail('New deposits and source transactions are paused.');
      if (step.kind === 'SOURCE_BURN') {
        const bridge = this.bridge(step.bridgeId!);
        if (bridge.status !== 'CREATED') return fail('The source burn is already reserved or complete.');
        this.updateBridge({ ...bridge, status: 'SOURCE_PENDING' });
      }
      if (['DESTINATION_MINT', 'DESTINATION_MINT_SUPPLY', 'DESTINATION_SUPPLY'].includes(step.kind)) {
        const bridge = this.bridge(step.bridgeId!);
        if (step.kind === 'DESTINATION_SUPPLY' ? bridge.status !== 'MINTED' : bridge.status !== 'READY_TO_MINT') return fail('Destination work is already reserved or its prerequisites changed.');
        this.updateBridge({ ...bridge, status: 'DESTINATION_PENDING' });
      }
      const start = Math.floor(now / 86_400_000) * 86_400_000;
      const principal = BigInt(step.sourcePrincipal), cost = BigInt(step.maxNetworkCost);
      const dailyCostLimit = step.network === BRIDGE_ETHEREUM ? 30_000_000_000_000_000n : 100_000_000n;
      // Use text casts because EVM gas totals can exceed JavaScript's safe-integer range.
      const costTotal = this.db.prepare('SELECT CAST(COALESCE(SUM(cost),0) AS TEXT) AS cost FROM bridge_steps WHERE reserved_at>=? AND network=?').get(start, step.network)!;
      if (principal < 0n || principal > MAINNET_TEST.maxAmount) return fail('The deposit amount is outside the supported numeric range.');
      if (cost < 0n || BigInt(String(costTotal.cost)) + cost > dailyCostLimit) return fail('The mainnet test daily network-cost limit has been reached.');
      const reserved = { ...step, state: 'RESERVED' as const };
      this.writeStep(reserved);
      this.db.prepare('UPDATE bridge_steps SET reserved_at=?,principal=?,cost=? WHERE id=?').run(now, principal, cost, id);
      return reserved;
    });
  }
  changeStep(id: string, from: BridgeStepState[], updates: Partial<Pick<BridgeStep, 'state' | 'transactionId' | 'outcome' | 'walletError'>>) {
    return this.transaction(() => {
      const step = this.step(id);
      if (!from.includes(step.state)) return fail('The transaction state changed. Refresh before proceeding.');
      if (step.transactionId && updates.transactionId && step.transactionId !== updates.transactionId) return fail('The original transaction identity cannot be replaced.');
      const updated = { ...step, ...updates };
      this.writeStep(updated); return updated;
    });
  }
  signedStep(id: string, transactionId: string, bytes: string) {
    return this.transaction(() => {
      const step = this.step(id);
      if (step.state !== 'RESERVED') return fail('This transaction has already been signed or completed.');
      this.db.prepare('INSERT INTO bridge_signed VALUES (?,?)').run(id, bytes);
      const updated = { ...step, transactionId, state: 'SIGNED' as const };
      this.writeStep(updated); return updated;
    });
  }
  signedPayload(id: string): string | null {
    const row = this.db.prepare('SELECT payload FROM bridge_signed WHERE id=?').get(id);
    return row ? String(row.payload) : null;
  }
  private writeStep(step: BridgeStep) {
    this.db.prepare('UPDATE bridge_steps SET state=?,body=? WHERE id=?').run(step.state, JSON.stringify(step), step.id);
  }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
