import { describe, expect, it } from 'vitest';

import { spread } from './eval-metrics';
import { batteryProjection, peakPlateau } from './eval-sustained';

describe('spread', () => {
  it('gives mean, sample sd and CV like the paper', () => {
    const s = spread([10, 12, 14]);
    expect(s.mean).toBe(12);
    expect(s.sd).toBe(2);
    expect(s.cv).toBeCloseTo(16.67, 1);
    expect([s.min, s.max]).toEqual([10, 14]);
  });
  it('has no spread for one run', () => expect(spread([5]).sd).toBeUndefined());
});

describe('peakPlateau', () => {
  it('compares the best run with the median of the last third', () => {
    // Throttles from 40 to about 24, like the paper's iPhone.
    const r = peakPlateau([40, 36, 26, 25, 25, 24, 24, 23, 24], true)!;
    expect(r.peak).toBe(40);
    expect(r.plateau).toBe(24);
    expect(r.dropPct).toBeCloseTo(40);
  });
  it('treats lower as better for times', () => {
    const r = peakPlateau([2, 2, 3, 3, 3, 3], false)!;
    expect(r.peak).toBe(2);
    expect(r.dropPct).toBeCloseTo(50);
  });
  it('needs three runs', () => expect(peakPlateau([1, 2], true)).toBeNull());
});

describe('batteryProjection', () => {
  const r = (startedAt: number, batteryStart: number, batteryEnd: number, charging = false) => ({ jobId: String(startedAt), scenarioId: 's', taskId: 't', startedAt, ok: true, metrics: { batteryStart, batteryEnd, charging } });
  it('projects runs per full charge from the session’s drain', () => {
    const p = batteryProjection([r(2, 0.97, 0.96), r(1, 1, 0.99), r(3, 0.96, 0.95)])!;
    expect(p.usedPct).toBeCloseTo(5);
    expect(p.perCharge).toBeCloseTo(60);
  });
  it('gives nothing when the phone charged', () => expect(batteryProjection([r(1, 0.5, 0.6, true)])).toBeNull());
});
