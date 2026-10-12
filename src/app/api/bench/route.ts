import { benchOptions, benchStatus, startBench, stopBench, type BenchConfig } from '@/server/bench';
import { respond } from '@/server/http';

// Benchmark control for the dashboard's Benchmark page and `npm run bench`.
export async function GET() {
  return respond(() => ({ now: Date.now(), ...benchStatus(), options: benchOptions() }));
}

export async function POST(request: Request) {
  return respond(async () => startBench((await request.json()) as BenchConfig));
}

export async function DELETE() {
  return respond(() => stopBench());
}
