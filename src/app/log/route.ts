import { phoneLog } from '@/server/bench';

// Phone → a progress line for the benchmark log.
export async function POST(request: Request) {
  const { message } = (await request.json()) as { jobId: string; message: string };
  phoneLog(message);
  return Response.json({ ok: true });
}
