import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/ui/tooltip';
import { TraceExplorer, type RunRow, type TraceRow } from './explorer';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

const now = Date.now();
const trace = (id: string, over: Partial<TraceRow> = {}): TraceRow => ({
  traceId: id,
  name: `Gemma 4: ${id}`,
  start: now - 60_000,
  durationMs: 5000,
  status: 'ok',
  kind: 'turn',
  model: 'Gemma 4',
  modelCalls: 1,
  generatedTokens: 50,
  toolCalls: 0,
  tools: [],
  peakMemMB: 2900,
  cpuPct: 150,
  threadId: 'thread-1',
  input: `message ${id}`,
  output: `reply ${id}`,
  error: null,
  firstTokenMs: 400,
  decodeTps: 18,
  readTps: 400,
  promptTokens: 100,
  contextUsed: 800,
  memAddedMB: 40,
  minHeadroomMB: 600,
  thermalMax: 'nominal',
  batteryStart: 0.5,
  batteryEnd: 0.5,
  charging: false,
  energyJ: null,
  ...over,
});
const traces = [
  trace('t1', { tools: ['read_file'], toolCalls: 1 }),
  trace('t2', { threadId: 'thread-2', input: 'Write a haiku', status: 'error' }),
  trace('t3', { start: now - 3 * 86_400_000 }),
];
const runs: RunRow[] = [];

function renderExplorer(handlers: { onOpenTrace?: (id: string) => void; onOpenThread?: (id: string) => void } = {}) {
  return render(
    <TooltipProvider>
      <TraceExplorer traces={traces} runs={runs} now={now} onOpenTrace={handlers.onOpenTrace ?? vi.fn()} onOpenThread={handlers.onOpenThread ?? vi.fn()} />
    </TooltipProvider>
  );
}

const rowCount = () => within(screen.getByRole('table', { name: /traces|threads|runs/i })).getAllByRole('row').length - 1;

describe('TraceExplorer', () => {
  it('lists traces with their input and output', () => {
    renderExplorer();
    expect(screen.getByText('message t1')).toBeTruthy();
    expect(screen.getByText('reply t1')).toBeTruthy();
    expect(rowCount()).toBe(3);
  });

  it('narrows by time range', () => {
    renderExplorer();
    fireEvent.click(screen.getByRole('radio', { name: 'Last day' }));
    expect(rowCount()).toBe(2);
  });

  it('filters by a facet and by search', () => {
    renderExplorer();
    fireEvent.click(screen.getByRole('checkbox', { name: 'read_file' }));
    expect(rowCount()).toBe(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'read_file' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search traces' }), { target: { value: 'haiku' } });
    expect(rowCount()).toBe(1);
    expect(screen.getByText('Write a haiku')).toBeTruthy();
  });

  it('groups traces into threads and opens one', () => {
    const onOpenThread = vi.fn();
    renderExplorer({ onOpenThread });
    fireEvent.click(screen.getByRole('radio', { name: 'threads' }));
    expect(rowCount()).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Open Write a haiku' }));
    expect(onOpenThread).toHaveBeenCalledWith('thread-2');
  });
});
