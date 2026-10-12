'use client';

import { ArrowRightIcon } from '@heroicons/react/20/solid';
import { DevicePhoneMobileIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

import type { MetricSample } from '@/shared/device-metrics';
import type { LiveBeat, TraceDevice } from '@/shared/trace';
import { Frame, FrameBody, FrameHeader } from '@/ui/frame';
import { ago } from '../format';
import { DeviceStats, ErrorState, LiveChip, LoadingState, Page, Section } from '../ui';
import { usePoll } from '../use-poll';
import { Activity } from './live';

export type DeviceRow = {
  device: TraceDevice;
  lastSeen: number;
  live: boolean;
  traces: number;
  lastTraceAt: number | null;
  sample: MetricSample | null;
  active: LiveBeat['active'] | null;
  /** Replies over the last 7 days. */
  stats: { replies: number; errorRate: number | null; p50Ms: number | null; p95Ms: number | null; tokensOut: number; peakMemMB: number | null };
};
type Devices = { now: number; port: string; hostName: string | null; addresses: string[]; devices: DeviceRow[] };

export const osLabel = (d: TraceDevice) => `${d.platform === 'ios' ? 'iOS' : d.platform === 'android' ? 'Android' : d.platform} ${d.osVersion ?? ''}`.trim();

/** Home: is a phone connected right now, and if not, how to connect one. */
export function HomeView() {
  const { data, error } = usePoll<Devices>('/api/devices', 3000);
  if (error && !data) return <ErrorState error={error} />;
  if (!data) return <LoadingState />;
  const connected = data.devices.filter((d) => d.live);
  const others = data.devices.filter((d) => !d.live);
  // The .local name survives Wi-Fi IP changes; the IP is the fallback.
  const address = data.hostName ? `http://${data.hostName}:${data.port}` : data.addresses.length ? `http://${data.addresses[0]}:${data.port}` : `http://<this Mac>:${data.port}`;

  return (
    <Page title="Home" description={connected.length ? `${connected.length === 1 ? 'A device is' : `${connected.length} devices are`} connected.` : 'No device is connected.'}>
      {connected.length ? (
        connected.map((d) => <ConnectedDevice key={d.device.id} row={d} now={data.now} />)
      ) : (
        <Frame>
          <FrameBody>
            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
              <DevicePhoneMobileIcon className="size-7 text-subtle-foreground" aria-hidden="true" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">No device connected</span>
                <span className="text-sm text-muted-foreground">Connect your phone to see it here live.</span>
              </div>
              <ol className="flex max-w-md flex-col gap-1.5 text-left text-sm text-muted-foreground">
                <li>1. Put the phone on the same Wi-Fi as this Mac.</li>
                <li>
                  2. In the app, open Settings → Dashboard and enter <span className="rounded-md bg-muted px-1 font-mono text-xs text-foreground">{address}</span>
                </li>
                <li>3. Turn on Live monitoring. The app remembers both, and builds made with npm run ios:release come set up already.</li>
              </ol>
            </div>
          </FrameBody>
        </Frame>
      )}

      {others.length ? (
        <Section title="Not connected" meta={`${others.length}`}>
          <Frame>
            <FrameBody>
              {others.map((d) => (
                <Link
                  key={d.device.id}
                  href={`/traces/${encodeURIComponent(d.device.id)}`}
                  className="flex items-center gap-3 px-3 py-2 text-sm outline-none transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                  <span className="truncate">{d.device.name ?? 'Phone'}</span>
                  <span className="truncate text-subtle-foreground">{osLabel(d.device)}</span>
                  <span className="ml-auto text-xs text-subtle-foreground tabular-nums">Last seen {ago(d.lastSeen, data.now)}</span>
                  <ArrowRightIcon className="size-4 text-subtle-foreground" aria-hidden="true" />
                </Link>
              ))}
            </FrameBody>
          </Frame>
        </Section>
      ) : null}
    </Page>
  );
}

function ConnectedDevice({ row, now }: { row: DeviceRow; now: number }) {
  return (
    <Frame>
      <FrameHeader className="min-h-10 gap-2">
        <span className="truncate text-foreground">{row.device.name ?? 'Phone'}</span>
        <span className="truncate font-normal">{osLabel(row.device)}</span>
        <LiveChip live />
        <span className="ml-auto flex min-w-0 items-center font-normal">
          <Activity active={row.active ?? undefined} live lastSeen={row.lastSeen} now={now} />
        </span>
      </FrameHeader>
      <FrameBody>
        <div className="flex flex-col gap-3 p-3">
          <DeviceStats sample={row.sample} platform={row.device.platform} />
          <Link
            href={`/traces/${encodeURIComponent(row.device.id)}`}
            className="flex w-fit items-center gap-1 rounded-md text-sm text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
            Open its traces <ArrowRightIcon className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </FrameBody>
    </Frame>
  );
}
