import {
  assertWalletAccount,
  assertWalletConnection,
  type ChainId,
  type WalletAccount,
  type WalletConnection,
  type WalletNamespace,
} from './wallet-adapter';

export const KAN61_SOLANA_CAIP_CHAIN_IDS = Object.freeze({
  mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
} as const);

export type Kan61SolanaCaipChainId =
  (typeof KAN61_SOLANA_CAIP_CHAIN_IDS)[keyof typeof KAN61_SOLANA_CAIP_CHAIN_IDS];

const EVM_CHAIN_ID = /^eip155:(?:0|[1-9][0-9]*)$/u;
const KAN61_SOLANA_CHAIN_IDS = new Set<string>(Object.values(KAN61_SOLANA_CAIP_CHAIN_IDS));

/*
 * KAN-60 remains based directly on main, whose frozen WAL-001 validator predates
 * KAN-61's canonical Solana CAIP references. This view is used only for local
 * validation against that older boundary. It is never stored or returned.
 */
const LEGACY_VALIDATION_CHAIN_BY_CANONICAL: Readonly<Record<Kan61SolanaCaipChainId, ChainId>> =
  Object.freeze({
    [KAN61_SOLANA_CAIP_CHAIN_IDS.mainnet]: 'solana:mainnet',
    [KAN61_SOLANA_CAIP_CHAIN_IDS.devnet]: 'solana:devnet',
  });

const SHARED_BOUNDARY_ACCEPTS_KAN61_SOLANA = (() => {
  try {
    assertWalletAccount(
      {
        chainId: KAN61_SOLANA_CAIP_CHAIN_IDS.devnet,
        address: '7YttLkHDoNj9wyDur5EYBDauN5QJUJpz94QRtWQyFrA8',
      },
      'solana',
    );
    return true;
  } catch {
    return false;
  }
})();

export function isCanonicalLifecycleChainId(
  value: unknown,
  namespace: WalletNamespace,
): value is ChainId {
  return (
    typeof value === 'string' &&
    (namespace === 'eip155' ? EVM_CHAIN_ID.test(value) : KAN61_SOLANA_CHAIN_IDS.has(value))
  );
}

function canonicalSolanaChainId(value: unknown): Kan61SolanaCaipChainId {
  if (typeof value !== 'string' || !KAN61_SOLANA_CHAIN_IDS.has(value)) {
    throw new TypeError('Solana chain ID is not a canonical KAN-61 identity');
  }
  return value as Kan61SolanaCaipChainId;
}

function legacyValidationAccount(account: WalletAccount): WalletAccount {
  const chainId = canonicalSolanaChainId(account.chainId);
  return {
    chainId: LEGACY_VALIDATION_CHAIN_BY_CANONICAL[chainId],
    address: account.address,
  };
}

function requireCanonicalSolanaConnection(value: unknown): WalletConnection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('wallet connection must be an object');
  }
  const connection = value as WalletConnection;
  if (!Array.isArray(connection.accounts) || !Array.isArray(connection.approvedScopes)) {
    throw new TypeError('wallet connection must contain accounts and scopes');
  }
  for (const account of connection.accounts) canonicalSolanaChainId(account?.chainId);
  for (const scope of connection.approvedScopes) canonicalSolanaChainId(scope?.chainId);
  canonicalSolanaChainId(connection.selectedAccount?.chainId);
  return connection;
}

function legacyValidationConnection(connection: WalletConnection): WalletConnection {
  return {
    connectionId: connection.connectionId,
    connectorId: connection.connectorId,
    ...(connection.transportSessionId === undefined
      ? {}
      : { transportSessionId: connection.transportSessionId }),
    accounts: connection.accounts.map(legacyValidationAccount),
    approvedScopes: connection.approvedScopes.map((scope) => ({
      chainId: LEGACY_VALIDATION_CHAIN_BY_CANONICAL[canonicalSolanaChainId(scope.chainId)],
      methods: scope.methods,
      events: scope.events,
    })),
    selectedAccount: legacyValidationAccount(connection.selectedAccount),
    restored: connection.restored,
  };
}

export function assertLifecycleWalletAccount(
  value: unknown,
  expectedNamespace: WalletNamespace,
): asserts value is WalletAccount {
  if (expectedNamespace !== 'solana') {
    assertWalletAccount(value, expectedNamespace);
    return;
  }

  const account = value as WalletAccount;
  canonicalSolanaChainId(account?.chainId);
  if (SHARED_BOUNDARY_ACCEPTS_KAN61_SOLANA) {
    assertWalletAccount(value, expectedNamespace);
    return;
  }
  assertWalletAccount(legacyValidationAccount(account), expectedNamespace);
}

export function assertLifecycleWalletConnection(
  value: unknown,
  expectedNamespace: WalletNamespace,
  expectedConnectorId: string,
): asserts value is WalletConnection {
  if (expectedNamespace !== 'solana') {
    assertWalletConnection(value, expectedNamespace, expectedConnectorId);
    return;
  }

  const connection = requireCanonicalSolanaConnection(value);
  if (SHARED_BOUNDARY_ACCEPTS_KAN61_SOLANA) {
    assertWalletConnection(value, expectedNamespace, expectedConnectorId);
    return;
  }
  assertWalletConnection(
    legacyValidationConnection(connection),
    expectedNamespace,
    expectedConnectorId,
  );
}
