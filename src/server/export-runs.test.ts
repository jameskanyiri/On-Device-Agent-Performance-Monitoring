import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';

import type { RunResult } from '@/shared/protocol';
import { scoreRun } from './report';
import { SUITES } from './suites';

/*
 * Exports every run of the study's eval sessions, scored exactly as the
 * dashboard scores them, for the talk's figures (on-device-talk/figures).
 * Runs only when asked:
 *
 *   EXPORT_RUNS=../on-device-talk/figures/data npx vitest run src/server/export-runs.test.ts
 */

/** The sessions behind each learning, by step. */
const SESSIONS: Record<string, string> = {
  '2026-10-14T02-46-25-step0-e01-gemma': 'step0',
  '2026-10-14T03-06-39-step0-e02-context': 'step0-context',
  '2026-10-14T04-12-19-step1-e1': 'step1',
  '2026-10-14T08-16-22-step2-e1': 'step2',
  '2026-10-14T11-47-16-step3a-e2': 'step3a',
  '2026-10-14T17-24-01-step3b-e1-overnight': 'step3b',
};

const out = process.env.EXPORT_RUNS;

it.skipIf(!out)('exports the study’s runs', () => {
  const rows: Record<string, unknown>[] = [];
  for (const [session, step] of Object.entries(SESSIONS)) {
    const dir = join('data', session);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { suite: string };
    const suite = SUITES[manifest.suite] ?? [];
    for (const file of readdirSync(join(dir, 'runs'))) {
      const run = JSON.parse(readFileSync(join(dir, 'runs', file), 'utf8')) as RunResult;
      // A placeholder for a run the app never finished (the reinstall in step3a-e2), not a result.
      if (!run.device.appCommit && /App restarted/.test(run.error ?? '')) continue;
      const s = scoreRun(run, suite);
      const m = s.metrics as unknown as Record<string, unknown>;
      rows.push({
        step,
        session,
        scenario: run.scenarioId,
        task: run.taskId,
        rep: run.rep,
        needsTools: s.task?.needsTools ?? false,
        ok: run.ok,
        pass: s.check.pass,
        outcome: s.outcome,
        looped: s.looped,
        commit: run.device.appCommit ?? null,
        ...Object.fromEntries(
          [
            'initTokens', 'loadS', 'firstTokenWallS', 'ttftS', 'turnS', 'promptTokens', 'generatedTokens', 'decodeTps', 'prefillTps',
            'kvPeak', 'maxSeqLen', 'toolCalls', 'toolErrors', 'memPeakMB', 'thermalMax', 'charging', 'planCalls',
          ].map((k) => [k, m[k] ?? null])
        ),
        // Every tool call in order, for the progress-trajectory figures.
        tools: run.tools.map((t) => ({ name: t.name, ok: t.ok, args: t.args ?? {} })),
        reply: run.turns.at(-1)?.reply.slice(0, 300) ?? '',
      });
    }
  }
  mkdirSync(out!, { recursive: true });
  writeFileSync(join(out!, 'runs.json'), JSON.stringify(rows, null, 1));
  const cols = Object.keys(rows[0]!).filter((c) => c !== 'tools');
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(','))].join('\n');
  writeFileSync(join(out!, 'runs.csv'), csv + '\n');
});
