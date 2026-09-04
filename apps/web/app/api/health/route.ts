import { ApplicationIdentityConfigurationError, getApplicationVersion } from '@/lib/application';

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
      status: 'ok',
      version,
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
      status: 200,
    },
  );
}
