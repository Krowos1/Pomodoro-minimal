import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaultState } from '../src/js/state.js';
import { nextMode, resetTimerState, restoreExpiredSession, stopwatchSeconds, transition } from '../src/js/timer.js';

test('skipping focus marks it interrupted instead of completed', () => {
  const state = cloneDefaultState();
  state.remaining = 20 * 60;
  transition(state, 'interrupted', new Date('2026-09-19T12:00:00Z'));
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].status, 'interrupted');
  assert.equal(state.history[0].minutes, 5);
});

test('completed focus records planned duration', () => {
  const state = cloneDefaultState();
  state.remaining = 0;
  transition(state, 'completed', new Date('2026-09-19T12:00:00Z'));
  assert.equal(state.history[0].status, 'completed');
  assert.equal(state.history[0].minutes, 25);
});

test('disabled long break falls back to a short break', () => {
  const state = cloneDefaultState();
  state.round = 4;
  state.settings.longBreakEnabled = false;
  assert.equal(nextMode(state), 'short');
});

test('reset restores the full current-mode duration and stops the timer', () => {
  const state = cloneDefaultState();
  state.settings.focus = 40;
  state.total = 25 * 60;
  state.remaining = 12 * 60;
  state.isRunning = true;
  state.endAt = Date.now() + state.remaining * 1000;
  resetTimerState(state);
  assert.equal(state.total, 40 * 60);
  assert.equal(state.remaining, 40 * 60);
  assert.equal(state.isRunning, false);
  assert.equal(state.endAt, null);
});

test('stopwatch measures elapsed time and resets independently', () => {
  const state = cloneDefaultState();
  state.mode = 'stopwatch';
  state.isRunning = true;
  state.stopwatchElapsed = 12;
  state.stopwatchStartedAt = 1_000;
  assert.equal(stopwatchSeconds(state, 6_500), 17);
  resetTimerState(state);
  assert.equal(state.stopwatchElapsed, 0);
  assert.equal(state.isRunning, false);
  assert.equal(state.stopwatchStartedAt, null);
});

test('restore completes only the active session and stops auto-start chaining', () => {
  const state = cloneDefaultState();
  state.settings.autoStartBreak = true;
  state.settings.autoStartFocus = true;
  state.isRunning = true;
  state.endAt = Date.parse('2026-09-20T10:00:00Z');
  state.remaining = 0;
  const count = restoreExpiredSession(state, Date.parse('2026-09-21T10:00:00Z'));
  assert.equal(count, 1);
  assert.equal(state.history.length, 1);
  assert.equal(state.isRunning, false);
  assert.equal(state.mode, 'short');
  assert.equal(state.endAt, null);
});
