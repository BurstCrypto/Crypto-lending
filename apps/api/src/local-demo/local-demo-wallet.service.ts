import { generateKeyPairSync, sign as signNodeMessage, type KeyObject } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

import { parseAccountId, type AccountId } from '../accounts/domain/account-profile';
import { isCanonicalUuidV4 } from '../infrastructure/logging';
import {
  type IssuedWalletOwnershipChallenge,
  type RegisteredWalletResult,
  WalletRegistrationService,
} from '../wallets/application/wallet-registration.service';
import {
  LOCAL_DEMO_RUNTIME_CONFIG,
  type LocalDemoRuntimeConfig,
} from './local-demo-runtime.config';

export type LocalDemoWalletNamespace = 'EVM' | 'SOLANA';

export interface LocalDemoWalletConnection {
  readonly connectionId: string;
  readonly walletId: string;
  readonly label: string;
  readonly namespace: LocalDemoWalletNamespace;
  readonly chainId: string;
  readonly address: string;
  readonly registeredAt: string;
}

export interface ConnectLocalDemoWalletInput {
  readonly accountId: AccountId;
  readonly namespace: LocalDemoWalletNamespace;
  readonly correlationId: string;
}

interface LocalDemoWalletDefinition {
  readonly namespace: LocalDemoWalletNamespace;
  readonly label: string;
  readonly chainId: string;
  readonly messageFormat: 'SIWE' | 'SIWS';
}

export const LOCAL_DEMO_WALLET_CATALOG: Readonly<
  Record<LocalDemoWalletNamespace, LocalDemoWalletDefinition>
> = Object.freeze({
  EVM: Object.freeze({
    namespace: 'EVM',
    label: 'Synthetic EVM wallet',
    chainId: 'eip155:11155111',
    messageFormat: 'SIWE',
  }),
  SOLANA: Object.freeze({
    namespace: 'SOLANA',
    label: 'Synthetic Solana wallet',
    chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    messageFormat: 'SIWS',
  }),
});

const CATALOG_ORDER = Object.freeze<readonly LocalDemoWalletNamespace[]>(['EVM', 'SOLANA']);
const SOLANA_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_PUBLIC_KEY_LENGTH = 32;

export class LocalDemoUnavailableError extends Error {
  readonly code = 'LOCAL_DEMO_UNAVAILABLE' as const;

  constructor() {
    super('Local demo is unavailable');
    this.name = 'LocalDemoUnavailableError';
  }
}

export class LocalDemoWalletRequestError extends Error {
  readonly code = 'LOCAL_DEMO_WALLET_REQUEST_INVALID' as const;

  constructor() {
    super('Local demo wallet request is invalid');
    this.name = 'LocalDemoWalletRequestError';
  }
}

interface EvmSigner {
  readonly namespace: 'EVM';
  readonly account: PrivateKeyAccount;
}

interface SolanaSigner {
  readonly namespace: 'SOLANA';
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
}

type LocalDemoSigner = EvmSigner | SolanaSigner;

interface LocalDemoWalletEntry {
  readonly projection: LocalDemoWalletConnection;
  readonly signer: LocalDemoSigner;
}

interface AccountWalletCatalog {
  readonly entries: Map<LocalDemoWalletNamespace, LocalDemoWalletEntry>;
  readonly pending: Map<LocalDemoWalletNamespace, Promise<LocalDemoWalletConnection>>;
}

function failRequest(): never {
  throw new LocalDemoWalletRequestError();
}

function exactAccountId(value: AccountId): AccountId {
  try {
    return parseAccountId(value);
  } catch {
    return failRequest();
  }
}

function exactNamespace(value: unknown): LocalDemoWalletNamespace {
  if (value !== 'EVM' && value !== 'SOLANA') return failRequest();
  return value;
}

function exactCorrelationId(value: unknown): string {
  if (!isCanonicalUuidV4(value)) return failRequest();
  return value;
}

