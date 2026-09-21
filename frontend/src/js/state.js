import { localDayKey } from './dates.js';

export const defaultState = Object.freeze({
  version: 3,
  mode: 'focus',
  isRunning: false,
  remaining: 25 * 60,
  total: 25 * 60,
  endAt: null,
  stopwatchElapsed: 0,
  stopwatchStartedAt: null,
  round: 1,
  activeSection: 'settings',
  theme: 'light',
  alwaysOnTop: false,
  windowedMode: false,
  compactMode: false,
  settings: {
    focus: 25,
    short: 5,
    long: 15,
    rounds: 4,
    dailyGoal: 120,
    longBreakEnabled: true,
    autoStartFocus: false,
    autoStartBreak: false,
    sound: true,
    soundChoice: 'ringtone',
    volume: 70
  },
  title: '',
  history: []
});

export const modes = ['focus', 'short', 'long', 'stopwatch'];
export const sections = ['settings', 'stats', 'history'];

export function cloneDefaultState() {
  return structuredClone(defaultState);
}

export function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function validateImportPayload(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Import must contain an object.');
  if (![2, 3].includes(Number(parsed.version))) throw new Error('Unsupported or missing export version.');
  if (!modes.includes(parsed.mode)) throw new Error('Import contains an invalid timer mode.');
  if (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) throw new Error('Import settings are missing.');
  if (!Array.isArray(parsed.history)) throw new Error('Import history is missing.');
  return parsed;
}

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function sanitizeState(raw) {
  const base = cloneDefaultState();
  if (!raw) return base;

  const candidate = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return base;
  const parsed = candidate;
  const incomingSettings = parsed.settings || {};
  const settings = { ...base.settings, ...incomingSettings };
  settings.focus = clampNumber(settings.focus, 25, 1, 180);
  settings.short = clampNumber(settings.short, 5, 1, 60);
  settings.long = clampNumber(settings.long, 15, 1, 120);
  settings.rounds = clampNumber(settings.rounds, 4, 1, 12);
  settings.dailyGoal = clampNumber(settings.dailyGoal, 120, 1, 1440);
  settings.volume = clampNumber(settings.volume, 70, 0, 100);
  settings.longBreakEnabled = settings.longBreakEnabled !== false;
  settings.autoStartFocus = Boolean(Object.hasOwn(incomingSettings, 'autoStartFocus') ? incomingSettings.autoStartFocus : incomingSettings.autoStart);
  settings.autoStartBreak = Boolean(Object.hasOwn(incomingSettings, 'autoStartBreak') ? incomingSettings.autoStartBreak : incomingSettings.autoStart);
  settings.sound = settings.sound !== false;
  settings.soundChoice = ['ringtone', 'bell'].includes(settings.soundChoice) ? settings.soundChoice : 'ringtone';

  const mode = modes.includes(parsed.mode) ? parsed.mode : 'focus';
  const total = mode === 'stopwatch' ? 0 : (mode === 'focus' ? settings.focus : mode === 'short' ? settings.short : settings.long) * 60;
  const history = Array.isArray(parsed.history) ? parsed.history.slice(0, 1000).filter(Boolean).map((item) => {
    const kind = item.kind === 'stopwatch' ? 'stopwatch' : 'pomodoro';
    const finishedAt = validDate(item.finishedAt) ? item.finishedAt : new Date().toISOString();
    const durationSeconds = clampNumber(item.durationSeconds ?? Number(item.minutes || 0) * 60, 0, 0, 31_536_000);
    return {
      id: String(item.id || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`),
      title: String(item.title || 'Focus session').slice(0, 70),
      minutes: kind === 'stopwatch' ? durationSeconds / 60 : clampNumber(item.minutes, settings.focus, 0, 1440),
      plannedMinutes: clampNumber(item.plannedMinutes ?? item.minutes, settings.focus, 1, 1440),
      kind,
      durationSeconds,
      status: item.status === 'interrupted' ? 'interrupted' : 'completed',
      finishedAt,
      localDay: /^\d{4}-\d{2}-\d{2}$/.test(item.localDay || '') ? item.localDay : localDayKey(new Date(finishedAt)),
      timeZone: String(item.timeZone || '').slice(0, 80)
    };
  }) : [];

  const result = {
    ...base,
    ...parsed,
    version: 3,
    mode,
    settings,
    history,
    activeSection: sections.includes(parsed.activeSection) ? parsed.activeSection : 'settings',
    theme: parsed.theme === 'dark' ? 'dark' : 'light',
    alwaysOnTop: Boolean(parsed.alwaysOnTop),
    windowedMode: Boolean(parsed.windowedMode),
    compactMode: Boolean(parsed.compactMode),
    round: clampNumber(parsed.round, 1, 1, settings.rounds),
    title: String(parsed.title || '').slice(0, 70),
    total,
    remaining: mode === 'stopwatch' ? 0 : clampNumber(parsed.remaining, total, 0, total),
    stopwatchElapsed: clampNumber(parsed.stopwatchElapsed, 0, 0, 31_536_000),
    stopwatchStartedAt: Number.isFinite(Number(parsed.stopwatchStartedAt)) ? Number(parsed.stopwatchStartedAt) : null,
    isRunning: Boolean(parsed.isRunning),
    endAt: Number.isFinite(Number(parsed.endAt)) ? Number(parsed.endAt) : null
  };

  if (result.mode === 'stopwatch') {
    result.endAt = null;
    if (result.isRunning && !result.stopwatchStartedAt) result.stopwatchStartedAt = Date.now();
  } else if (result.isRunning && !result.endAt) {
    result.endAt = Date.now() + result.remaining * 1000;
  }
  if (!result.isRunning) {
    result.endAt = null;
    result.stopwatchStartedAt = null;
  }
  return result;
}
