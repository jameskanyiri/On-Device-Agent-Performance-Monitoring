import { respond } from '@/server/http';
import { recordTrace } from '@/server/store';
import type { Trace } from '@/shared/trace';

// Phone → a finished chat trace (reply or model load).
export async function POST(request: Request) {
  return respond(async () => {
    recordTrace((await request.json()) as Trace);
    return { ok: true };
  });
}
