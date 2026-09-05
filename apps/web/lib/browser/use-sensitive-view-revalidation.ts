'use client';

import { useCallback, useEffect, useRef } from 'react';

export const SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS = 200;

export interface SensitiveViewRevalidationOptions {
  /** Immediately hide or mark the currently rendered data as stale. */
  readonly invalidate: () => void;
  /** Start a fresh read after lifecycle events in the throttle window are coalesced. */
  readonly revalidate: () => void;
  readonly enabled?: boolean;
  readonly throttleMs?: number;
}

export type SensitiveViewActivityCheck = () => boolean;

/**
 * Revalidates sensitive browser views after lifecycle transitions that can outlive a session.
 * Invalidation is synchronous. Backgrounded pages stay invalid, while visible refreshes are
 * trailing-throttled to one request per event burst. The returned stable check must guard every
 * effect that begins a sensitive read.
 */
export function useSensitiveViewRevalidation({
  invalidate,
  revalidate,
  enabled = true,
  throttleMs = SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS,
}: SensitiveViewRevalidationOptions): SensitiveViewActivityCheck {
  const callbacksReference = useRef({ invalidate, revalidate });
  const activeReference = useRef(false);
  const isActive = useCallback((): boolean => activeReference.current, []);

  useEffect(() => {
    callbacksReference.current = { invalidate, revalidate };
  }, [invalidate, revalidate]);

  useEffect(() => {
    if (!enabled) {
      activeReference.current = false;
      return;
    }

    let pendingTimer: number | null = null;
    let invalidatedSinceLastRefresh = false;
    let pageInactive = false;
    activeReference.current = document.visibilityState === 'visible';

    function cancelPendingRefresh(): void {
      if (pendingTimer === null) return;
      window.clearTimeout(pendingTimer);
      pendingTimer = null;
    }

    function invalidateWithoutRefresh(): void {
      activeReference.current = false;
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

      activeReference.current = false;
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
          activeReference.current = true;
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
    if (!activeReference.current) invalidateWithoutRefresh();

    return () => {
      activeReference.current = false;
      window.removeEventListener('focus', queueVisibleRevalidation);
      window.removeEventListener('online', queueVisibleRevalidation);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancelPendingRefresh();
    };
  }, [enabled, throttleMs]);

  return isActive;
}
