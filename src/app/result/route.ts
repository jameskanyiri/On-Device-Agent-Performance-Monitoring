import { submitResult } from '@/server/bench';
import { respond } from '@/server/http';
import type { RunResult } from '@/shared/protocol';

// Phone → a finished benchmark run.
export async function POST(request: Request) {
  return respond(async () => ({ ok: true, ...submitResult((await request.json()) as RunResult) }));
}
