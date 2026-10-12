import { respond } from '@/server/http';
import { deviceDetail } from '@/server/store';

export async function GET(_request: Request, ctx: RouteContext<'/api/devices/[id]'>) {
  const { id } = await ctx.params;
  return respond(() => ({ now: Date.now(), ...deviceDetail(id) }));
}
