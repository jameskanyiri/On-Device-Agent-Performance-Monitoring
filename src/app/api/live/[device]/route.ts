import { respond } from '@/server/http';
import { liveDevice } from '@/server/store';

export async function GET(_request: Request, ctx: RouteContext<'/api/live/[device]'>) {
  const { device } = await ctx.params;
  return respond(() => ({ now: Date.now(), ...liveDevice(device) }));
}
