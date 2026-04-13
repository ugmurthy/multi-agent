import { describe, expect, it } from 'vitest';

import { computeNextCronFireAt } from './cron-schedule.js';

describe('computeNextCronFireAt', () => {
  it('computes the next fire time for stepped schedules', () => {
    const next = computeNextCronFireAt('*/5 * * * *', '2026-01-01T00:00:00.000Z');

    expect(next?.toISOString()).toBe('2026-01-01T00:05:00.000Z');
  });

  it('supports named weekdays and POSIX day matching', () => {
    const next = computeNextCronFireAt('30 9 15 * MON-FRI', '2026-02-14T09:30:00.000Z');

    expect(next?.toISOString()).toBe('2026-02-15T09:30:00.000Z');
  });

  it('supports predefined nicknames', () => {
    const next = computeNextCronFireAt('@daily', '2026-01-01T12:34:56.000Z');

    expect(next?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('throws on invalid schedules', () => {
    expect(() => computeNextCronFireAt('not-a-cron', '2026-01-01T00:00:00.000Z')).toThrowError(
      /5 fields|invalid/,
    );
  });
});
