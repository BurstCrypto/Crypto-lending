import {
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
  type SolanaTransactionVersion,
} from '@solana/wallet-standard-features';
import { getWallets } from '@wallet-standard/app';
import type { Wallet } from '@wallet-standard/base';
import {
  StandardConnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardEventsFeature,
} from '@wallet-standard/features';

export const SOLANA_DEVNET_WALLET_STANDARD_CHAIN = 'solana:devnet' as const;

const PHANTOM_NAME = 'phantom';
const MAX_WALLET_NAME_LENGTH = 80;

type WalletRegistry = Pick<ReturnType<typeof getWallets>, 'get' | 'on'>;
type WalletFeatureName = `${string}:${string}`;

export interface SolanaWalletDescriptor {
  /** In-memory selection handle; never persisted as wallet identity. */
  readonly selectionId: string;
  readonly displayName: 'Phantom';
  readonly supportedTransactionVersions: readonly SolanaTransactionVersion[];
}

export interface SelectedSolanaWallet {
  readonly descriptor: SolanaWalletDescriptor;
  readonly wallet: Wallet;
}

export interface SolanaWalletDiscoveryOptions {
  readonly wallets?: WalletRegistry;
  readonly secureContext?: () => boolean;
  readonly topLevelContext?: () => boolean;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function featureRecord(
  wallet: Wallet,
  featureName: WalletFeatureName,
): Record<PropertyKey, unknown> | null {
  try {
    const feature: unknown = wallet.features[featureName];
    return isRecord(feature) ? feature : null;
  } catch {
    return null;
  }
}

export function walletStandardConnectFeature(
  wallet: Wallet,
): StandardConnectFeature[typeof StandardConnect] | null {
  const feature = featureRecord(wallet, StandardConnect);
  return feature !== null && typeof feature.connect === 'function'
    ? (feature as unknown as StandardConnectFeature[typeof StandardConnect])
    : null;
}

export function walletStandardEventsFeature(
  wallet: Wallet,
): StandardEventsFeature[typeof StandardEvents] | null {
  const feature = featureRecord(wallet, StandardEvents);
  return feature !== null && typeof feature.on === 'function'
    ? (feature as unknown as StandardEventsFeature[typeof StandardEvents])
    : null;
}

export function walletStandardSignTransactionFeature(
  wallet: Wallet,
): SolanaSignTransactionFeature[typeof SolanaSignTransaction] | null {
  const feature = featureRecord(wallet, SolanaSignTransaction);
  if (
    feature === null ||
    typeof feature.signTransaction !== 'function' ||
    !Array.isArray(feature.supportedTransactionVersions) ||
    feature.supportedTransactionVersions.some((version) => version !== 'legacy' && version !== 0)
  ) {
    return null;
  }
  return feature as unknown as SolanaSignTransactionFeature[typeof SolanaSignTransaction];
}

function safeWalletName(wallet: Wallet): string | null {
  try {
    if (typeof wallet.name !== 'string') return null;
    const value = [...wallet.name]
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127 ? ' ' : character;
      })
      .join('')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, MAX_WALLET_NAME_LENGTH);
    return value.length === 0 ? null : value;
  } catch {
    return null;
  }
}

function walletSupportsDevnet(wallet: Wallet): boolean {
  try {
    return wallet.chains.some((chain) => chain === SOLANA_DEVNET_WALLET_STANDARD_CHAIN);
  } catch {
    return false;
  }
}

function supportedTransactionVersions(wallet: Wallet): readonly SolanaTransactionVersion[] | null {
  const feature = walletStandardSignTransactionFeature(wallet);
  if (feature === null) return null;
  const versions = feature.supportedTransactionVersions.filter(
    (version): version is SolanaTransactionVersion => version === 'legacy' || version === 0,
  );
  return versions.length === 0 ? null : Object.freeze([...versions]);
}

function compatiblePhantom(wallet: Wallet): boolean {
  return (
    safeWalletName(wallet)?.toLocaleLowerCase('en-US') === PHANTOM_NAME &&
    walletSupportsDevnet(wallet) &&
    walletStandardConnectFeature(wallet) !== null &&
    walletStandardEventsFeature(wallet) !== null &&
    supportedTransactionVersions(wallet) !== null
  );
}

