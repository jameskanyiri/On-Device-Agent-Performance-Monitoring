import { respond } from '@/server/http';
import { recordBeat } from '@/server/store';
import type { LiveBeat } from '@/shared/trace';

// Phone → heartbeat while something runs (src/observe/collector.ts in the app).
export async function POST(request: Request) {
  return respond(async () => {
    recordBeat((await request.json()) as LiveBeat);
    return { ok: true };
  });
}
