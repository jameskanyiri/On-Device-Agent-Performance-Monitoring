import { respond } from '@/server/http';
import { runDetail } from '@/server/store';

export async function GET(_request: Request, ctx: RouteContext<'/api/sessions/[id]/runs/[job]'>) {
  const { id, job } = await ctx.params;
  return respond(() => runDetail(id, job));
}
