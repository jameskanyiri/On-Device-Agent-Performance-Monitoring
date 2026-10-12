import { benchStatus } from '@/server/bench';
import { respond } from '@/server/http';
import { sessionDetail } from '@/server/store';

export async function GET(_request: Request, ctx: RouteContext<'/api/sessions/[id]'>) {
  const { id } = await ctx.params;
  return respond(() => {
    const detail = sessionDetail(id);
    // While this eval is running: the run on the phone now (shown as in progress).
    const bench = benchStatus();
    const live = bench.active && bench.session?.sessionId === id ? bench.session : null;
    return { ...detail, now: Date.now(), running: !!live, inFlight: live?.inFlight?.jobId ?? null };
  });
}
