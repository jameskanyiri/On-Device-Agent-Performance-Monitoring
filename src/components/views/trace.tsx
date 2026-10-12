'use client';

import type { ReactNode } from 'react';

import type { Trace } from '@/shared/trace';
import { fmtDate, fmtDur, fmtMB, fmtNum, fmtPct, isNum } from '../format';
import { Timeline } from '../timeline';
import { ErrorState, KeyValues, LoadingState, Page, Section, Stat, StatGrid, StatusChip } from '../ui';
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
