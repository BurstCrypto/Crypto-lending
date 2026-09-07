import { ApplicationIdentityConfigurationError, getApplicationVersion } from '@/lib/application';
import { readCanonicalAuthenticationPublicOrigin } from '@/lib/authentication/public-origin.server';

export const dynamic = 'force-dynamic';

function unavailableResponse(): Response {
  return Response.json(
    { service: 'web', status: 'unavailable' },
    { headers: { 'Cache-Control': 'no-store' }, status: 503 },
  );
}

export function GET() {
  let version: string;
  try {
    version = getApplicationVersion();
  } catch (error) {
    if (!(error instanceof ApplicationIdentityConfigurationError)) throw error;
    return unavailableResponse();
  }
  if (readCanonicalAuthenticationPublicOrigin(process.env) === null) return unavailableResponse();

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
