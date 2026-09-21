import { localDayKey } from './dates.js';

export function secondsFor(state, mode = state.mode) {
  const settings = state.settings;
  if (mode === 'stopwatch') return 0;
  return (mode === 'focus' ? settings.focus : mode === 'short' ? settings.short : settings.long) * 60;
}

export function nextMode(state) {
  if (state.mode === 'focus') {
    const longBreakDue = state.round % state.settings.rounds === 0;
    return longBreakDue && state.settings.longBreakEnabled ? 'long' : 'short';
  }
  return 'focus';
}

export function shouldAutoStart(state, targetMode) {
  return targetMode === 'focus' ? state.settings.autoStartFocus : state.settings.autoStartBreak;
}

export function resetTimerState(state) {
  if (state.mode === 'stopwatch') {
    state.isRunning = false;
    state.endAt = null;
    state.stopwatchElapsed = 0;
    state.stopwatchStartedAt = null;
    state.total = 0;
    state.remaining = 0;
    return;
  }
  const duration = secondsFor(state);
  state.isRunning = false;
  state.endAt = null;
  state.total = duration;
  state.remaining = duration;
}

export function stopwatchSeconds(state, now = Date.now()) {
  const activeSeconds = state.mode === 'stopwatch' && state.isRunning && state.stopwatchStartedAt
    ? Math.max(0, Math.floor((now - state.stopwatchStartedAt) / 1000))
    : 0;
  return Math.max(0, Number(state.stopwatchElapsed || 0) + activeSeconds);
}

export function transition(state, outcome, finishedAt = new Date()) {
  const finishedMode = state.mode;
  if (finishedMode === 'focus') {
    const elapsedSeconds = Math.max(0, state.total - state.remaining);
    const minutes = outcome === 'completed'
      ? state.settings.focus
      : Math.max(0, Math.min(state.settings.focus, Math.round(elapsedSeconds / 60)));
    state.history.unshift({
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      title: state.title.trim() || 'Focus session',
      minutes,
      plannedMinutes: state.settings.focus,
      durationSeconds: outcome === 'completed' ? state.settings.focus * 60 : elapsedSeconds,
      kind: 'pomodoro',
      status: outcome,
      finishedAt: finishedAt.toISOString(),
      localDay: localDayKey(finishedAt),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    });
    state.history = state.history.slice(0, 1000);
  }

  const targetMode = nextMode(state);
  if (finishedMode !== 'focus') {
    state.round = state.round >= state.settings.rounds ? 1 : state.round + 1;
  }
  state.mode = targetMode;
  state.total = secondsFor(state, targetMode);
  state.remaining = state.total;
  state.isRunning = shouldAutoStart(state, targetMode);
  state.endAt = state.isRunning ? finishedAt.getTime() + state.total * 1000 : null;
  return { finishedMode, targetMode };
}

export function restoreExpiredSession(state, now = Date.now()) {
  if (state.mode === 'stopwatch' || !state.isRunning || !state.endAt || state.endAt > now) return 0;
  const finishedAt = new Date(state.endAt);
  state.remaining = 0;
  transition(state, 'completed', finishedAt);
  state.isRunning = false;
  state.endAt = null;
  return 1;
}
