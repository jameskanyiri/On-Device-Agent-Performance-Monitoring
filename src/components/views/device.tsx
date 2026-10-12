'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { ago } from '../format';
import { DeviceReadings, ErrorState, LiveChip, LoadingState, Page, Section } from '../ui';
import { usePoll } from '../use-poll';
import { TraceExplorer, type RunRow, type TraceRow } from './explorer';
import { osLabel, type DeviceRow } from './home';
import { DevicePanel } from './live';
import { ThreadSheet } from './thread-panel';

type Detail = DeviceRow & { now: number; hasLive: boolean; traces: TraceRow[]; runs: RunRow[] };

/** One device: its live timeline (when it has sent heartbeats) and all its traces. */
export function DeviceView({ deviceId }: { deviceId: string }) {
  const { data, error } = usePoll<Detail>(`/api/devices/${encodeURIComponent(deviceId)}`, 2000);
  // The open trace lives in the URL (?trace=…): links work, and Back closes the panel.
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openTrace = params.get('trace');
  const openThread = params.get('thread');
  const show = (key: 'trace' | 'thread', id: string) => router.push(`${pathname}?${key}=${encodeURIComponent(id)}`, { scroll: false });
  if (error && !data) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;

  return (
    <Page
      back={{ href: '/traces', label: 'Traces' }}
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{data.device.name ?? 'Phone'}</span>
          <LiveChip live={data.live} />
        </span>
      }
      aside={<DeviceReadings sample={data.sample} platform={data.device.platform} stale={!data.live} />}
      description={`${osLabel(data.device)} · ${data.live ? 'connected now' : `last seen ${ago(data.lastSeen, data.now)}`}`}>
      {data.hasLive ? <DevicePanel deviceId={deviceId} /> : null}

      <Section title="Traces">
        <TraceExplorer
          traces={data.traces}
          runs={data.runs}
          now={data.now}
          onOpenTrace={(id) => show('trace', id)}
          onOpenThread={(id) => show('thread', id)}
        />
      </Section>

      <ThreadSheet deviceId={deviceId} threadId={openThread} traceId={openTrace} onClose={() => router.push(pathname, { scroll: false })} />
    </Page>
  );
}
