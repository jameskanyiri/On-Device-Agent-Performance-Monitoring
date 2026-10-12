import { respond } from '@/server/http';
import { sessionDetail } from '@/server/store';

export async function GET(_request: Request, ctx: RouteContext<'/api/sessions/[id]'>) {
  const { id } = await ctx.params;
  return respond(() => sessionDetail(id));
}
