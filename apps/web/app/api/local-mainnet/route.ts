import { isLocalMainnetRequest, localMainnetConfig } from '@/lib/local-mainnet/config.server';
import { GET as read, POST as write } from '../mainnet/route';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  if (!localMainnetConfig() || !isLocalMainnetRequest(request, false))
    return new Response(null, { status: 404 });
  return read(request);
}
export async function POST(request: Request) {
  if (!localMainnetConfig() || !isLocalMainnetRequest(request, true))
    return new Response(null, { status: 404 });
  return write(request);
}
