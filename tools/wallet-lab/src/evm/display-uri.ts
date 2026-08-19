import type { Connector } from 'wagmi';

import type { EvmConnectorUnavailableReason } from './runtime-env';
import { isWalletConnectConnector } from './walletconnect-session';

export type WalletConnectDisplayUriUnavailableReason =
  EvmConnectorUnavailableReason | 'walletconnect-connector-unavailable';

export type WalletConnectDisplayUriSubscription =
  | Readonly<{ available: true; unsubscribe: () => void }>
  | Readonly<{ available: false; reason: WalletConnectDisplayUriUnavailableReason }>;

type WalletConnectAvailability =
  | Readonly<{ enabled: true }>
  | Readonly<{
      enabled: false;
      reason: EvmConnectorUnavailableReason;
    }>;

/**
 * Subscribe before invoking Wagmi's connect action. Pairing URIs are ephemeral
 * bearer material: the helper deliberately does not log or persist them.
 */
export function subscribeWalletConnectDisplayUri(
  connectors: readonly Connector[],
  availability: WalletConnectAvailability,
  onDisplayUri: (uri: string) => void,
): WalletConnectDisplayUriSubscription {
  if (!availability.enabled) {
    return Object.freeze({ available: false, reason: availability.reason });
  }

  const connector = connectors.find(isWalletConnectConnector);

  if (!connector) {
    return Object.freeze({
      available: false,
      reason: 'walletconnect-connector-unavailable',
    });
  }

  const listener = (message: { type: string; data?: unknown }) => {
    if (
      message.type === 'display_uri' &&
      typeof message.data === 'string' &&
      message.data.startsWith('wc:')
    ) {
      onDisplayUri(message.data);
    }
  };

  connector.emitter.on('message', listener);

  let subscribed = true;

  return Object.freeze({
    available: true,
    unsubscribe() {
      if (!subscribed) return;

      subscribed = false;
      connector.emitter.off('message', listener);
    },
  });
}
