'use client';

import type { MetricSample } from '@/shared/device-metrics';
import type { LiveBeat, Span } from '@/shared/trace';
import { Shimmer } from '@/ui/shimmer';
import { ago, fmtDur } from '../format';
import { Timeline } from '../timeline';
import { Chip, Section } from '../ui';
import { usePoll } from '../use-poll';

type Live = { now: number; beat: LiveBeat; history: { t: number; sample: MetricSample }[]; spans: Span[] };

const WINDOW_MS = 10 * 60_000;
export const LIVE_MS = 12_000;

/**
 * One phone, live: what it's doing now, its numbers, and the last 10 minutes of
 * metrics with every reply drawn on the same clock.
 */
export function DevicePanel({ deviceId }: { deviceId: string }) {
  const { data, error } = usePoll<Live>(`/api/live/${encodeURIComponent(deviceId)}`, 2000);
  if (error && !data) return <p className="text-sm text-muted-foreground">Couldn’t load this phone: {error}</p>;
  if (!data) return <div className="h-96 rounded-xl bg-surface shadow-frame" aria-label="Loading" role="status" />;
  const { now, beat, history, spans } = data;
  const live = now - beat.t < LIVE_MS;

  return (
    // No frame around the cards: each metric is its own card, under one heading.
    <Section
      title="Live"
      meta={
        <span className="flex items-center gap-2">
          {live && beat.active?.source ? <Chip>{beat.active.source === 'bench' ? 'Benchmark' : 'Chat'}</Chip> : null}
          <Activity active={beat.active} live={live} lastSeen={beat.t} now={now} />
          <span aria-hidden="true">·</span>
          <span>Last 10 minutes</span>
        </span>
      }>
      {history.length ? (
        <Timeline spans={spans} samples={history.map((p) => p.sample)} platform={beat.device.platform} domain={[now - WINDOW_MS, now]} now={now} groupByKind />
      ) : (
        <p className="text-sm text-muted-foreground">No metrics in the last 10 minutes{live ? '' : ` (last seen ${ago(beat.t, now)})`}.</p>
      )}
    </Section>
  );
}

/** What a phone is doing right now: a shimmering label while work runs. */
export function Activity({ active, live, lastSeen, now }: { active?: LiveBeat['active']; live: boolean; lastSeen: number; now: number }) {
  if (!live) return <span className="text-sm text-muted-foreground">Last seen {ago(lastSeen, now)}</span>;
  if (!active) return <span className="text-sm text-muted-foreground">Idle</span>;
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      <Shimmer className="shrink-0 font-medium">{active.span ? `${capitalize(active.span.name)} for ${fmtDur(now - active.span.start)}` : 'Working'}</Shimmer>
      <span className="truncate text-subtle-foreground">{active.name}</span>
    </span>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
