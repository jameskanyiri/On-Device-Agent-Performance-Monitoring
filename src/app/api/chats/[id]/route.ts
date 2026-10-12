import { respond } from '@/server/http';
import { chatDetail } from '@/server/store';

export async function GET(_request: Request, ctx: RouteContext<'/api/chats/[id]'>) {
  const { id } = await ctx.params;
  return respond(() => chatDetail(id));
}
