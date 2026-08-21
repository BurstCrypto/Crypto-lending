import type { LedgerActorAccountId } from '../domain/ledger';

export const LEDGER_ACTOR_RESOLVER = Symbol('LEDGER_ACTOR_RESOLVER');

/**
 * Implemented only by an authenticated HTTP or verified job boundary. Logging
 * correlation state is deliberately not an authorization source.
 */
export interface LedgerActorResolver {
  resolve(): LedgerActorAccountId | null | Promise<LedgerActorAccountId | null>;
}
