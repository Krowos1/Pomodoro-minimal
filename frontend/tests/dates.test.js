import test from 'node:test';
import assert from 'node:assert/strict';
import { addLocalDays, completedSeconds, computeStreak, historyDayKey, localDayKey, recentLocalDays, statsForPeriod } from '../src/js/dates.js';

test('localDayKey uses the local calendar date', () => {
  const date = new Date(2026, 8, 19, 23, 55);
  assert.equal(localDayKey(date), '2026-09-19');
});

test('calendar day iteration stays at local midday across DST changes', () => {
  const days = recentLocalDays(7, new Date(2026, 2, 31, 20));
  assert.equal(days.length, 7);
  assert.ok(days.every((date) => date.getHours() === 12));
  assert.equal(localDayKey(addLocalDays(days[5], 1)), localDayKey(days[6]));
});

test('streak includes yesterday when there is no session today', () => {
  const now = new Date(2026, 8, 19, 10);
  const history = [1, 2, 3].map((offset) => ({
    status: 'completed',
    finishedAt: addLocalDays(now, -offset).toISOString()
  }));
  assert.equal(computeStreak(history, now), 3);
});

test('stopwatch statistics preserve exact seconds', () => {
  assert.equal(completedSeconds([{ kind: 'stopwatch', durationSeconds: 5, status: 'completed' }]), 5);
});

test('stored local day wins over recalculating the UTC timestamp', () => {
  assert.equal(historyDayKey({ localDay: '2026-09-20', finishedAt: '2026-09-21T01:00:00Z' }), '2026-09-20');
});

test('period statistics use the stored local day after a time-zone change', () => {
  const history = [{
    localDay: '2026-09-20',
    finishedAt: '2026-09-21T01:00:00Z',
    minutes: 25,
    status: 'completed'
  }];
  const stats = statsForPeriod(history, new Date(2026, 8, 20), new Date(2026, 8, 21));
  assert.equal(stats.minutes, 25);
});
