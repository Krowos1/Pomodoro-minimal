import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeState, validateImportPayload } from '../src/js/state.js';

test('sanitizeState rejects invalid modes and clamps settings', () => {
  const state = sanitizeState(JSON.stringify({
    mode: 'invalid',
    settings: { focus: 900, volume: -20 },
    activeSection: 'invalid'
  }));
  assert.equal(state.mode, 'focus');
  assert.equal(state.settings.focus, 180);
  assert.equal(state.settings.volume, 0);
  assert.equal(state.activeSection, 'settings');
});

test('sanitizeState safely resets structurally invalid saved JSON', () => {
  assert.equal(sanitizeState('null').mode, 'focus');
  assert.equal(sanitizeState('[]').history.length, 0);
});

test('legacy autoStart setting migrates to both modes', () => {
  const state = sanitizeState({ settings: { autoStart: true } });
  assert.equal(state.settings.autoStartFocus, true);
  assert.equal(state.settings.autoStartBreak, true);
});

test('compact window preference is restored as a boolean', () => {
  assert.equal(sanitizeState({ compactMode: true }).compactMode, true);
  assert.equal(sanitizeState({ compactMode: 0 }).compactMode, false);
});

test('running stopwatch state survives sanitization', () => {
  const state = sanitizeState({
    mode: 'stopwatch',
    isRunning: true,
    stopwatchElapsed: 45,
    stopwatchStartedAt: 123456
  });
  assert.equal(state.mode, 'stopwatch');
  assert.equal(state.isRunning, true);
  assert.equal(state.stopwatchElapsed, 45);
  assert.equal(state.stopwatchStartedAt, 123456);
  assert.equal(state.endAt, null);
});

test('import validation rejects generic JSON and accepts supported exports', () => {
  assert.throws(() => validateImportPayload('{}'));
  assert.throws(() => validateImportPayload({ version: 99, mode: 'focus', settings: {}, history: [] }));
  assert.doesNotThrow(() => validateImportPayload({ version: 3, mode: 'focus', settings: {}, history: [] }));
});

test('history migration freezes the original local day', () => {
  const state = sanitizeState({ version: 2, history: [{ finishedAt: '2026-09-20T20:30:00Z', minutes: 25 }] });
  assert.match(state.history[0].localDay, /^\d{4}-\d{2}-\d{2}$/);
});
