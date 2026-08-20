import { getApplicationVersion } from '@/lib/application';

// The deployment supplies APP_VERSION at container runtime rather than image
// build time. The response's cache policy provides bounded reuse downstream.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    {
      service: 'web',
      version: getApplicationVersion(),
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      },
      status: 200,
    },
  );
}
