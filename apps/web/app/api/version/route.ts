import { ApplicationIdentityConfigurationError, getApplicationVersion } from '@/lib/application';

// The deployment supplies APP_VERSION at container runtime rather than image
// build time. The response's cache policy provides bounded reuse downstream.
export const dynamic = 'force-dynamic';

export function GET() {
  let version: string;
  try {
    version = getApplicationVersion();
  } catch (error) {
    if (!(error instanceof ApplicationIdentityConfigurationError)) throw error;
    return Response.json(
      { service: 'web', status: 'unavailable' },
      { headers: { 'Cache-Control': 'no-store' }, status: 503 },
    );
  }
  return Response.json(
    {
      service: 'web',
      version,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
      status: 200,
    },
  );
}
