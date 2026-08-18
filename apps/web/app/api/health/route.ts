import { getApplicationVersion } from '@/lib/application';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    {
      service: 'web',
      status: 'ok',
      version: getApplicationVersion(),
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
