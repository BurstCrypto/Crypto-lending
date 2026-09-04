import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductionPlatformDirectory } from '../components/platforms/production-platform-directory';
import { AuthenticationUnauthenticatedError, type AccountProfile } from '../lib/authentication';
import { SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS } from '../lib/browser/use-sensitive-view-revalidation';
import { parseMainnetPlatformDirectory } from '../lib/platforms/mainnet-platform-directory';
import { MainnetPlatformsApiError } from '../lib/platforms/mainnet-platforms-client';
import { MAINNET_PLATFORM_DIRECTORY_RESPONSE } from './fixtures/mainnet-platforms';

const DIRECTORY = parseMainnetPlatformDirectory(MAINNET_PLATFORM_DIRECTORY_RESPONSE);
const PROFILE: AccountProfile = Object.freeze({
  accountId: '0f27af0b-48b2-4f1b-b3d4-cd531a0b4458',
  contactEmail: 'platforms@example.com',
  contactPhone: null,
  declaredResidencyCountryCode: 'US',
  eligibilityStatus: 'UNKNOWN',
  version: 1,
  createdAt: '2026-08-20T16:00:00.000Z',
  updatedAt: '2026-08-20T16:01:00.000Z',
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function dependencies(input: {
  navigate?: (path: string) => void;
  readDirectory: (signal?: AbortSignal) => Promise<typeof DIRECTORY>;
  restoreSession: (options: { readonly signal?: AbortSignal }) => Promise<AccountProfile>;
}) {
  return {
    createClient: () => ({ readDirectory: input.readDirectory }),
    navigate: input.navigate ?? vi.fn(),
    restoreSession: input.restoreSession,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('authenticated production platform directory', () => {
  it('keeps provider information hidden until the managed session is verified', async () => {
    const pendingSession = deferred<AccountProfile>();
    const pendingDirectory = deferred<typeof DIRECTORY>();
    const readDirectory = vi.fn(() => pendingDirectory.promise);
    render(
      <ProductionPlatformDirectory
        dependencies={dependencies({
          readDirectory,
          restoreSession: () => pendingSession.promise,
        })}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Loading the platform directory' }),
    ).toBeVisible();
    expect(screen.queryByText('Aave')).not.toBeInTheDocument();
    expect(readDirectory).not.toHaveBeenCalled();

    pendingSession.resolve(PROFILE);
    await waitFor(() => expect(readDirectory).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Aave')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Loading the platform directory' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

    pendingDirectory.resolve(DIRECTORY);
    expect(await screen.findByText('10 platforms under evaluation')).toBeVisible();
  });

  it('renders ten Ethereum and Solana planning cards without any transaction control', async () => {
    render(
      <ProductionPlatformDirectory
        dependencies={dependencies({
          readDirectory: async () => DIRECTORY,
          restoreSession: async () => PROFILE,
        })}
      />,
    );

    expect(await screen.findByText('10 platforms under evaluation')).toBeVisible();
    expect(screen.getByText('0 available now')).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(10);
    const aaveCard = screen.getByRole('heading', { level: 3, name: 'Aave' }).closest('article');
    expect(aaveCard).not.toBeNull();
    expect(within(aaveCard!).getAllByText('Ethereum')).toHaveLength(2);
    expect(within(aaveCard!).getByText('Not assessed')).toBeVisible();
    expect(screen.getAllByText('Planned')).toHaveLength(10);
    expect(screen.getAllByText('Unavailable')).toHaveLength(10);
    expect(screen.queryByText('Base')).toBeNull();
    expect(screen.queryByText('BNB Smart Chain')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('replace-redirects an unverified session to the fixed platforms login path', async () => {
    const navigate = vi.fn();
    const readDirectory = vi.fn(async () => DIRECTORY);
    render(
      <ProductionPlatformDirectory
        dependencies={dependencies({
          navigate,
          readDirectory,
          restoreSession: async () => {
            throw new AuthenticationUnauthenticatedError();
          },
        })}
      />,
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login?returnTo=%2Fplatforms'));
    expect(readDirectory).not.toHaveBeenCalled();
    expect(screen.queryByText('Aave')).not.toBeInTheDocument();
  });

  it('clears provider cards if the directory endpoint reports an expired session', async () => {
    const navigate = vi.fn();
    render(
      <ProductionPlatformDirectory
        dependencies={dependencies({
          navigate,
          readDirectory: async () => {
            throw new MainnetPlatformsApiError('UNAUTHENTICATED');
          },
          restoreSession: async () => PROFILE,
        })}
      />,
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login?returnTo=%2Fplatforms'));
    expect(screen.queryByText('Aave')).not.toBeInTheDocument();
  });

  it('shows a retry action only for a failed read and reloads from session verification', async () => {
    const readDirectory = vi
      .fn<() => Promise<typeof DIRECTORY>>()
      .mockRejectedValueOnce(new MainnetPlatformsApiError('UNAVAILABLE'))
      .mockResolvedValueOnce(DIRECTORY);
    const restoreSession = vi.fn(async () => PROFILE);
    render(
      <ProductionPlatformDirectory
        dependencies={dependencies({ readDirectory, restoreSession })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Platform directory is unavailable' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('10 platforms under evaluation')).toBeVisible();
    expect(restoreSession).toHaveBeenCalledTimes(2);
    expect(readDirectory).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides provider cards immediately and coalesces visible, focus, and reconnect events', async () => {
    const refreshed = deferred<typeof DIRECTORY>();
    const signals: AbortSignal[] = [];
    const readDirectory = vi.fn((signal?: AbortSignal) => {
      if (signal !== undefined) signals.push(signal);
      return signals.length === 1 ? Promise.resolve(DIRECTORY) : refreshed.promise;
    });
    const restoreSession = vi.fn(async () => PROFILE);
    render(
      <ProductionPlatformDirectory
        dependencies={dependencies({ readDirectory, restoreSession })}
      />,
    );
    expect(await screen.findByText('10 platforms under evaluation')).toBeVisible();
    vi.useFakeTimers();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(readDirectory).toHaveBeenCalledOnce();
    expect(screen.queryByText('Aave')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Loading the platform directory' }),
    ).toBeVisible();

    await act(async () => {
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      await Promise.resolve();
    });
    expect(readDirectory).toHaveBeenCalledTimes(2);
    expect(restoreSession).toHaveBeenCalledTimes(2);

    await act(async () => {
      refreshed.resolve(DIRECTORY);
      await Promise.resolve();
    });
    expect(screen.getByText('10 platforms under evaluation')).toBeVisible();
  });
});
