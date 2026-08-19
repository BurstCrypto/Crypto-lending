import { createPhantomSolanaAdapter } from './adapter';
import {
  PhantomSolanaAdapterError,
  type PhantomSolanaAdapter,
  type PhantomSolanaAdapterLifecycle,
  type PhantomSolanaAdapterOptions,
} from './types';

/**
 * Owns a shared adapter through effect leases. Final release is deferred one microtask so React
 * StrictMode's development-only setup -> cleanup -> setup replay reuses the live adapter without
 * duplicating Wallet Standard listeners. A genuine unmount still destroys it promptly.
 */
export function createPhantomSolanaAdapterLifecycle(
  options: PhantomSolanaAdapterOptions = {},
): PhantomSolanaAdapterLifecycle {
  let adapter: PhantomSolanaAdapter | null = null;
  let activeLeases = 0;
  let generation = 0;
  let disposed = false;

  return {
    acquire() {
      if (disposed) {
        throw new PhantomSolanaAdapterError(
          'adapter_destroyed',
          'The wallet adapter lifecycle has been disposed.',
          false,
        );
      }
      generation += 1;
      activeLeases += 1;
      adapter ??= createPhantomSolanaAdapter(options);
      const leasedAdapter = adapter;
      let released = false;

      return {
        adapter: leasedAdapter,
        release: () => {
          if (released) return;
          released = true;
          if (disposed) return;
          activeLeases = Math.max(0, activeLeases - 1);
          const releaseGeneration = ++generation;
          queueMicrotask(() => {
            if (
              !disposed &&
              activeLeases === 0 &&
              generation === releaseGeneration &&
              adapter === leasedAdapter
            ) {
              leasedAdapter.destroy();
              adapter = null;
            }
          });
        },
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      activeLeases = 0;
      adapter?.destroy();
      adapter = null;
    },
  };
}
