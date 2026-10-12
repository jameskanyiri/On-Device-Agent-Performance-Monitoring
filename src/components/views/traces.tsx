'use client';

import { ClockIcon } from '@heroicons/react/20/solid';

import { ago, fmtDate, fmtDur, fmtMB, fmtPct } from '../format';
import { Chip, ErrorState, LiveChip, LoadingState, Page, Section, Table } from '../ui';
import { usePoll } from '../use-poll';
import { osLabel, type DeviceRow } from './home';

type Devices = { now: number; retentionDays: number; devices: DeviceRow[] };
type Sessions = { sessions: { id: string; suite: string; startedAt: string; models: string[]; done: number; total: number }[] };

/** Traces: every device seen; open one for its traces. */
export function TracesView() {
  const { data, error } = usePoll<Devices>('/api/devices', 5000);
  const { data: bench } = usePoll<Sessions>('/api/sessions', 15_000);
  if (error && !data) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;

  return (
    <Page title="Traces" description={`Every device that has sent data, with its replies over the last 7 days. P50 is the typical reply time; P95 is the slow tail (95% of replies were faster). Open a device for its traces and live metrics. Traces are kept ${data.retentionDays} days.`}>
      <Table
        label="Devices"
        rows={data.devices}
        rowId={(d) => d.device.id}
        rowLabel={(d) => d.device.name ?? 'Phone'}
        href={(d) => `/traces/${encodeURIComponent(d.device.id)}`}
        empty="No devices yet. Connect your phone from Settings → Dashboard in the app."
        columns={[
          {
            key: 'device',
            header: 'Device',
            primary: true,
            cell: (d) => (
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{d.device.name ?? 'Phone'}</span>
                <span className="truncate text-xs text-subtle-foreground">{osLabel(d.device)}</span>
              </span>
            ),
          },
          { key: 'status', header: 'Status', width: 'w-24', cell: (d) => <LiveChip live={d.live} /> },
          { key: 'last', header: 'Last activity', width: 'w-32', cell: (d) => <span className="truncate text-muted-foreground">{d.lastTraceAt ? ago(d.lastTraceAt, data.now) : '–'}</span> },
          { key: 'replies', header: 'Replies (7d)', width: 'w-28', align: 'end', cell: (d) => <Chip>{d.stats.replies}</Chip> },
          {
            key: 'errors',
            header: 'Error rate (7d)',
            width: 'w-32',
            align: 'end',
            cell: (d) => (d.stats.errorRate === null ? <Dash /> : <Chip tone={d.stats.errorRate === 0 ? 'success' : 'critical'}>{fmtPct(d.stats.errorRate * 100)}</Chip>),
          },
          { key: 'p50', header: 'P50 reply (7d)', width: 'w-32', align: 'end', cell: (d) => <Latency ms={d.stats.p50Ms} /> },
          { key: 'p95', header: 'P95 reply (7d)', width: 'w-32', align: 'end', cell: (d) => <Latency ms={d.stats.p95Ms} /> },
          { key: 'tokens', header: 'Tokens out (7d)', width: 'w-32', align: 'end', cell: (d) => fmtCount(d.stats.tokensOut) },
          { key: 'memory', header: 'Peak memory (7d)', width: 'w-36', align: 'end', cell: (d) => (d.stats.peakMemMB === null ? <Dash /> : fmtMB(d.stats.peakMemMB)) },
        ]}
      />

      {bench?.sessions.length ? (
        <Section title="Benchmark sessions" meta={`${bench.sessions.length}`}>
          <Table
            label="Benchmark sessions"
            rows={bench.sessions}
            rowId={(r) => r.id}
            rowLabel={(r) => r.id}
            href={(r) => `/sessions/${encodeURIComponent(r.id)}`}
            columns={[
              { key: 'started', header: 'Started', primary: true, cell: (r) => <span className="truncate">{fmtDate(r.startedAt)}</span> },
              { key: 'suite', header: 'Suite', width: 'w-32', cell: (r) => <span className="truncate">{r.suite}</span> },
              { key: 'models', header: 'Models', cell: (r) => <span className="truncate">{r.models.join(', ')}</span> },
              { key: 'runs', header: 'Runs', width: 'w-24', align: 'end', cell: (r) => `${r.done} / ${r.total}` },
            ]}
          />
        </Section>
      ) : null}
    </Page>
  );
}

const Dash = () => <span className="text-subtle-foreground">–</span>;

/** A reply time as a quiet chip with a clock, as in other tracing tools. */
function Latency({ ms }: { ms: number | null }) {
  if (ms === null) return <Dash />;
  return (
    <Chip className="gap-1">
      <ClockIcon className="size-3" aria-hidden="true" />
      {fmtDur(ms)}
    </Chip>
  );
}

/** 1234 → 1.2K, 3812000 → 3.81M. */
function fmtCount(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
