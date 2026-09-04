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
 * Invalidation is synchronous; refreshes are trailing-throttled to one request per event burst.
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

    function queueRevalidation(): void {
      if (pendingTimer !== null) return;

      callbacksReference.current.invalidate();
      pendingTimer = window.setTimeout(
        () => {
          pendingTimer = null;
          callbacksReference.current.revalidate();
        },
        Math.max(0, throttleMs),
      );
    }

    function revalidateVisibleDocument(): void {
      if (document.visibilityState === 'visible') queueRevalidation();
    }

    window.addEventListener('focus', queueRevalidation);
    window.addEventListener('online', queueRevalidation);
    window.addEventListener('pageshow', queueRevalidation);
    document.addEventListener('visibilitychange', revalidateVisibleDocument);

    return () => {
      window.removeEventListener('focus', queueRevalidation);
      window.removeEventListener('online', queueRevalidation);
      window.removeEventListener('pageshow', queueRevalidation);
      document.removeEventListener('visibilitychange', revalidateVisibleDocument);
      if (pendingTimer !== null) window.clearTimeout(pendingTimer);
    };
  }, [enabled, throttleMs]);
}
