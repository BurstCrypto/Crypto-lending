import { createSupportedEvmNetworks, type EvmNetworkDefinition } from './networks';
import { isEip1193Provider, type Eip1193Provider } from './provider';

export const EIP6963_ANNOUNCE_PROVIDER = 'eip6963:announceProvider';
export const EIP6963_REQUEST_PROVIDER = 'eip6963:requestProvider';

export type InjectedEvmConnectorId = 'metamask' | 'coinbase';

export interface InjectedProviderDescriptor {
  /** Opaque application ID used for an explicit selection gesture. */
  readonly selectionId: string;
  readonly connectorId: InjectedEvmConnectorId;
  /** Application-owned label; announced provider names are not trusted. */
  readonly displayName: 'MetaMask' | 'Coinbase Wallet';
  readonly supportedNetworks: readonly EvmNetworkDefinition[];
}

interface Eip6963ProviderInfo {
  readonly uuid: string;
  readonly name: string;
  readonly icon: string;
  readonly rdns: string;
}

interface ProviderEntry {
  readonly eip6963Uuid: string;
  readonly descriptor: InjectedProviderDescriptor;
  readonly provider: Eip1193Provider;
}

export interface Eip6963EventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatchEvent(event: Event): boolean;
}

export interface Eip6963DiscoveryOptions {
  readonly target?: Eip6963EventTarget | null;
  readonly supportedNetworks: readonly EvmNetworkDefinition[];
  readonly createSelectionId?: () => string;
  readonly createRequestEvent?: () => Event;
}

export interface SelectedEip1193Provider {
  readonly descriptor: InjectedProviderDescriptor;
  /** Connector-infrastructure capability. Never expose it to product state. */
  readonly provider: Eip1193Provider;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SELECTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const MAX_ANNOUNCED_TEXT = 512;

function dataProperty(record: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function eventDetail(event: Event): unknown {
  try {
    return (event as CustomEvent<unknown>).detail;
  } catch {
    return undefined;
  }
}

function connectorMetadata(
  rdns: string,
): Pick<InjectedProviderDescriptor, 'connectorId' | 'displayName'> | null {
  if (rdns === 'io.metamask') return { connectorId: 'metamask', displayName: 'MetaMask' };
  if (rdns === 'com.coinbase.wallet') {
    return { connectorId: 'coinbase', displayName: 'Coinbase Wallet' };
  }
  return null;
}

function parseProviderInfo(value: unknown): Eip6963ProviderInfo | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const uuid = dataProperty(value, 'uuid');
  const name = dataProperty(value, 'name');
  const icon = dataProperty(value, 'icon');
  const rdns = dataProperty(value, 'rdns');
  if (
    typeof uuid !== 'string' ||
    !UUID_V4.test(uuid) ||
    typeof name !== 'string' ||
    name.length < 1 ||
    name.length > MAX_ANNOUNCED_TEXT ||
    typeof icon !== 'string' ||
    icon.length < 1 ||
    icon.length > 16_384 ||
    typeof rdns !== 'string' ||
    connectorMetadata(rdns) === null
  ) {
    return null;
  }
  return { uuid: uuid.toLowerCase(), name, icon, rdns };
}

function parseAnnouncement(
  event: Event,
): { info: Eip6963ProviderInfo; provider: Eip1193Provider } | null {
  const detail = eventDetail(event);
  if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) return null;
  const info = parseProviderInfo(dataProperty(detail, 'info'));
  const provider = dataProperty(detail, 'provider');
  return info !== null && isEip1193Provider(provider) ? { info, provider } : null;
}

function defaultSelectionId(): string {
  return globalThis.crypto.randomUUID();
}

function defaultRequestEvent(): Event {
  return new Event(EIP6963_REQUEST_PROVIDER);
}

/**
 * Discovers injected providers without reading `window.ethereum`. Announcements
 * are observations only: callers must pass a descriptor's selectionId back to
 * `select` before a provider capability can be used.
 */
export class Eip6963ProviderDiscovery {
  readonly #target: Eip6963EventTarget | null;
  readonly #supportedNetworks: readonly EvmNetworkDefinition[];
  readonly #createSelectionId: () => string;
  readonly #createRequestEvent: () => Event;
  readonly #entries = new Map<string, ProviderEntry>();
  readonly #listeners = new Set<(providers: readonly InjectedProviderDescriptor[]) => void>();
  #started = false;

  readonly #onAnnouncement: EventListener = (event) => {
    const announcement = parseAnnouncement(event);
    if (announcement === null || this.#entries.has(announcement.info.uuid)) return;
    if ([...this.#entries.values()].some((entry) => entry.provider === announcement.provider)) {
      return;
    }

    let selectionId: string;
    try {
      selectionId = this.#createSelectionId();
    } catch {
      return;
    }
    if (
      !SELECTION_ID.test(selectionId) ||
      [...this.#entries.values()].some((entry) => entry.descriptor.selectionId === selectionId)
    ) {
      return;
    }

    const metadata = connectorMetadata(announcement.info.rdns);
    if (metadata === null) return;
    const descriptor = Object.freeze({
      selectionId,
      ...metadata,
      supportedNetworks: this.#supportedNetworks,
    });
    this.#entries.set(announcement.info.uuid, {
      eip6963Uuid: announcement.info.uuid,
      descriptor,
      provider: announcement.provider,
    });
    this.#notify();
  };

  constructor(options: Eip6963DiscoveryOptions) {
    this.#target =
      options.target === undefined
        ? typeof window === 'undefined'
          ? null
          : window
        : options.target;
    this.#supportedNetworks = createSupportedEvmNetworks(options.supportedNetworks);
    this.#createSelectionId = options.createSelectionId ?? defaultSelectionId;
    this.#createRequestEvent = options.createRequestEvent ?? defaultRequestEvent;
  }

  start(): void {
    if (this.#started || this.#target === null) return;
    this.#started = true;
    this.#target.addEventListener(EIP6963_ANNOUNCE_PROVIDER, this.#onAnnouncement);
    this.#target.dispatchEvent(this.#createRequestEvent());
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#target?.removeEventListener(EIP6963_ANNOUNCE_PROVIDER, this.#onAnnouncement);
    this.#entries.clear();
    this.#notify();
  }

  list(): readonly InjectedProviderDescriptor[] {
    return Object.freeze([...this.#entries.values()].map(({ descriptor }) => descriptor));
  }

  subscribe(listener: (providers: readonly InjectedProviderDescriptor[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Resolves only the exact observation chosen by the user. */
  select(selectionId: string): SelectedEip1193Provider | null {
    const entry = [...this.#entries.values()].find(
      ({ descriptor }) => descriptor.selectionId === selectionId,
    );
    return entry === undefined
      ? null
      : Object.freeze({ descriptor: entry.descriptor, provider: entry.provider });
  }

  #notify(): void {
    const snapshot = this.list();
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // Provider discovery must not surface consumer exceptions or vendor data.
      }
    }
  }
}
