import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS,
  useSensitiveViewRevalidation,
} from '../lib/browser/use-sensitive-view-revalidation';

interface HarnessProps {
  readonly invalidate: () => void;
  readonly revalidate: () => void;
}

function Harness({ invalidate, revalidate }: HarnessProps) {
  useSensitiveViewRevalidation({ invalidate, revalidate });
  return null;
}

function dispatchPageShow(persisted: boolean): void {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useSensitiveViewRevalidation', () => {
  it.each([
    ['window focus', () => window.dispatchEvent(new Event('focus'))],
    ['reconnect', () => window.dispatchEvent(new Event('online'))],
    ['ordinary pageshow', () => dispatchPageShow(false)],
    ['bfcache pageshow', () => dispatchPageShow(true)],
  ])('invalidates immediately and queues one read after %s', (_name, dispatchLifecycleEvent) => {
    vi.useFakeTimers();
    const invalidate = vi.fn();
    const revalidate = vi.fn();
    render(<Harness invalidate={invalidate} revalidate={revalidate} />);

    act(() => dispatchLifecycleEvent());

    expect(invalidate).toHaveBeenCalledOnce();
    expect(revalidate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS));

    expect(revalidate).toHaveBeenCalledOnce();
  });

  it('invalidates while hidden and refreshes only after the document becomes visible', () => {
    vi.useFakeTimers();
    const invalidate = vi.fn();
    const revalidate = vi.fn();
    render(<Harness invalidate={invalidate} revalidate={revalidate} />);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(invalidate).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS));
    expect(revalidate).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(invalidate).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS));
    expect(revalidate).toHaveBeenCalledOnce();
  });

  it('cancels a queued refresh on pagehide and resumes once the page is shown', () => {
    vi.useFakeTimers();
    const invalidate = vi.fn();
    const revalidate = vi.fn();
    render(<Harness invalidate={invalidate} revalidate={revalidate} />);

    act(() => window.dispatchEvent(new Event('focus')));
    expect(invalidate).toHaveBeenCalledOnce();

    act(() => window.dispatchEvent(new Event('pagehide')));
    act(() => vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS));

    expect(invalidate).toHaveBeenCalledOnce();
    expect(revalidate).not.toHaveBeenCalled();

    act(() => dispatchPageShow(true));
    expect(invalidate).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS));
    expect(revalidate).toHaveBeenCalledOnce();
  });

  it('does not refresh a hidden document after connectivity returns', () => {
    vi.useFakeTimers();
    const invalidate = vi.fn();
    const revalidate = vi.fn();
    render(<Harness invalidate={invalidate} revalidate={revalidate} />);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    act(() => window.dispatchEvent(new Event('online')));
    act(() => vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS));

    expect(invalidate).toHaveBeenCalledOnce();
    expect(revalidate).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS));

    expect(invalidate).toHaveBeenCalledOnce();
    expect(revalidate).toHaveBeenCalledOnce();
  });

  it('stays invalid after pagehide until both pageshow and visible state are observed', () => {
    vi.useFakeTimers();
    const invalidate = vi.fn();
    const revalidate = vi.fn();
    render(<Harness invalidate={invalidate} revalidate={revalidate} />);

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
    });

    expect(document.visibilityState).toBe('visible');
    expect(invalidate).toHaveBeenCalledOnce();
    expect(revalidate).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    act(() => {
      dispatchPageShow(true);
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
    });

    expect(invalidate).toHaveBeenCalledOnce();
    expect(revalidate).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS));

    expect(invalidate).toHaveBeenCalledOnce();
    expect(revalidate).toHaveBeenCalledOnce();
  });

  it('coalesces an event burst and removes listeners and its pending timer on unmount', () => {
    vi.useFakeTimers();
    const invalidate = vi.fn();
    const revalidate = vi.fn();
    const view = render(<Harness invalidate={invalidate} revalidate={revalidate} />);

    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('pagehide'));
      dispatchPageShow(true);
    });

    expect(invalidate).toHaveBeenCalledOnce();
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(SENSITIVE_VIEW_REVALIDATION_THROTTLE_MS);
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      dispatchPageShow(true);
    });

    expect(invalidate).toHaveBeenCalledOnce();
    expect(revalidate).not.toHaveBeenCalled();
  });
});
