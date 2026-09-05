'use client';

import { useEffect, useRef } from 'react';

export const SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS = 200;

export interface SensitiveViewRevalidationOptions {
  /** Immediately hide or mark the currently rendered data as stale. */
  readonly invalidate: () => void;
  /** Start a fresh read after lifecycle events in the throttle window are coalesced. */
  readonly revalidate: () => void;
  readonly enabled?: boolean;
  readonly throttleMs?: number;
}

/**
 * Revalidates sensitive browser views after lifecycle transitions that can outlive a session.
 * Invalidation is synchronous. Backgrounded pages stay invalid, while visible refreshes are
 * trailing-throttled to one request per event burst.
 */
export function useSensitiveViewRevalidation({
  invalidate,
  revalidate,
  enabled = true,
  throttleMs = SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS,
}: SensitiveViewRevalidationOptions): void {
  const callbacksReference = useRef({ invalidate, revalidate });

  useEffect(() => {
    callbacksReference.current = { invalidate, revalidate };
  }, [invalidate, revalidate]);

  useEffect(() => {
    if (!enabled) return;

    let pendingTimer: number | null = null;
    let invalidatedSinceLastRefresh = false;
    let pageInactive = false;

    function cancelPendingRefresh(): void {
      if (pendingTimer === null) return;
      window.clearTimeout(pendingTimer);
      pendingTimer = null;
    }

    function invalidateWithoutRefresh(): void {
      cancelPendingRefresh();
      if (invalidatedSinceLastRefresh) return;
      invalidatedSinceLastRefresh = true;
      callbacksReference.current.invalidate();
    }

    function queueVisibleRevalidation(): void {
      if (pageInactive || document.visibilityState !== 'visible') {
        invalidateWithoutRefresh();
        return;
      }
      if (pendingTimer !== null) return;

      if (!invalidatedSinceLastRefresh) {
        invalidatedSinceLastRefresh = true;
        callbacksReference.current.invalidate();
      }
      pendingTimer = window.setTimeout(
        () => {
          pendingTimer = null;
          if (pageInactive || document.visibilityState !== 'visible') {
            invalidateWithoutRefresh();
            return;
          }
          invalidatedSinceLastRefresh = false;
          callbacksReference.current.revalidate();
        },
        Math.max(0, throttleMs),
      );
    }

    function handleVisibilityChange(): void {
      if (!pageInactive && document.visibilityState === 'visible') {
        queueVisibleRevalidation();
        return;
      }
      invalidateWithoutRefresh();
    }

    function handlePageHide(): void {
      pageInactive = true;
      invalidateWithoutRefresh();
    }

    function handlePageShow(): void {
      pageInactive = false;
      queueVisibleRevalidation();
    }

    window.addEventListener('focus', queueVisibleRevalidation);
    window.addEventListener('online', queueVisibleRevalidation);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', queueVisibleRevalidation);
      window.removeEventListener('online', queueVisibleRevalidation);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancelPendingRefresh();
    };
  }, [enabled, throttleMs]);
}
