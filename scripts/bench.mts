// Starts a benchmark on the running dashboard (npm run dev / npm start), like the
// Benchmark page does:  npm run bench -- --models gemma4-e2b --reps 3
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:8787' },
    suite: { type: 'string', default: 'file-tools' },
    models: { type: 'string', default: 'gemma4-e2b' },
    scenarios: { type: 'string', default: 'baseline,file-tools' },
    tasks: { type: 'string' },
    reps: { type: 'string', default: '3' },
    name: { type: 'string' },
    'turn-timeout-ms': { type: 'string' },
    stop: { type: 'boolean', default: false },
  },
});
const list = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

const res = args.stop
  ? await fetch(`${args.url}/api/bench`, { method: 'DELETE' })
  : await fetch(`${args.url}/api/bench`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suite: args.suite,
        models: list(args.models),
        scenarios: list(args.scenarios),
        tasks: list(args.tasks),
        reps: Number(args.reps),
        name: args.name,
        turnTimeoutMs: args['turn-timeout-ms'] ? Number(args['turn-timeout-ms']) : undefined,
      }),
    }).catch(() => null);
if (!res) {
  console.error(`The dashboard isn't running at ${args.url}. Start it with npm run dev (or npm start).`);
  process.exit(1);
}
const body = await res.json();
if (!res.ok) {
  console.error(body.error);
  process.exit(1);
}
console.log(args.stop ? 'Stopped.' : `Started ${body.session.sessionId}: ${body.session.total} runs. Follow it at ${args.url}/bench`);
