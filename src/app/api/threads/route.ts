import type { NextRequest } from 'next/server';

import { respond } from '@/server/http';
import { threadDetail } from '@/server/store';

// GET /api/threads?device=…&thread=…  or  ?device=…&trace=…  (the trace's whole thread)
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  return respond(() => threadDetail(q.get('device') ?? '', q.get('thread'), q.get('trace')));
}