function sameAddress(namespace: LocalDemoWalletNamespace, left: string, right: string): boolean {
  return namespace === 'EVM' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function base58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += (digits[index] ?? 0) << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  return (
    '1'.repeat(zeroes) +
    digits
      .reverse()
      .map((digit) => SOLANA_ALPHABET[digit] ?? '')
      .join('')
  );
}

function solanaPublicKeyBytes(publicKey: KeyObject): Uint8Array {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  if (!Buffer.isBuffer(der) || der.length < ED25519_PUBLIC_KEY_LENGTH) {
    throw new LocalDemoUnavailableError();
  }
  return new Uint8Array(der.subarray(der.length - ED25519_PUBLIC_KEY_LENGTH));
}

function assertChallenge(
  challenge: IssuedWalletOwnershipChallenge,
  definition: LocalDemoWalletDefinition,
  address: string,
): void {
  if (
    challenge.registryEnvironment !== 'TESTNET' ||
    challenge.chainId !== definition.chainId ||
    challenge.messageFormat !== definition.messageFormat ||
    !sameAddress(definition.namespace, challenge.address, address) ||
    typeof challenge.message !== 'string' ||
    challenge.message.length === 0
  ) {
    throw new LocalDemoUnavailableError();
  }
}

function projectionFrom(
  registered: RegisteredWalletResult,
  definition: LocalDemoWalletDefinition,
  address: string,
): LocalDemoWalletConnection {
  if (
    !isCanonicalUuidV4(registered.walletId) ||
    registered.registryEnvironment !== 'TESTNET' ||
    registered.chainId !== definition.chainId ||
    !sameAddress(definition.namespace, registered.address, address) ||
    !(registered.registeredAt instanceof Date) ||
    !Number.isFinite(registered.registeredAt.getTime())
  ) {
    throw new LocalDemoUnavailableError();
  }

  return Object.freeze({
    connectionId: registered.walletId,
    walletId: registered.walletId,
    label: definition.label,
    namespace: definition.namespace,
    chainId: definition.chainId,
    address: registered.address,
    registeredAt: registered.registeredAt.toISOString(),
  });
}

@Injectable()
export class LocalDemoWalletService {
  readonly #catalogByAccount = new Map<AccountId, AccountWalletCatalog>();

  constructor(
    private readonly wallets: WalletRegistrationService,
    @Inject(LOCAL_DEMO_RUNTIME_CONFIG)
    private readonly config: LocalDemoRuntimeConfig,
  ) {}

  async connect(input: ConnectLocalDemoWalletInput): Promise<LocalDemoWalletConnection> {
    this.assertEnabled();
    const accountId = exactAccountId(input.accountId);
    const namespace = exactNamespace(input.namespace);
    const correlationId = exactCorrelationId(input.correlationId);
    const catalog = this.catalogFor(accountId);
    const existing = catalog.entries.get(namespace);
    if (existing !== undefined) return existing.projection;
    const pending = catalog.pending.get(namespace);
    if (pending !== undefined) return pending;

    let operation: Promise<LocalDemoWalletConnection>;
    operation = this.connectNew(accountId, namespace, correlationId).then((entry) => {
      if (this.#catalogByAccount.get(accountId) !== catalog) {
        throw new LocalDemoUnavailableError();
      }
      catalog.entries.set(namespace, entry);
      return entry.projection;
    });
    operation = operation.finally(() => {
      if (
        this.#catalogByAccount.get(accountId) === catalog &&
        catalog.pending.get(namespace) === operation
      ) {
        catalog.pending.delete(namespace);
        this.pruneEmptyCatalog(accountId, catalog);
      }
    });
    catalog.pending.set(namespace, operation);
    return operation;
  }

  list(accountIdInput: AccountId): readonly LocalDemoWalletConnection[] {
    this.assertEnabled();
    const accountId = exactAccountId(accountIdInput);
    const catalog = this.#catalogByAccount.get(accountId);
    if (catalog === undefined) return Object.freeze([]);
    return Object.freeze(
      CATALOG_ORDER.flatMap((namespace) => {
        const entry = catalog.entries.get(namespace);
        return entry === undefined ? [] : [entry.projection];
      }),
    );
  }

