import { respond } from '@/server/http';
import { sessionList } from '@/server/store';

export async function GET() {
  return respond(() => ({ sessions: sessionList() }));
}
