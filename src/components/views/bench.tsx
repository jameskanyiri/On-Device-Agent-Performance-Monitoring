'use client';

import { ArrowRightIcon, PlayIcon, StopIcon } from '@heroicons/react/20/solid';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import type { Scenario } from '@/shared/protocol';
import { MODELS } from '@/shared/models';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Frame, FrameBody, FrameHeader } from '@/ui/frame';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Shimmer } from '@/ui/shimmer';
import { fmtClock, fmtDur } from '../format';
import { Chip, ErrorState, LoadingState, Page, Section, TextFrame } from '../ui';
import { usePoll } from '../use-poll';

type BenchState = {
  now: number;
  active: boolean;
  session: {
    sessionId: string;
    suite: string;
    total: number;
    done: number;
    pending: number;
    inFlight: { jobId: string; since: number } | null;
    startedAt: number;
    finished: boolean;
    stopped: boolean;
  } | null;
  log: { t: number; line: string }[];
  options: { suites: Record<string, { id: string; title: string }[]>; scenarios: Scenario[] };
};

/** Start a benchmark and follow it. The phone picks jobs up from its Benchmark screen. */
export function BenchView() {
  const { data, error } = usePoll<BenchState>('/api/bench', 2000);
  if (error && !data) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;
  const { now, active, session, log, options } = data;

  return (
    <Page
      title="Benchmark"
      description="Runs every task under each scenario on the phone, each from a fresh model session, with device metrics. Keep the phone on Settings → Benchmark, connected to this dashboard.">
      {session ? <Progress session={session} active={active} now={now} /> : null}
      {!active ? <NewBenchmark options={options} /> : null}
      <Section title="Log" meta={log.length ? `${log.length} lines` : undefined}>
        {log.length ? (
          <TextFrame label="Benchmark log" mono>
            {log.map((l) => `${fmtClock(l.t)}  ${l.line}`).join('\n')}
          </TextFrame>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing yet</p>
        )}
      </Section>
    </Page>
  );
}

function Progress({ session, active, now }: { session: NonNullable<BenchState['session']>; active: boolean; now: number }) {
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    setStopping(true);
    await fetch('/api/bench', { method: 'DELETE' });
    setStopping(false);
  };
  const pct = session.total ? Math.round((session.done / session.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-3 shadow-frame">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-semibold">
            {active ? <Shimmer className="font-semibold">Running</Shimmer> : session.finished ? 'Finished' : 'Stopped'}
          </span>
          <span className="truncate font-mono text-xs text-subtle-foreground">{session.sessionId}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {active ? (
            <Button variant="outline" size="sm" onClick={stop} disabled={stopping}>
              <StopIcon aria-hidden="true" />
              Stop
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/sessions/${encodeURIComponent(session.sessionId)}`}>
              Results
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Runs done">
        <div className="h-full origin-left rounded-full bg-foreground/70 transition-transform duration-300 ease-out motion-reduce:transition-none" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-subtle-foreground tabular-nums">
        <span>
          {session.done} of {session.total} runs
        </span>
        <span>·</span>
        <span>{session.pending} waiting</span>
        {session.inFlight ? (
          <>
            <span>·</span>
            <span className="truncate">
              On the phone: <span className="font-mono">{session.inFlight.jobId}</span> for {fmtDur(now - session.inFlight.since)}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function NewBenchmark({ options }: { options: BenchState['options'] }) {
  const suiteNames = Object.keys(options.suites);
  const [suite, setSuite] = useState(suiteNames[0] ?? '');
  const [models, setModels] = useState<Set<string>>(() => new Set(['gemma4-e2b']));
  const [scenarios, setScenarios] = useState<Set<string>>(() => new Set(options.scenarios.map((s) => s.id)));
  const [tasks, setTasks] = useState<Set<string>>(() => new Set());
  const [reps, setReps] = useState('3');
  const [timeoutS, setTimeoutS] = useState('240');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = (set: Set<string>, update: (next: Set<string>) => void, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    update(next);
  };
  const suiteTasks = options.suites[suite] ?? [];
  const runs = models.size * scenarios.size * (tasks.size || suiteTasks.length) * Math.max(1, Number(reps) || 1);

  const start = async () => {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/bench', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suite,
        models: [...models],
        scenarios: [...scenarios],
        tasks: [...tasks],
        reps: Number(reps),
        name: name.trim() || undefined,
        turnTimeoutMs: Number(timeoutS) * 1000,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setMessage(json.error ?? 'Couldn’t start the benchmark');
  };

  return (
    <Section title="New benchmark">
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.6fr]">
        <PickFrame title="Models">
          {MODELS.map((m) => (
            <CheckRow key={m.id} id={`model-${m.id}`} checked={models.has(m.id)} onChange={(on) => toggle(models, setModels, m.id, on)} label={m.name} meta={m.id} />
          ))}
        </PickFrame>
        <PickFrame title="Scenarios">
          {options.scenarios.map((s) => (
            <CheckRow key={s.id} id={`scenario-${s.id}`} checked={scenarios.has(s.id)} onChange={(on) => toggle(scenarios, setScenarios, s.id, on)} label={s.label} meta={s.id} />
          ))}
        </PickFrame>
        <PickFrame
          title={
            <span className="flex w-full items-center gap-2">
              Tasks
              {suiteNames.length > 1 ? (
                <select aria-label="Suite" value={suite} onChange={(e) => (setSuite(e.target.value), setTasks(new Set()))} className="ml-auto rounded-md bg-card px-1.5 py-0.5 text-xs shadow-edge outline-none">
                  {suiteNames.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <Chip className="ml-auto">{suite}</Chip>
              )}
            </span>
          }>
          {suiteTasks.map((t) => (
            <CheckRow key={t.id} id={`task-${t.id}`} checked={tasks.has(t.id)} onChange={(on) => toggle(tasks, setTasks, t.id, on)} label={t.title} meta={t.id} />
          ))}
          <p className="px-3 py-2 text-xs text-subtle-foreground">None ticked runs every task.</p>
        </PickFrame>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-card p-3 shadow-frame">
        <Field id="reps" label="Repeats">
          <Input id="reps" type="number" min={1} max={20} value={reps} onChange={(e) => setReps(e.target.value)} className="w-24" />
        </Field>
        <Field id="timeout" label="Turn timeout (s)">
          <Input id="timeout" type="number" min={30} value={timeoutS} onChange={(e) => setTimeoutS(e.target.value)} className="w-32" />
        </Field>
        <Field id="name" label="Name">
          <Input id="name" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} className="w-48" />
        </Field>
        <div className="ml-auto flex items-center gap-3">
          {message ? (
            <span role="alert" className="text-sm text-destructive">
              {message}
            </span>
          ) : (
            <span className="text-xs text-subtle-foreground tabular-nums">{runs} runs</span>
          )}
          <Button onClick={start} disabled={busy || !models.size || !scenarios.size}>
            <PlayIcon aria-hidden="true" />
            Start benchmark
          </Button>
        </div>
      </div>
    </Section>
  );
}

function PickFrame({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Frame>
      <FrameHeader>{title}</FrameHeader>
      <FrameBody>{children}</FrameBody>
    </Frame>
  );
}

function CheckRow({ id, checked, onChange, label, meta }: { id: string; checked: boolean; onChange: (on: boolean) => void; label: string; meta?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate font-normal">
        {label}
      </Label>
      {meta ? <span className="truncate font-mono text-xs text-subtle-foreground">{meta}</span> : null}
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs font-normal text-subtle-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
