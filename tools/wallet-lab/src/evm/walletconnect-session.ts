import type { Connector } from 'wagmi';

import type { EvmTestnetChainId } from './chains';

const ALLOWED_CHAINS = new Set(['eip155:11155111', 'eip155:84532']);
const ALLOWED_METHODS = new Set(['personal_sign', 'wallet_switchEthereumChain']);
const ALLOWED_EVENTS = new Set(['accountsChanged', 'chainChanged']);
const MAX_SCOPE_ITEMS = 64;

export type WalletConnectSessionRejection =
  | 'invalid-session-scope'
  | 'missing-personal-sign'
  | 'selected-account-missing'
  | 'testnet-scope-missing'
  | 'unapproved-event'
  | 'unapproved-method';

export type WalletConnectSessionInspection =
  | Readonly<{ accepted: true; canSwitchChain: boolean }>
  | Readonly<{ accepted: false; reason: WalletConnectSessionRejection }>;

export type ExactWalletConnectConnector = Connector &
  Readonly<{ id: 'walletConnect'; type: 'walletConnect' }>;

type SessionScope = Readonly<{
  chains: readonly string[];
  methods: readonly string[];
  events: readonly string[];
  accounts: readonly string[];
}>;

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) &&
    value.length <= MAX_SCOPE_ITEMS &&
    value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 256)
    ? value
    : null;
}

function rejected(reason: WalletConnectSessionRejection): WalletConnectSessionInspection {
  return Object.freeze({ accepted: false, reason });
}

export function isWalletConnectConnector(
  connector: Connector | undefined,
): connector is ExactWalletConnectConnector {
  return connector?.id === 'walletConnect' && connector.type === 'walletConnect';
}

function readScope(key: string, value: unknown): SessionScope | null {
  const keyMatch = /^eip155(?::(\d+))?$/u.exec(key);
  if (!keyMatch || typeof value !== 'object' || value === null) return null;
  const methods = stringArray(Reflect.get(value, 'methods'));
  const events = stringArray(Reflect.get(value, 'events'));
  const accounts = stringArray(Reflect.get(value, 'accounts'));
  const rawChains = Reflect.get(value, 'chains');
  const explicitChains = rawChains === undefined ? [] : stringArray(rawChains);
  if (!methods || !events || !accounts || !explicitChains || accounts.length === 0) return null;

  const scopedChain = keyMatch[1] === undefined ? [] : [`eip155:${keyMatch[1]}`];
  return { methods, events, accounts, chains: [...explicitChains, ...scopedChain] };
}

function providerSupportsSessionUpdates(provider: object): boolean {
  return (
    typeof Reflect.get(provider, 'on') === 'function' &&
    (typeof Reflect.get(provider, 'off') === 'function' ||
      typeof Reflect.get(provider, 'removeListener') === 'function')
  );
}

/**
 * Inspects settled WC namespaces without returning or logging session data.
 * Scoped and unscoped EVM namespace keys are normalized before enforcing the
 * two-testnet, selected-account, and minimal method/event allowlists.
 */
export function inspectWalletConnectSession(
  provider: unknown,
  expected: Readonly<{ chainId: EvmTestnetChainId; address: string }>,
): WalletConnectSessionInspection {
  try {
    if (
      typeof provider !== 'object' ||
      provider === null ||
      Reflect.get(provider, 'isWalletConnect') !== true ||
      Reflect.get(provider, 'namespace') !== 'eip155' ||
      !providerSupportsSessionUpdates(provider)
    ) {
      return rejected('invalid-session-scope');
    }
    const session = Reflect.get(provider, 'session');
    const namespaces =
      typeof session === 'object' && session !== null
        ? Reflect.get(session, 'namespaces')
        : undefined;
    if (typeof namespaces !== 'object' || namespaces === null) {
      return rejected('invalid-session-scope');
    }
    const entries = Object.entries(namespaces);
    if (entries.length === 0 || entries.length > MAX_SCOPE_ITEMS) {
      return rejected('invalid-session-scope');
    }

    const scopes: SessionScope[] = [];
    for (const [key, value] of entries) {
      const scope = readScope(key, value);
      if (!scope) return rejected('invalid-session-scope');
      if (scope.methods.some((method) => !ALLOWED_METHODS.has(method))) {
        return rejected('unapproved-method');
      }
      if (scope.events.some((event) => !ALLOWED_EVENTS.has(event))) {
        return rejected('unapproved-event');
      }
      scopes.push(scope);
    }

    const expectedChain = `eip155:${expected.chainId}`;
    const expectedAccount = `${expectedChain}:${expected.address}`.toLowerCase();
    let selectedAccountFound = false;
    let selectedSigningFound = false;
    let selectedSwitchFound = false;

    for (const scope of scopes) {
      const accountParts = scope.accounts.map((account) => account.split(':'));
      if (
        accountParts.some(
          (parts) =>
            parts.length !== 3 ||
            parts[0] !== 'eip155' ||
            !/^0x[a-f\d]{40}$/iu.test(parts[2] ?? ''),
        )
      ) {
        return rejected('invalid-session-scope');
      }
      const accountChains = accountParts.map((parts) => `${parts[0]}:${parts[1]}`);
      const allScopeChains = new Set([...scope.chains, ...accountChains]);
      if ([...allScopeChains].some((chain) => !ALLOWED_CHAINS.has(chain))) {
        return rejected('testnet-scope-missing');
      }
      const appliesToSelectedChain = allScopeChains.has(expectedChain);
      const containsSelectedAccount = scope.accounts.some(
        (account) => account.toLowerCase() === expectedAccount,
      );
      if (containsSelectedAccount) {
        selectedAccountFound = true;
      }
      if (
        appliesToSelectedChain &&
        containsSelectedAccount &&
        scope.methods.includes('personal_sign')
      ) {
        selectedSigningFound = true;
      }
      if (
        appliesToSelectedChain &&
        containsSelectedAccount &&
        scope.methods.includes('wallet_switchEthereumChain')
      ) {
        selectedSwitchFound = true;
      }
    }

    if (
      !scopes.some((scope) => new Set(scope.chains).has(expectedChain)) &&
      !selectedAccountFound
    ) {
      return rejected('testnet-scope-missing');
    }
    if (!selectedAccountFound) return rejected('selected-account-missing');
    if (!selectedSigningFound) return rejected('missing-personal-sign');
    return Object.freeze({ accepted: true, canSwitchChain: selectedSwitchFound });
  } catch {
    return rejected('invalid-session-scope');
  }
}

export function subscribeWalletConnectSessionUpdates(
  provider: unknown,
  listener: () => void,
): (() => void) | null {
  if (
    typeof provider !== 'object' ||
    provider === null ||
    !providerSupportsSessionUpdates(provider)
  ) {
    return null;
  }
  try {
    const on = Reflect.get(provider, 'on') as (event: string, callback: () => void) => unknown;
    const off = Reflect.get(provider, 'off');
    const removeListener = Reflect.get(provider, 'removeListener');
    const remove = (typeof off === 'function' ? off : removeListener) as (
      event: string,
      callback: () => void,
    ) => unknown;
    on.call(provider, 'session_update', listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      try {
        remove.call(provider, 'session_update', listener);
      } catch {
        // Listener removal is best effort. The component also invalidates its
        // guard generation before calling this closure, so a retained callback
        // cannot restore an accepted signing state.
      }
    };
  } catch {
    return null;
  }
}
