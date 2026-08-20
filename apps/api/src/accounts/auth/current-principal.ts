import type { AccountId } from '../domain/account-profile';

export const CURRENT_PRINCIPAL_RESOLVER = Symbol('CURRENT_PRINCIPAL_RESOLVER');

export interface CurrentPrincipal {
  readonly accountId: AccountId;
}

export interface CurrentPrincipalResolver {
  resolve(request: unknown): CurrentPrincipal | null | Promise<CurrentPrincipal | null>;
}

/** Secure runtime fallback while managed authentication is not yet integrated. */
export const DENY_ALL_CURRENT_PRINCIPAL_RESOLVER: CurrentPrincipalResolver = Object.freeze({
  resolve: (): null => null,
});

const principalsByRequest = new WeakMap<object, CurrentPrincipal>();

function isObjectReference(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export function bindCurrentPrincipal(request: unknown, principal: CurrentPrincipal): void {
  if (!isObjectReference(request)) {
    throw new TypeError('HTTP request must be an object');
  }
  principalsByRequest.set(request, Object.freeze({ accountId: principal.accountId }));
}

export function readCurrentPrincipal(request: unknown): CurrentPrincipal | undefined {
  return isObjectReference(request) ? principalsByRequest.get(request) : undefined;
}

export function clearCurrentPrincipal(request: unknown): void {
  if (isObjectReference(request)) {
    principalsByRequest.delete(request);
  }
}
