import type { NextRequest } from 'next/server';

import { nextJob } from '@/server/bench';

// Phone → next benchmark job (src/bench/client.ts in the app).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const { status, body } = nextJob(params.get('launch') ?? '', params.get('client') ?? '');
  return status === 204 ? new Response(null, { status }) : Response.json(body, { status });
}