function browserIsSecure(): boolean {
  return typeof window === 'object' && window.isSecureContext === true;
}

function browserIsTopLevel(): boolean {
  if (typeof window !== 'object') return false;
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

/**
 * Non-interactive Wallet Standard discovery for the reviewed Phantom Devnet path.
 * Wallet metadata is self-reported; transaction safety comes from independent byte validation.
 */
export class PhantomSolanaWalletDiscovery {
  readonly #registry: WalletRegistry;
  readonly #secureContext: () => boolean;
  readonly #topLevelContext: () => boolean;
  readonly #listeners = new Set<(descriptors: readonly SolanaWalletDescriptor[]) => void>();
  readonly #ids = new WeakMap<Wallet, string>();
  #nextId = 1;
  #started = false;
  #offRegister: (() => void) | null = null;
  #offUnregister: (() => void) | null = null;
  #selected = new Map<string, SelectedSolanaWallet>();

  constructor(options: SolanaWalletDiscoveryOptions = {}) {
    this.#registry = options.wallets ?? getWallets();
    this.#secureContext = options.secureContext ?? browserIsSecure;
    this.#topLevelContext = options.topLevelContext ?? browserIsTopLevel;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    if (!this.#allowedContext()) return;
    this.#offRegister = this.#registry.on('register', () => this.#refresh(true));
    this.#offUnregister = this.#registry.on('unregister', () => this.#refresh(true));
    this.#refresh(true);
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    try {
      this.#offRegister?.();
    } catch {
      // Discovery authorization is already cleared.
    }
    try {
      this.#offUnregister?.();
    } catch {
      // Discovery authorization is already cleared.
    }
    this.#offRegister = null;
    this.#offUnregister = null;
    this.#selected.clear();
  }

  list(): readonly SolanaWalletDescriptor[] {
    if (!this.#started || !this.#allowedContext()) return Object.freeze([]);
    return this.#refresh(false);
  }

  select(selectionId: string): SelectedSolanaWallet | null {
    if (!this.#started || !/^[a-z0-9:-]{1,80}$/u.test(selectionId)) return null;
    this.#refresh(false);
    return this.#selected.get(selectionId) ?? null;
  }

  subscribe(listener: (descriptors: readonly SolanaWalletDescriptor[]) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('wallet listener must be a function');
    this.#listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
    };
  }

  #allowedContext(): boolean {
    try {
      return this.#secureContext() && this.#topLevelContext();
    } catch {
      return false;
    }
  }

  #id(wallet: Wallet): string {
    let id = this.#ids.get(wallet);
    if (id === undefined) {
      id = `phantom:${this.#nextId}`;
      this.#nextId += 1;
      this.#ids.set(wallet, id);
    }
    return id;
  }

  #readRegistry(): readonly Wallet[] {
    try {
      return this.#registry.get();
    } catch {
      return [];
    }
  }

  #refresh(emit: boolean): readonly SolanaWalletDescriptor[] {
    const next = new Map<string, SelectedSolanaWallet>();
    if (this.#allowedContext()) {
      for (const wallet of this.#readRegistry()) {
        if (!compatiblePhantom(wallet)) continue;
        const versions = supportedTransactionVersions(wallet);
        if (versions === null) continue;
        const selectionId = this.#id(wallet);
        const descriptor = Object.freeze({
          selectionId,
          displayName: 'Phantom' as const,
          supportedTransactionVersions: versions,
        });
        next.set(selectionId, Object.freeze({ descriptor, wallet }));
      }
    }
    this.#selected = next;
    const descriptors = Object.freeze([...next.values()].map(({ descriptor }) => descriptor));
    if (emit) {
      for (const listener of [...this.#listeners]) {
        try {
          listener(descriptors);
        } catch {
          // One presentation listener cannot break discovery lifecycle.
        }
      }
    }
    return descriptors;
  }
}
