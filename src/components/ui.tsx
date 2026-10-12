'use client';

import { ArrowLeftIcon } from '@heroicons/react/20/solid';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { MetricSample } from '@/shared/device-metrics';
import { DataTable, type DataColumn } from '@/ui/data-table';
import { Frame, FrameBody, FrameHeader } from '@/ui/frame';
import { fmtMB, fmtNum, fmtPct, isNum, THERMAL } from './format';

/*
 * The dashboard's building blocks, in Shift's language (Shift/docs/skills/shift-design):
 * frames for grouped content, tinted status chips, 13 px text, meta in subtle ink.
 */

// ── Chips: a tinted fill, never a border; colour only where it means something ──

const TONE: Record<string, string> = {
  neutral: 'bg-foreground/5 text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  serious: 'bg-serious/10 text-serious',
  critical: 'bg-destructive/10 text-destructive',
};

export function Chip({ tone = 'neutral', children, className }: { tone?: keyof typeof TONE | string; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONE[tone] ?? TONE.neutral, className)}>{children}</span>;
}

export function StatusChip({ status }: { status?: string }) {
  if (!status || status === 'ok') return <Chip tone="success">OK</Chip>;
  if (status === 'timeout') return <Chip tone="serious">Timed out</Chip>;
  return <Chip tone="critical">Error</Chip>;
}

export function PassChip({ pass }: { pass: boolean }) {
  return <Chip tone={pass ? 'success' : 'critical'}>{pass ? 'Pass' : 'Fail'}</Chip>;
}

/** Nominal heat is plain; anything warmer gets its status colour. */
export function ThermalChip({ state }: { state?: string }) {
  const [tone, label] = (state && THERMAL[state]) || ['neutral', state ?? 'Unknown'];
  return <Chip tone={tone === 'good' ? 'neutral' : tone}>{label}</Chip>;
}

export function LiveChip({ live }: { live: boolean }) {
  return <Chip tone={live ? 'success' : 'neutral'}>{live ? 'Live' : 'Offline'}</Chip>;
}

// ── Page scaffolding ───────────────────────────────────────────────────────

