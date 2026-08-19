import { describe, expect, it, vi } from 'vitest';
import type { Connector } from 'wagmi';

import { subscribeWalletConnectDisplayUri } from './display-uri';

function walletConnectConnector(
  identity: Readonly<{ id: string; type: string }> = {
    id: 'walletConnect',
    type: 'walletConnect',
  },
) {
  let listener: ((message: { type: string; data?: unknown }) => void) | undefined;
  const emitter = {
    on: vi.fn((_event: string, nextListener: typeof listener) => {
      listener = nextListener;
    }),
    off: vi.fn((_event: string, removedListener: typeof listener) => {
      if (listener === removedListener) listener = undefined;
    }),
  };
  const connector = {
    ...identity,
    emitter,
  } as unknown as Connector;

  return {
    connector,
    emitter,
    emit(message: { type: string; data?: unknown }) {
      listener?.(message);
    },
  };
}

describe('subscribeWalletConnectDisplayUri', () => {
  it('forwards only WalletConnect pairing URIs and unsubscribes idempotently', () => {
    const fixture = walletConnectConnector();
    const onDisplayUri = vi.fn();
    const subscription = subscribeWalletConnectDisplayUri(
      [fixture.connector],
      { enabled: true },
      onDisplayUri,
    );

    expect(subscription.available).toBe(true);
    fixture.emit({ type: 'display_uri', data: 'https://example.test/not-walletconnect' });
    fixture.emit({ type: 'other', data: 'wc:ignored' });
    fixture.emit({ type: 'display_uri', data: 'wc:pairing-uri' });
    expect(onDisplayUri).toHaveBeenCalledOnce();
    expect(onDisplayUri).toHaveBeenCalledWith('wc:pairing-uri');

    if (!subscription.available) throw new Error('Expected an active subscription');

    subscription.unsubscribe();
    subscription.unsubscribe();
    fixture.emit({ type: 'display_uri', data: 'wc:after-unsubscribe' });
    expect(fixture.emitter.off).toHaveBeenCalledOnce();
    expect(onDisplayUri).toHaveBeenCalledOnce();
  });

  it('reports WalletConnect unavailability without touching an emitter', () => {
    expect(
      subscribeWalletConnectDisplayUri(
        [],
        { enabled: false, reason: 'walletconnect-project-id-missing' },
        vi.fn(),
      ),
    ).toEqual({
      available: false,
      reason: 'walletconnect-project-id-missing',
    });
  });

  it('does not subscribe to connectors that spoof only one WalletConnect identity field', () => {
    const idOnly = walletConnectConnector({ id: 'walletConnect', type: 'injected' });
    const typeOnly = walletConnectConnector({ id: 'injected', type: 'walletConnect' });

    expect(
      subscribeWalletConnectDisplayUri(
        [idOnly.connector, typeOnly.connector],
        { enabled: true },
        vi.fn(),
      ),
    ).toEqual({
      available: false,
      reason: 'walletconnect-connector-unavailable',
    });
    expect(idOnly.emitter.on).not.toHaveBeenCalled();
    expect(typeOnly.emitter.on).not.toHaveBeenCalled();
  });
});
