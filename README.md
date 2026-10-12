# On-device observability dashboard

Traces, device metrics and benchmarks for the on-device AI app (`../on-device-ai`).
It answers what each agent feature buys (answer quality) and what it costs the
phone (memory, CPU, heat, power, latency).

This Next.js app is the single server the phone talks to. It:
- collects traces and live heartbeats from the app;
- drives benchmarks, handing jobs to the phone;
- shows everything on one clock: spans (load → turn → model calls → tool calls) above
  memory, headroom, CPU, power and thermal lanes.

## Run it

```bash
npm install
npm run dev          # http://localhost:8787, reachable from the phone on your Wi-Fi
# or, faster and closer to production:
npm run build && npm start
```

On the phone, open **Settings → Benchmark** and enter the address shown on the
Overview page (e.g. `http://192.168.1.10:8787`).
- **Android:** run `adb reverse tcp:8787 tcp:8787` and use `http://localhost:8787`.
- **Trace my chats:** turn this on in the same screen to trace everyday use. Every
  reply and model load then arrives as a trace.

## Pages

| Page | What it shows |
|---|---|
| `/` Overview | Each phone's live memory, headroom, CPU, thermal state, battery and power, plus what it's running; benchmark sessions; traced chats |
| `/live/<device>` | The last 10 minutes of device metrics |
| `/evals` | Evals (benchmarks): start or stop one (models × scenarios × tasks × repeats), follow it, and every past session with its pass rate per scenario |
| `/sessions/<id>` | Pass rate and metrics per scenario, impact against the bare model, pass rate by task, every run |
| `/sessions/<id>/runs/<job>` and `/chats/<id>` | One trace: timeline, device lanes, conversation, files |

Start benchmarks from the terminal too:
- `npm run bench -- --models gemma4-e2b --reps 3` starts a benchmark.
- `npm run bench -- --stop` stops it.

## Maintenance

- `npm test`: unit tests (Vitest): the store's summaries, percentiles, threads,
  retention and benchmark traces, and the trace explorer's filters and grouping.
- `npm run sync-shared`: refresh `src/shared` from the app; `-- --check` exits 1 on
  drift (run it in CI or before committing changes to either repo).
- Retention: chat traces older than `TRACE_RETENTION_DAYS` (default 30) are deleted,
  at most once an hour. Benchmark sessions are kept.

## Phone protocol

These paths match the app's `src/bench/client.ts` and `src/observe/collector.ts`:

| Route | |
|---|---|
| `GET /job` | Next benchmark job (`204` = nothing yet, `409` = another connection is busy) |
| `POST /log`, `POST /result` | Benchmark progress and finished runs |
| `POST /v1/live` | Heartbeat while something runs |
| `POST /v1/traces` | A finished chat trace |

## Design

The UI follows Shift's design language (`Shift/docs/skills/shift-design`): Tailwind v4 with
Shift's tokens (`src/app/globals.css`), its `Frame` / `DataTable` / `Button` primitives in
`src/ui/` (copied from `shift-desktop-app/src/renderer/shared/ui`), Heroicons, 13 px text,
shadow edges and hairlines, tinted status chips, and small opacity/transform motion that
turns off with Reduce motion.

## Layout

- `src/server/`: the benchmark driver (`bench.ts`), the store and the trace
  conversion (`store.ts`), task suites with their checks (`suites/`), scenarios,
  metrics, and the `report.md` / `runs.csv` writer.
- `src/shared/`: types copied from the app (trace format, benchmark protocol,
  device metrics) and its model list. Kept in sync with `../on-device-ai` by `npm run sync-shared`.
- `src/components/`: the timeline (SVG in a frame), page scaffolding, stats and chips, and one view per page.
- `src/ui/`, `src/lib/`: Shift's primitives and `cn`.
- `data/` (git-ignored): benchmark sessions (`<session>/runs/*.json`, `report.md`)
  and chat traces (`_chats/`).

## Adding a harness piece to measure

1. In the app, add a flag to `HarnessConfig` (`src/bench/protocol.ts`) and apply it
   in `src/bench/runner.ts`.
2. Copy the protocol change to `src/shared/protocol.ts` here.
3. Add a scenario to `src/server/scenarios.ts`, and tasks that exercise it to a suite.
