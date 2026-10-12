'use client';

import type { ReactNode } from 'react';

import type { Trace } from '@/shared/trace';
import { fmtDate, fmtDur, fmtMB, fmtNum, fmtPct, isNum } from '../format';
import { Timeline } from '../timeline';
import { ErrorState, KeyValues, LoadingState, Page, PassChip, Section, Stat, StatGrid, StatusChip, TextFrame } from '../ui';
import { usePoll } from '../use-poll';

export function traceDescription(trace: Trace) {
  return `${fmtDate(trace.start)} · ${fmtDur((trace.end ?? trace.start) - trace.start)} · ${trace.device.name ?? trace.device.platform}`;
}

function TraceStats({ trace, energyJ }: { trace: Trace; energyJ?: number }) {
  const gens = trace.spans.filter((s) => s.kind === 'generation');
  const tools = trace.spans.filter((s) => s.kind === 'tool');
  const failedTools = tools.filter((t) => t.status !== 'ok').length;
  const mem = trace.samples.map((s) => s.memFootprintBytes).filter(isNum);
  const head = trace.samples.map((s) => s.memAvailableBytes).filter(isNum);
  const first = trace.samples[0];
  const last = trace.samples.at(-1);
  const cpu = first && last && last.uptimeS > first.uptimeS ? ((last.cpuTimeS - first.cpuTimeS) / (last.uptimeS - first.uptimeS)) * 100 : undefined;
  const ttft = gens[0]?.attrs?.ttftMs;
  const tokens = gens.reduce((a, s) => a + (typeof s.attrs?.generatedTokens === 'number' ? s.attrs.generatedTokens : 0), 0);
  return (
    <StatGrid>
      <Stat label="Model calls" value={fmtNum(gens.length)} />
      <Stat label="Tokens out" value={fmtNum(tokens)} />
      <Stat label="First token" value={typeof ttft === 'number' ? fmtDur(ttft) : '–'} />
      <Stat label="Tool calls" value={fmtNum(tools.length)} note={failedTools ? `${failedTools} failed` : undefined} />
      <Stat label="Peak memory" value={mem.length ? fmtMB(Math.max(...mem) / 1e6) : '–'} />
      {head.length ? <Stat label={trace.device.platform === 'android' ? 'Lowest system memory' : 'Lowest headroom'} value={fmtMB(Math.min(...head) / 1e6)} /> : null}
      <Stat label="CPU" value={fmtPct(cpu)} note="100% is one core" />
      {isNum(energyJ) ? <Stat label="Energy" value={`${fmtNum(energyJ, 1)} J`} /> : null}
    </StatGrid>
  );
}

type RunDetail = {
  trace: Trace;
  metrics: { energyJ?: number };
  check: { pass: boolean; detail: string };
  turns: { prompt: string; reply: string; finishReason: string }[];
  workspaceAfter: Record<string, string>;
};

export function RunView({ sessionId, jobId }: { sessionId: string; jobId: string }) {
  const { data, error } = usePoll<RunDetail>(`/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(jobId)}`, 0);
  if (error && !data) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;
  const { trace, check, metrics, turns, workspaceAfter } = data;
  const files = Object.entries(workspaceAfter ?? {});
  return (
    <Page
      back={{ href: `/sessions/${encodeURIComponent(sessionId)}`, label: 'Session' }}
      title={trace.name}
      actions={
        <>
          <StatusChip status={trace.status} />
          <PassChip pass={check.pass} />
        </>
      }
      description={
        <>
          {traceDescription(trace)}
          {check.pass ? null : <span className="mt-1 block text-destructive">{check.detail}</span>}
        </>
      }>
      <TraceStats trace={trace} energyJ={metrics.energyJ} />
      <Section title="Timeline" meta="Hover for values, click a span for details">
        <Timeline spans={trace.spans} samples={trace.samples} platform={trace.device.platform} />
      </Section>
      <Section title="Conversation">
        {turns.length ? (
          turns.map((t, i) => (
            <div key={i} className="flex flex-col gap-2">
              <TextFrame label={`Turn ${i + 1} · You`}>{t.prompt}</TextFrame>
              <TextFrame label={`Turn ${i + 1} · Model`} meta={t.finishReason}>
                {t.reply || <span className="text-subtle-foreground">No reply</span>}
              </TextFrame>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No turns finished.</p>
        )}
      </Section>
      {files.length ? (
        <Section title="Workspace after the run" meta={`${files.length} ${files.length === 1 ? 'file' : 'files'}`}>
          {files.map(([path, content]) => (
            <TextFrame key={path} label={<span className="font-mono text-xs">{path}</span>} mono>
              {content}
            </TextFrame>
          ))}
        </Section>
      ) : null}
    </Page>
  );
}

/** A trace's numbers, timeline and attributes: shared by the full page and the side panel. */
export function TraceBody({ trace }: { trace: Trace }) {
  const attrs = Object.entries(trace.attrs ?? {}).filter(([, v]) => v !== null && v !== '');
  return (
    <>
      <TraceStats trace={trace} />
      <Section title="Timeline" meta="Hover for values, click a span for details">
        <Timeline spans={trace.spans} samples={trace.samples} platform={trace.device.platform} />
      </Section>
      {attrs.length ? (
        <Section title="Attributes">
          <KeyValues rows={attrs.map(([k, v]): [ReactNode, ReactNode] => [k, String(v)])} />
        </Section>
      ) : null}
    </>
  );
}

export function ChatTraceView({ traceId }: { traceId: string }) {
  const { data, error } = usePoll<{ trace: Trace }>(`/api/chats/${encodeURIComponent(traceId)}`, 0);
  if (error && !data) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;
  const { trace } = data;
  return (
    <Page back={{ href: `/traces/${encodeURIComponent(trace.device.id)}`, label: trace.device.name ?? 'Device' }} title={trace.name} actions={<StatusChip status={trace.status} />} description={traceDescription(trace)}>
      <TraceBody trace={trace} />
    </Page>
  );
}
