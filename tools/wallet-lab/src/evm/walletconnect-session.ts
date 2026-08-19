import type { Connector } from 'wagmi';

import type { EvmTestnetChainId } from './chains';

const ALLOWED_CHAINS = new Set(['eip155:11155111', 'eip155:84532']);
const ALLOWED_METHODS = new Set(['personal_sign', 'wallet_switchEthereumChain']);
const ALLOWED_EVENTS = new Set(['accountsChanged', 'chainChanged']);
const MAX_SCOPE_ITEMS = 64;

export type WalletConnectSessionRejection =
  | 'ambiguous-account-selection'
  | 'invalid-session-scope'
  | 'missing-personal-sign'
  | 'selected-account-missing'
  | 'testnet-scope-missing'
  | 'unapproved-event'
  | 'unapproved-method';

export type WalletConnectSessionInspection =
  | Readonly<{ accepted: true; canSwitchChain: boolean }>
  | Readonly<{ accepted: false; reason: WalletConnectSessionRejection }>;

export type WalletConnectSessionLifecycleSignal =
  'session-update' | 'session-delete' | 'session-expire';

export type ExactWalletConnectConnector = Connector &
  Readonly<{ id: 'walletConnect'; type: 'walletConnect' }>;

type SessionScope = Readonly<{
  chains: readonly string[];
  methods: readonly string[];
  events: readonly string[];
  accounts: readonly string[];
}>;

type ProviderEventListener = (...payload: unknown[]) => void;

type ProviderEventMethods = Readonly<{
  on: (event: string, listener: ProviderEventListener) => unknown;
  remove: (event: string, listener: ProviderEventListener) => unknown;
}>;

const WALLETCONNECT_SESSION_LIFECYCLE_EVENTS = [
  ['session_update', 'session-update'],
  ['session_delete', 'session-delete'],
  ['session_expire', 'session-expire'],
] as const satisfies readonly (readonly [string, WalletConnectSessionLifecycleSignal])[];

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

function providerEventMethods(provider: object): ProviderEventMethods | null {
  try {
    const on = Reflect.get(provider, 'on');
    const off = Reflect.get(provider, 'off');
    const removeListener = Reflect.get(provider, 'removeListener');
    const remove = typeof off === 'function' ? off : removeListener;
    if (typeof on !== 'function' || typeof remove !== 'function') return null;
    return { on, remove } as ProviderEventMethods;
  } catch {
    return null;
  }
}

function providerSupportsSessionUpdates(provider: object): boolean {
  return providerEventMethods(provider) !== null;
}

function subscribeProviderEvents(
  provider: object,
  subscriptions: readonly (readonly [event: string, listener: ProviderEventListener])[],
  deactivate: () => void = () => undefined,
): (() => void) | null {
  const methods = providerEventMethods(provider);
  if (!methods) return null;

  const attempted: (readonly [event: string, listener: ProviderEventListener])[] = [];
  try {
    for (const subscription of subscriptions) {
      attempted.push(subscription);
      methods.on.call(provider, ...subscription);
    }
  } catch {
    deactivate();
    for (const subscription of attempted) {
      try {
        methods.remove.call(provider, ...subscription);
      } catch {
        // Keep removing any other listeners after a provider cleanup error.
      }
    }
    return null;
  }

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    deactivate();
    for (const subscription of subscriptions) {
      try {
        methods.remove.call(provider, ...subscription);
      } catch {
        // Listener removal is best effort. Deactivation prevents a retained
        // provider callback from reporting another lifecycle signal.
      }
    }
  };
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
    const approvedAddresses = new Set<string>();

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
      for (const parts of accountParts) approvedAddresses.add((parts[2] ?? '').toLowerCase());
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
    if (approvedAddresses.size !== 1) return rejected('ambiguous-account-selection');
    return Object.freeze({ accepted: true, canSwitchChain: selectedSwitchFound });
  } catch {
    return rejected('invalid-session-scope');
  }
}

export function subscribeWalletConnectSessionUpdates(
  provider: unknown,
  listener: () => void,
): (() => void) | null {
  if (typeof provider !== 'object' || provider === null) return null;
  return subscribeProviderEvents(provider, [['session_update', listener]]);
}

/**
 * Reports settled-session lifecycle changes without exposing provider payloads.
 * Registration and cleanup failures are contained at the provider boundary;
 * the returned cleanup function is safe to call more than once.
 */
export function subscribeWalletConnectSessionLifecycle(
  provider: unknown,
  listener: (signal: WalletConnectSessionLifecycleSignal) => void,
): (() => void) | null {
  if (typeof provider !== 'object' || provider === null) return null;

  let active = true;
  const subscriptions = WALLETCONNECT_SESSION_LIFECYCLE_EVENTS.map(
    ([event, signal]) =>
      [
        event,
        () => {
          if (active) listener(signal);
        },
      ] as const,
  );
  return subscribeProviderEvents(provider, subscriptions, () => {
    active = false;
  });
}