/** A screen: back link, title, description and actions, then content, with Shift's spacing and entrance. */
export function Page({ title, description, back, actions, aside, children }: { title: ReactNode; description?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6 px-8 pt-6 pb-10 duration-200 animate-in fade-in motion-reduce:animate-none">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <header className="flex min-w-0 flex-1 flex-col gap-1">
        {back ? (
          <Link
            href={back.href}
            className="-ml-1 mb-1 inline-flex w-fit items-center gap-1 rounded-md px-1 text-xs text-subtle-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
            {back.label}
          </Link>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <h1 className="min-w-0 truncate text-xl font-medium">{title}</h1>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </header>
      {/* Beside the title: readings that describe the whole page (e.g. a device's current numbers). */}
      {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Section({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {meta ? <div className="text-xs text-subtle-foreground tabular-nums">{meta}</div> : null}
      </div>
      {children}
    </section>
  );
}

// ── Stats ──────────────────────────────────────────────────────────────────

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-card px-3 py-2.5 shadow-frame">
      <span className="truncate text-xs text-subtle-foreground">{label}</span>
      <span className="truncate text-lg font-medium tabular-nums">{value}</span>
      {note ? <span className="truncate text-xs text-subtle-foreground">{note}</span> : null}
    </div>
  );
}

/** Stat cards share the row evenly (4 on an iPhone, 5 on Android with Power), wrapping when narrow. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">{children}</div>;
}

/**
 * A device's current numbers as one quiet strip (for a page header): label over
 * value, split by hairlines, no cards. Same readings as DeviceStats.
 */
export function DeviceReadings({ sample, platform, stale = false }: { sample: MetricSample | null; platform: string; stale?: boolean }) {
  if (!sample) return null;
  const android = platform === 'android';
  const items: [string, ReactNode][] = [
    ['App memory', fmtMB((sample.memFootprintBytes ?? NaN) / 1e6)],
    [android ? 'System available' : 'Headroom', fmtMB((sample.memAvailableBytes ?? NaN) / 1e6)],
    ['Thermal', <ThermalChip key="t" state={sample.thermal} />],
    [
      'Battery',
      <span key="b">
        {isNum(sample.batteryLevel) ? fmtPct(sample.batteryLevel * 100) : '–'}
        {sample.batteryState ? <span className="font-normal text-subtle-foreground"> · {capitalize(sample.batteryState.replace('_', ' '))}</span> : null}
      </span>,
    ],
  ];
  if (isNum(sample.powerW)) items.push(['Power', `${fmtNum(sample.powerW, 2)} W`]);
  if (sample.lowPowerMode) items.push(['Low Power Mode', 'On']);
  return <Readings items={items} stale={stale} label={stale ? 'Last readings' : 'Current readings'} />;
}

/** A row of labelled numbers split by hairlines: sits beside a page title (a device's readings, an eval's pass rates). */
export function Readings({ items, label, stale = false }: { items: [string, ReactNode][]; label: string; stale?: boolean }) {
  return (
    <dl className={cn('flex flex-wrap items-stretch transition-opacity duration-200 motion-reduce:transition-none', stale && 'opacity-60')} aria-label={label}>
      {items.map(([name, value]) => (
        <div key={name} className="flex min-w-24 flex-col gap-1 px-4 first:pl-0 last:pr-0 not-last:hairline-r">
          <dt className="text-xs text-subtle-foreground">{name}</dt>
          <dd className="flex h-6 items-center text-sm font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DeviceStats({ sample, platform }: { sample: MetricSample | null; platform: string }) {
  if (!sample) return <p className="text-sm text-muted-foreground">No device metrics in this build. Rebuild the app with the device-metrics module.</p>;
  const android = platform === 'android';
  return (
    <StatGrid>
      <Stat label="App memory" value={fmtMB((sample.memFootprintBytes ?? NaN) / 1e6)} />
      <Stat label={android ? 'System available' : 'Headroom'} value={fmtMB((sample.memAvailableBytes ?? NaN) / 1e6)} note={android ? undefined : 'Before iOS stops the app'} />
      <Stat label="Thermal" value={<ThermalChip state={sample.thermal} />} />
      <Stat label="Battery" value={isNum(sample.batteryLevel) ? fmtPct(sample.batteryLevel * 100) : '–'} note={sample.batteryState ? capitalize(sample.batteryState.replace('_', ' ')) : undefined} />
      {isNum(sample.powerW) ? <Stat label="Power" value={`${fmtNum(sample.powerW, 2)} W`} /> : null}
      {sample.lowPowerMode ? <Stat label="Low Power Mode" value="On" /> : null}
    </StatGrid>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Tables, key-value frames, text frames ──────────────────────────────────

export type Column<T> = DataColumn<T>;

/** Shift's DataTable; rows open `href` or call `onOpen` (click, or Enter on the primary cell). */
export function Table<T>({ label, columns, rows, rowId, rowLabel, href, onOpen, empty = 'Nothing yet' }: { label: string; columns: Column<T>[]; rows: T[]; rowId: (row: T) => string; rowLabel: (row: T) => string; href?: (row: T) => string; onOpen?: (row: T) => void; empty?: string }) {
  const router = useRouter();
  if (!rows.length) {
    return (
      <Frame>
        <FrameBody>
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p>
        </FrameBody>
      </Frame>
    );
  }
  return <DataTable label={label} columns={columns} rows={rows} rowId={rowId} rowLabel={rowLabel} onOpen={onOpen ?? (href ? (row) => router.push(href(row)) : undefined)} />;
}

export function KeyValues({ title, rows }: { title?: ReactNode; rows: [ReactNode, ReactNode][] }) {
  return (
    <Frame>
      {title ? <FrameHeader>{title}</FrameHeader> : null}
      <FrameBody>
        {rows.map(([k, v], i) => (
          <div key={i} className="grid grid-cols-[minmax(8rem,14rem)_1fr] gap-3 px-3 py-2">
            <span className="truncate text-subtle-foreground">{k}</span>
            <span className="min-w-0 break-words whitespace-pre-wrap">{v}</span>
          </div>
        ))}
      </FrameBody>
    </Frame>
  );
}

/** Text in a frame with a header strip (Shift's code-block recipe). */
export function TextFrame({ label, meta, children, mono = false }: { label: ReactNode; meta?: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <Frame>
      <FrameHeader className="gap-2">
        <span className="truncate">{label}</span>
        {meta ? <span className="ml-auto text-xs font-normal tabular-nums">{meta}</span> : null}
      </FrameHeader>
      <FrameBody>
        <div className={cn('px-3 py-2 break-words whitespace-pre-wrap', mono ? 'font-mono text-xs leading-5' : 'text-sm leading-relaxed')}>{children}</div>
      </FrameBody>
    </Frame>
  );
}

export function ErrorState({ error }: { error: string }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-1 px-8 py-16 text-center text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Couldn’t load this</span>
      <span>{error}</span>
    </div>
  );
}

/** A quiet placeholder in the content's shape; fades in after 150 ms so fast loads never flash. */
export function LoadingState() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6 px-8 pt-6 delay-150 duration-300 [animation-fill-mode:both] animate-in fade-in motion-reduce:animate-none">
      <div className="h-7 w-48 rounded-lg bg-muted" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-16 rounded-xl bg-surface shadow-frame" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-surface shadow-frame" />
    </div>
  );
}