  disconnect(accountIdInput: AccountId, connectionId: string): boolean {
    this.assertEnabled();
    const accountId = exactAccountId(accountIdInput);
    if (!isCanonicalUuidV4(connectionId)) return failRequest();
    const catalog = this.#catalogByAccount.get(accountId);
    if (catalog === undefined) return false;

    for (const namespace of CATALOG_ORDER) {
      const entry = catalog.entries.get(namespace);
      if (entry?.projection.connectionId !== connectionId) continue;
      catalog.entries.delete(namespace);
      this.pruneEmptyCatalog(accountId, catalog);
      return true;
    }
    return false;
  }

  reset(accountIdInput: AccountId): void {
    this.assertEnabled();
    const accountId = exactAccountId(accountIdInput);
    this.#catalogByAccount.delete(accountId);
  }

  private assertEnabled(): void {
    if (
      this.config.mode !== 'enabled' ||
      this.config.apiHost !== '127.0.0.1' ||
      this.config.publicOrigin !== 'http://127.0.0.1:3000'
    ) {
      throw new LocalDemoUnavailableError();
    }
  }

  private catalogFor(accountId: AccountId): AccountWalletCatalog {
    const existing = this.#catalogByAccount.get(accountId);
    if (existing !== undefined) return existing;
    const created: AccountWalletCatalog = {
      entries: new Map(),
      pending: new Map(),
    };
    this.#catalogByAccount.set(accountId, created);
    return created;
  }

  private pruneEmptyCatalog(accountId: AccountId, catalog: AccountWalletCatalog): void {
    if (catalog.entries.size === 0 && catalog.pending.size === 0) {
      this.#catalogByAccount.delete(accountId);
    }
  }

  private async connectNew(
    accountId: AccountId,
    namespace: LocalDemoWalletNamespace,
    correlationId: string,
  ): Promise<LocalDemoWalletEntry> {
    const definition = LOCAL_DEMO_WALLET_CATALOG[namespace];
    if (namespace === 'EVM') {
      const signer: EvmSigner = Object.freeze({
        namespace,
        account: privateKeyToAccount(generatePrivateKey()),
      });
      const challenge = await this.wallets.issueChallenge({
        accountId,
        chainId: definition.chainId,
        address: signer.account.address,
        correlationId,
      });
      assertChallenge(challenge, definition, signer.account.address);
      const signature = await signer.account.signMessage({ message: challenge.message });
      const registered = await this.wallets.submitProof({
        accountId,
        correlationId,
        proof: {
          kind: 'EVM_EIP191_EOA',
          challengeId: challenge.challengeId,
          message: challenge.message,
          signature,
        },
      });
      return Object.freeze({
        projection: projectionFrom(registered, definition, signer.account.address),
        signer,
      });
    }

    const pair = generateKeyPairSync('ed25519');
    const signer: SolanaSigner = Object.freeze({
      namespace,
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
    });
    const publicKey = solanaPublicKeyBytes(signer.publicKey);
    const address = base58(publicKey);
    const challenge = await this.wallets.issueChallenge({
      accountId,
      chainId: definition.chainId,
      address,
      correlationId,
    });
    assertChallenge(challenge, definition, address);
    const signedMessage = Buffer.from(challenge.message, 'utf8');
    const signature = signNodeMessage(null, signedMessage, signer.privateKey);
    const registered = await this.wallets.submitProof({
      accountId,
      correlationId,
      proof: {
        kind: 'SOLANA_ED25519',
        challengeId: challenge.challengeId,
        address: challenge.address as never,
        publicKey,
        signedMessage,
        signature,
      },
    });
    return Object.freeze({
      projection: projectionFrom(registered, definition, address),
      signer,
    });
  }
}
