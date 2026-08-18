import { getApplicationVersion } from '@/lib/application';

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
