import type { Instrumentation } from 'next';

/** Next also bundles instrumentation for Edge; application routes are Node-only. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { registerWebNodeRuntime } = await import('./lib/logging/web-runtime.server');
    registerWebNodeRuntime();
  } catch {
    // Instrumentation must not expose module/runtime details through a second failure.
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
): Promise<void> => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { recordWebRequestFailure } = await import('./lib/logging/web-runtime.server');
    recordWebRequestFailure(error, request, context);
  } catch {
    // Request behavior must not depend on diagnostic construction or delivery.
  }
};
