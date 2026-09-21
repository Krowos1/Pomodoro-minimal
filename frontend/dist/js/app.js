import { clampNumber, cloneDefaultState, sanitizeState, validateImportPayload } from './state.js';
import {
  addLocalDays,
  completedSeconds,
  computeStreak,
  historyDayKey,
  localDayKey,
  nextLocalMonth,
  recentLocalDays,
  startOfLocalMonth,
  startOfLocalWeek,
  statsForPeriod
} from './dates.js';
import { nextMode, resetTimerState, restoreExpiredSession, secondsFor, stopwatchSeconds, transition } from './timer.js';

const $ = (id) => document.getElementById(id);
const modeNames = { focus: 'Focus', short: 'Short Break', long: 'Long Break', stopwatch: 'Stopwatch' };
const modeColors = {
  focus: { hex: '#087cf0', rgb: '8,124,240' },
  short: { hex: '#20a75a', rgb: '32,167,90' },
  long: { hex: '#9957d5', rgb: '153,87,213' },
  stopwatch: { hex: '#e87924', rgb: '232,121,36' }
};
const ringLength = 2 * Math.PI * 122;

let state = cloneDefaultState();
let tick = null;
let saveTimer = null;
let saveRetryTimer = null;
let saveInFlight = false;
let saveQueued = false;
let toastTimer = null;
let pendingImport = null;
let resetWasRunning = false;
let historyFilter = '';
let historyPage = 0;
let chartDays = 7;
const historyPageSize = 6;
const soundNames = { ringtone: 'Ringtone', bell: 'Soft bell' };

const backend = {
  async load() {
    if (window.go?.main?.App?.LoadState) return window.go.main.App.LoadState();
    return localStorage.getItem('apple-pomodoro-state') || '';
  },
  async save(data) {
    if (window.go?.main?.App?.SaveState) return window.go.main.App.SaveState(data);
    localStorage.setItem('apple-pomodoro-state', data);
  },
  async export(data) {
    if (window.go?.main?.App?.ExportState) return window.go.main.App.ExportState(data);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pomodoro-export-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
    return link.download;
  },
  async import() {
    if (window.go?.main?.App?.ImportState) return window.go.main.App.ImportState();
    $('browserImport').click();
    return '';
  },
  setAlwaysOnTop(enabled) {
    return window.go?.main?.App?.SetAlwaysOnTop?.(enabled);
  },
  setCompactMode(enabled, windowed) {
    return window.go?.main?.App?.SetCompactMode?.(enabled, windowed);
  },
  setWindowedMode(enabled) {
    return window.go?.main?.App?.SetWindowedMode?.(enabled);
  },
  minimise() {
    return window.go?.main?.App?.Minimise?.();
  },
  closeWindow() {
    return window.go?.main?.App?.CloseWindow?.();
  },
  hideToTray() {
    return window.go?.main?.App?.HideToTray?.();
  },
  revealForAlert() {
    return window.go?.main?.App?.RevealForAlert?.();
  },
  showWindow() {
    return window.go?.main?.App?.ShowWindow?.();
  }
};

const ringtone = new Audio('./assets/rington1.mp3');
ringtone.preload = 'auto';

function pad(value) { return String(value).padStart(2, '0'); }
function formatTime(seconds) { return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`; }
function formatDuration(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor(safe % 3600 / 60);
  const secs = safe % 60;
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}
function formatMinutes(seconds) {
  const minutes = Math.max(0, Number(seconds || 0)) / 60;
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1).replace(/\.0$/, '');
}
function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function showToast(message, isError = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.style.background = isError ? 'rgba(168, 35, 50, .95)' : '';
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function snapshot() {
  return JSON.stringify(state, null, 2);
}

function saveNow(force = false) {
  clearTimeout(saveTimer);
  $('autosaveNote')?.classList.add('saving');
  if ($('autosaveNote')) $('autosaveNote').textContent = 'Saving…';
  if (!force) {
    saveTimer = setTimeout(() => saveNow(true), 500);
    return;
  }
  void flushSaveQueue();
}

async function flushSaveQueue() {
  if (saveInFlight) {
    saveQueued = true;
    return;
  }
  saveInFlight = true;
  do {
    saveQueued = false;
    try {
      await backend.save(snapshot());
      clearTimeout(saveRetryTimer);
      $('autosaveNote')?.classList.remove('saving');
      if ($('autosaveNote')) $('autosaveNote').textContent = 'Saved automatically';
    } catch (error) {
      console.error(error);
      $('autosaveNote')?.classList.remove('saving');
      if ($('autosaveNote')) $('autosaveNote').textContent = 'Save failed — retrying…';
      showToast(`Could not save data: ${error}`, true);
      clearTimeout(saveRetryTimer);
      saveRetryTimer = setTimeout(() => saveNow(true), 5000);
      break;
    }
  } while (saveQueued);
  saveInFlight = false;
}

function syncRemaining(now = Date.now()) {
  if (state.mode === 'stopwatch' || !state.isRunning || !state.endAt) return;
  state.remaining = Math.max(0, Math.ceil((state.endAt - now) / 1000));
}

function pauseStopwatch(now = Date.now()) {
  state.stopwatchElapsed = stopwatchSeconds(state, now);
  state.stopwatchStartedAt = null;
  state.isRunning = false;
}

function playBell() {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const gain = context.createGain();
  gain.gain.value = Math.max(.0001, state.settings.volume / 100 * .6);
  gain.connect(context.destination);
  [660, 880, 1100].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const noteGain = context.createGain();
    const start = context.currentTime + index * .18;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    noteGain.gain.setValueAtTime(.0001, start);
    noteGain.gain.exponentialRampToValueAtTime(.75, start + .02);
    noteGain.gain.exponentialRampToValueAtTime(.0001, start + 1.1);
    oscillator.connect(noteGain).connect(gain);
    oscillator.start(start);
    oscillator.stop(start + 1.15);
  });
  setTimeout(() => context.close(), 1800);
}

async function playCompletionSound() {
  if (!state.settings.sound || state.settings.volume <= 0) return;
  try {
    if (state.settings.soundChoice === 'bell') {
      playBell();
    } else {
      ringtone.pause();
      ringtone.currentTime = 0;
      ringtone.volume = state.settings.volume / 100;
      await ringtone.play();
    }
    navigator.vibrate?.([250, 120, 350]);
  } catch (error) {
    console.warn('Sound failed', error);
    showToast('The completion sound could not be played.', true);
  }
}

function notificationText(finishedMode) {
  return finishedMode === 'focus'
    ? ['Focus complete', 'Good work. It is time for a break.']
    : ['Break complete', 'Ready for the next focus session?'];
}

function completeCurrent(outcome = 'completed', finishedAt = new Date(), announce = true) {
  if (outcome === 'interrupted') syncRemaining();
  const { finishedMode } = transition(state, outcome, finishedAt);
  if (announce) {
    if (outcome === 'completed') {
      playCompletionSound();
      const [, body] = notificationText(finishedMode);
      showToast(body);
      if (document.hidden && (!state.settings.sound || state.settings.volume <= 0)) backend.revealForAlert();
    } else {
      showToast(finishedMode === 'focus' ? 'Focus session skipped and marked interrupted.' : 'Break skipped.');
    }
  }
  ensureTicker();
  render();
  saveNow(true);
}

function restoreTimer() {
  if (state.mode === 'stopwatch') return 0;
  const now = Date.now();
  const completed = restoreExpiredSession(state, now);
  if (!completed && state.isRunning && state.endAt) syncRemaining(now);
  return completed;
}

function ensureTicker() {
  clearInterval(tick);
  tick = null;
  if (!state.isRunning) {
    state.endAt = null;
    state.stopwatchStartedAt = null;
    return;
  }
  if (state.mode === 'stopwatch') {
    state.endAt = null;
    if (!state.stopwatchStartedAt) state.stopwatchStartedAt = Date.now();
    tick = setInterval(renderTimerOnly, 200);
    return;
  }
  if (!state.endAt) state.endAt = Date.now() + state.remaining * 1000;
  tick = setInterval(() => {
    syncRemaining();
    if (state.remaining <= 0) {
      const finishedAt = new Date(state.endAt);
      clearInterval(tick);
      tick = null;
      completeCurrent('completed', finishedAt);
    } else {
      renderTimerOnly();
    }
  }, 250);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $('themeToggle').setAttribute('aria-label', state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  document.querySelector('meta[name="theme-color"]').content = state.theme === 'dark' ? '#0b111d' : '#f4f6fa';
}

function setSwitch(id, enabled) {
  const element = $(id);
  element.classList.toggle('on', enabled);
  element.setAttribute('aria-checked', String(enabled));
}

function renderTimerOnly() {
  if (state.mode === 'stopwatch') {
    const elapsed = stopwatchSeconds(state);
    const hours = Math.floor(elapsed / 3600);
    $('timeHours').hidden = hours === 0;
    $('hoursColon').hidden = hours === 0;
    $('timeHours').textContent = pad(hours);
    $('timeMinutes').textContent = pad(hours ? Math.floor(elapsed % 3600 / 60) : Math.floor(elapsed / 60));
    $('timeSeconds').textContent = pad(elapsed % 60);
    $('timePanel').setAttribute('aria-label', `Stopwatch, ${formatDuration(elapsed)} elapsed`);
    $('ring').style.strokeDashoffset = String(ringLength * (1 - (elapsed % 60) / 60));
    document.title = state.isRunning ? `${formatDuration(elapsed)} — Stopwatch` : 'Pomodoro';
    return;
  }
  const remaining = Math.max(0, state.remaining);
  $('timeHours').hidden = true;
  $('hoursColon').hidden = true;
  $('timeMinutes').textContent = pad(Math.floor(remaining / 60));
  $('timeSeconds').textContent = pad(remaining % 60);
  $('timePanel').setAttribute('aria-label', `${modeNames[state.mode]}, ${formatTime(remaining)} remaining`);
  const progress = state.total > 0 ? remaining / state.total : 0;
  $('ring').style.strokeDashoffset = String(ringLength * (1 - progress));
  document.title = state.isRunning ? `${formatTime(remaining)} — ${modeNames[state.mode]}` : 'Pomodoro';
}

function renderPeriodChart() {
  const items = recentLocalDays(chartDays).map((date, index) => {
    const key = localDayKey(date);
    const seconds = completedSeconds(state.history.filter((item) => historyDayKey(item) === key));
    const minutes = seconds / 60;
    const showLabel = chartDays === 7 || index === 0 || index === chartDays - 1 || index % 5 === 0;
    const label = chartDays === 7
      ? date.toLocaleDateString(undefined, { weekday: 'short' })
      : showLabel ? String(date.getDate()) : '';
    return { label, minutes, dateLabel: date.toLocaleDateString(undefined, { dateStyle: 'medium' }) };
  });
  const max = Math.max(25, ...items.map((item) => item.minutes));
  $('weekChart').style.setProperty('--chart-columns', chartDays);
  $('weekChart').innerHTML = items.map((item) => `
    <div class="bar" title="${escapeHTML(item.dateLabel)}: ${item.minutes} minutes">
      <span class="bar-value">${item.minutes ? formatMinutes(item.minutes * 60) : ''}</span>
      <div class="bar-fill" style="height:${item.minutes ? Math.max(4, item.minutes / max * 88) : 0}px"></div>
      <small>${escapeHTML(item.label)}</small>
    </div>`).join('');
}

function renderStats() {
  const now = new Date();
  const today = localDayKey(now);
  const todayItems = state.history.filter((item) => historyDayKey(item) === today && item.status !== 'interrupted');
  const todaySeconds = completedSeconds(todayItems);
  const todayMinutes = todaySeconds / 60;
  const week = statsForPeriod(state.history, startOfLocalWeek(now), addLocalDays(startOfLocalWeek(now), 7));
  const month = statsForPeriod(state.history, startOfLocalMonth(now), nextLocalMonth(now));
  $('todayFocus').textContent = formatMinutes(todaySeconds);
  $('todaySessions').textContent = todayItems.length;
  $('streak').textContent = computeStreak(state.history, now);
  $('goalText').textContent = `${formatMinutes(todaySeconds)} / ${state.settings.dailyGoal} min`;
  $('goalProgress').max = state.settings.dailyGoal;
  $('goalProgress').value = Math.min(todayMinutes, state.settings.dailyGoal);
  const goalPercent = Math.min(100, Math.round(todaySeconds / (state.settings.dailyGoal * 60) * 100));
  $('goalPercent').textContent = `${goalPercent}%`;
  $('goalRing').style.setProperty('--goal', `${goalPercent * 3.6}deg`);
  $('goalMessage').textContent = goalPercent >= 100 ? 'Daily goal complete — excellent work' : todaySeconds ? `${formatMinutes(Math.max(0, state.settings.dailyGoal * 60 - todaySeconds))} minutes left today` : 'Start your first focus session';
  $('weekTotal').textContent = `${formatMinutes(week.seconds)} min`;
  $('monthTotal').textContent = `${formatMinutes(month.seconds)} min`;
  $('completedTotal').textContent = state.history.filter((item) => item.status !== 'interrupted').length;
  $('interruptedTotal').textContent = state.history.filter((item) => item.status === 'interrupted').length;
  renderPeriodChart();
}

function renderHistory() {
  const query = historyFilter.trim().toLocaleLowerCase();
  const items = state.history.filter((item) => !query || item.title.toLocaleLowerCase().includes(query));
  if (!items.length) {
    $('history').innerHTML = `<div class="empty">${state.history.length ? 'No matching sessions.' : 'No focus sessions yet.'}</div>`;
    $('historyPagination').hidden = true;
    return;
  }
  const pageCount = Math.max(1, Math.ceil(items.length / historyPageSize));
  historyPage = Math.min(historyPage, pageCount - 1);
  const pageItems = items.slice(historyPage * historyPageSize, (historyPage + 1) * historyPageSize);
  $('historyPagination').hidden = pageCount <= 1;
  $('historyPageLabel').textContent = `Page ${historyPage + 1} of ${pageCount}`;
  $('historyPrev').disabled = historyPage === 0;
  $('historyNext').disabled = historyPage >= pageCount - 1;
  $('history').innerHTML = pageItems.map((item) => {
    const interrupted = item.status === 'interrupted';
    const date = new Date(item.finishedAt);
    return `<div class="history-item">
      <div>
        <div class="history-title">${escapeHTML(item.title)}</div>
        <div class="history-meta">${escapeHTML(date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}<span class="history-status ${interrupted ? 'interrupted' : ''}">${interrupted ? 'Interrupted' : 'Completed'}</span></div>
      </div>
      <div class="history-duration">${item.kind === 'stopwatch' ? formatDuration(item.durationSeconds) : `${item.minutes} min`}</div>
      <div class="history-actions">
        <button type="button" data-action="edit" data-id="${escapeHTML(item.id)}" aria-label="Edit ${escapeHTML(item.title)}" title="Edit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z"/></svg></button>
        <button type="button" data-action="delete" data-id="${escapeHTML(item.id)}" aria-label="Delete ${escapeHTML(item.title)}" title="Delete"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

function render() {
  applyTheme();
  const accent = modeColors[state.mode];
  document.documentElement.style.setProperty('--accent', accent.hex);
  document.documentElement.style.setProperty('--accent-rgb', accent.rgb);
  document.body.classList.toggle('compact', state.compactMode);
  document.body.classList.toggle('windowed', state.windowedMode);
  document.body.classList.toggle('stopwatch-mode', state.mode === 'stopwatch');
  $('modeLabel').textContent = modeNames[state.mode];
  $('roundLabel').textContent = state.mode === 'stopwatch' ? 'Elapsed time' : `Round ${state.round} of ${state.settings.rounds}`;
  $('startPauseBtn').querySelector('span').textContent = state.isRunning ? 'Pause' : 'Start';
  $('startPauseBtn').classList.toggle('running', state.isRunning);
  $('skipBtn').querySelector('span').textContent = state.mode === 'stopwatch' ? 'Finish' : 'Skip';
  $('skipBtn').setAttribute('aria-label', state.mode === 'stopwatch' ? 'Finish and save stopwatch session' : 'Skip current session');
  $('skipBtn').title = state.mode === 'stopwatch' ? 'Finish and save' : 'Skip current session';
  $('skipShortcutLabel').textContent = state.mode === 'stopwatch' ? 'finish' : 'skip';
  $('taskTitleLabel').textContent = state.mode === 'stopwatch' ? 'Task title' : 'Focus session title';
  $('ring').style.stroke = accent.hex;
  $('ring').style.strokeDasharray = String(ringLength);
  $('soundToggle').setAttribute('aria-pressed', String(state.settings.sound));
  $('pinMenuBtn').setAttribute('aria-checked', String(state.alwaysOnTop));
  $('compactMenuBtn').setAttribute('aria-checked', String(state.compactMode));
  $('windowModeMenuBtn').setAttribute('aria-checked', String(state.windowedMode));
  setSwitch('longBreakEnabled', state.settings.longBreakEnabled);
  setSwitch('autoStartBreak', state.settings.autoStartBreak);
  setSwitch('autoStartFocus', state.settings.autoStartFocus);
  setSwitch('soundSetting', state.settings.sound);
  setSwitch('pinSetting', state.alwaysOnTop);
  setSwitch('windowModeSetting', state.windowedMode);
  setSwitch('compactSetting', state.compactMode);
  $('toggleWindowBtn').setAttribute('aria-label', state.windowedMode ? 'Maximize window' : 'Switch to windowed mode');
  $('toggleWindowBtn').title = state.windowedMode ? 'Maximize' : 'Windowed mode';
  $('sessionTitle').value = state.title;
  $('focusMin').value = state.settings.focus;
  $('shortMin').value = state.settings.short;
  $('longMin').value = state.settings.long;
  $('rounds').value = state.settings.rounds;
  $('dailyGoal').value = state.settings.dailyGoal;
  $('soundSelectLabel').textContent = soundNames[state.settings.soundChoice] || soundNames.ringtone;
  document.querySelectorAll('#soundSelectMenu [data-value]').forEach((option) => option.setAttribute('aria-selected', String(option.dataset.value === state.settings.soundChoice)));
  $('volume').value = state.settings.volume;
  $('volumeValue').textContent = `${state.settings.volume}%`;
  $('currentTaskLabel').textContent = state.title.trim() || (state.mode === 'stopwatch' ? 'Untitled task' : 'Untitled focus session');
  const upcomingMode = nextMode(state);
  $('nextModeLabel').textContent = state.mode === 'stopwatch' ? 'Finish to save in history' : `${modeNames[upcomingMode]} · ${Math.round(secondsFor(state, upcomingMode) / 60)} min`;
  $('roundIndicators').innerHTML = state.mode === 'stopwatch' ? '' : Array.from({ length: state.settings.rounds }, (_, index) => {
    const round = index + 1;
    const className = round < state.round ? 'done' : round === state.round ? 'current' : '';
    return `<span class="round-dot ${className}" aria-label="Round ${round}${round === state.round ? ', current' : round < state.round ? ', complete' : ''}"></span>`;
  }).join('');
  document.querySelectorAll('#modeTabs button').forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('#sectionTabs button').forEach((button) => {
    const active = button.dataset.section === state.activeSection;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.tab-section').forEach((section) => section.classList.toggle('active', section.id === `${state.activeSection}Section`));
  renderTimerOnly();
  renderStats();
  renderHistory();
}

function setSection(section) {
  state.activeSection = section;
  render();
  saveNow();
}

function setMode(mode) {
  if (mode === state.mode) return;
  if (state.isRunning) {
    showToast('Pause or skip the running timer before changing mode.');
    return;
  }
  state.mode = mode;
  state.total = secondsFor(state, mode);
  state.remaining = state.total;
  state.endAt = null;
  state.stopwatchStartedAt = null;
  render();
  saveNow(true);
}

function toggleTimer() {
  if (state.mode === 'stopwatch') {
    if (state.isRunning) pauseStopwatch();
    else {
      state.isRunning = true;
      state.stopwatchStartedAt = Date.now();
    }
    ensureTicker();
    render();
    saveNow(true);
    return;
  }
  if (state.isRunning) {
    syncRemaining();
    state.isRunning = false;
    state.endAt = null;
  } else {
    state.isRunning = true;
    state.endAt = Date.now() + state.remaining * 1000;
  }
  ensureTicker();
  render();
  saveNow(true);
}

function resetTimer() {
  if (state.mode === 'stopwatch' && stopwatchSeconds(state) > 0) {
    resetWasRunning = state.isRunning;
    if (state.isRunning) pauseStopwatch();
    ensureTicker();
    render();
    saveNow(true);
    $('resetStopwatchDialog').showModal();
    return;
  }
  performReset();
}

function performReset() {
  resetTimerState(state);
  ensureTicker();
  render();
  saveNow(true);
  showToast('Timer reset.');
}

function skipCurrent() {
  if (state.mode === 'stopwatch') {
    const elapsed = stopwatchSeconds(state);
    if (elapsed <= 0) {
      showToast('Start the stopwatch before finishing.');
      return;
    }
    pauseStopwatch();
    const minutes = elapsed / 60;
    const finishedAt = new Date();
    state.history.unshift({
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      title: state.title.trim() || 'Stopwatch task',
      minutes,
      plannedMinutes: minutes,
      durationSeconds: elapsed,
      kind: 'stopwatch',
      status: 'completed',
      finishedAt: finishedAt.toISOString(),
      localDay: localDayKey(finishedAt),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    });
    state.history = state.history.slice(0, 1000);
    resetTimerState(state);
    ensureTicker();
    render();
    saveNow(true);
    showToast(`Stopwatch session saved: ${formatDuration(elapsed)}.`);
    return;
  }
  completeCurrent('interrupted');
}

function applySettingsFromInputs() {
  syncRemaining();
  const oldTotal = state.total;
  const wasUntouched = !state.isRunning && state.remaining === oldTotal;
  state.settings.focus = clampNumber($('focusMin').value, 25, 1, 180);
  state.settings.short = clampNumber($('shortMin').value, 5, 1, 60);
  state.settings.long = clampNumber($('longMin').value, 15, 1, 120);
  state.settings.rounds = clampNumber($('rounds').value, 4, 1, 12);
  state.settings.dailyGoal = clampNumber($('dailyGoal').value, 120, 1, 1440);
  state.round = Math.min(state.round, state.settings.rounds);
  state.total = secondsFor(state);
  if (wasUntouched) state.remaining = state.total;
  else state.remaining = Math.max(1, Math.min(state.total, Math.round(state.total * state.remaining / Math.max(1, oldTotal))));
  if (state.isRunning) state.endAt = Date.now() + state.remaining * 1000;
  ensureTicker();
  render();
  saveNow(true);
}

function toggleSetting(key, id) {
  state.settings[key] = !state.settings[key];
  render();
  saveNow(true);
}

function toggleSound() {
  state.settings.sound = !state.settings.sound;
  render();
  saveNow(true);
}

function closeActionMenu() {
  $('actionMenu').hidden = true;
  $('moreMenuBtn').setAttribute('aria-expanded', 'false');
}

function closeSoundSelect() {
  $('soundSelectMenu').hidden = true;
  $('soundSelectButton').setAttribute('aria-expanded', 'false');
}

async function togglePin() {
  const next = !state.alwaysOnTop;
  try {
    await backend.setAlwaysOnTop(next);
    state.alwaysOnTop = next;
  } catch (error) { showToast(`Could not change window mode: ${error}`, true); }
  render();
  saveNow(true);
}

async function toggleCompactMode() {
  const next = !state.compactMode;
  try {
    await backend.setCompactMode(next, state.windowedMode);
    state.compactMode = next;
  }
  catch (error) { showToast(`Could not change compact mode: ${error}`, true); }
  closeActionMenu();
  render();
  saveNow(true);
}

async function toggleWindowedMode() {
  const next = state.compactMode ? true : !state.windowedMode;
  try {
    await backend.setWindowedMode(next);
    state.windowedMode = next;
    state.compactMode = false;
  }
  catch (error) { showToast(`Could not change window mode: ${error}`, true); }
  closeActionMenu();
  render();
  saveNow(true);
}

function requestImport(raw) {
  try {
    pendingImport = sanitizeState(validateImportPayload(raw));
    $('importSummary').textContent = `Replace the current data with ${pendingImport.history.length} imported session(s)? A backup of the current state will be kept.`;
    $('importDialog').showModal();
  } catch (error) {
    console.error(error);
    pendingImport = null;
    showToast(`Invalid Pomodoro export: ${error.message || error}`, true);
  }
}

function applyPendingImport() {
  if (!pendingImport) return;
  state = pendingImport;
  pendingImport = null;
  const completed = restoreTimer();
  ensureTicker();
  backend.setAlwaysOnTop(state.alwaysOnTop);
  backend.setCompactMode(state.compactMode, state.windowedMode);
  render();
  backend.showWindow();
  saveNow(true);
  showToast(completed ? 'Imported data. One expired session was restored.' : 'Data imported successfully.');
}

function moveTabFocus(event, container, activate) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...container.querySelectorAll('button[role="tab"]')];
  const current = Math.max(0, buttons.indexOf(event.target.closest('button[role="tab"]')));
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[index].focus();
  activate(buttons[index]);
}

function selectSoundOption(option) {
  if (!option) return;
  state.settings.soundChoice = option.dataset.value;
  closeSoundSelect();
  render();
  saveNow(true);
}

function wireEvents() {
  $('sectionTabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-section]');
    if (button) setSection(button.dataset.section);
  });
  $('modeTabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (button) setMode(button.dataset.mode);
  });
  $('sectionTabs').addEventListener('keydown', (event) => moveTabFocus(event, $('sectionTabs'), (button) => setSection(button.dataset.section)));
  $('modeTabs').addEventListener('keydown', (event) => moveTabFocus(event, $('modeTabs'), (button) => setMode(button.dataset.mode)));
  $('startPauseBtn').addEventListener('click', toggleTimer);
  $('resetBtn').addEventListener('click', resetTimer);
  $('skipBtn').addEventListener('click', skipCurrent);
  ['focusMin', 'shortMin', 'longMin', 'rounds', 'dailyGoal'].forEach((id) => $(id).addEventListener('change', applySettingsFromInputs));
  $('longBreakEnabled').addEventListener('click', () => toggleSetting('longBreakEnabled', 'longBreakEnabled'));
  $('autoStartBreak').addEventListener('click', () => toggleSetting('autoStartBreak', 'autoStartBreak'));
  $('autoStartFocus').addEventListener('click', () => toggleSetting('autoStartFocus', 'autoStartFocus'));
  $('soundToggle').addEventListener('click', toggleSound);
  $('soundSetting').addEventListener('click', toggleSound);
  $('soundSelectButton').addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = $('soundSelectMenu').hidden;
    closeActionMenu();
    $('soundSelectMenu').hidden = !willOpen;
    $('soundSelectButton').setAttribute('aria-expanded', String(willOpen));
  });
  $('soundSelectButton').addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    $('soundSelectMenu').hidden = false;
    $('soundSelectButton').setAttribute('aria-expanded', 'true');
    const options = [...$('soundSelectMenu').querySelectorAll('button[data-value]')];
    (options.find((option) => option.getAttribute('aria-selected') === 'true') || options[0])?.focus();
  });
  $('soundSelectMenu').addEventListener('click', (event) => {
    const option = event.target.closest('button[data-value]');
    selectSoundOption(option);
  });
  $('soundSelectMenu').addEventListener('keydown', (event) => {
    const options = [...$('soundSelectMenu').querySelectorAll('button[data-value]')];
    const current = options.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (Math.max(0, current) + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[index]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectSoundOption(document.activeElement.closest('button[data-value]'));
      $('soundSelectButton').focus();
    }
  });
  $('volume').addEventListener('input', (event) => {
    state.settings.volume = clampNumber(event.target.value, 70, 0, 100);
    $('volumeValue').textContent = `${state.settings.volume}%`;
    ringtone.volume = state.settings.volume / 100;
    saveNow();
  });
  $('themeToggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    render();
    saveNow(true);
  });
  $('moreMenuBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = $('actionMenu').hidden;
    closeSoundSelect();
    $('actionMenu').hidden = !willOpen;
    $('moreMenuBtn').setAttribute('aria-expanded', String(willOpen));
  });
  $('pinMenuBtn').addEventListener('click', async () => { await togglePin(); closeActionMenu(); });
  $('pinSetting').addEventListener('click', togglePin);
  $('compactMenuBtn').addEventListener('click', toggleCompactMode);
  $('compactSetting').addEventListener('click', toggleCompactMode);
  $('windowModeMenuBtn').addEventListener('click', toggleWindowedMode);
  $('windowModeSetting').addEventListener('click', toggleWindowedMode);
  $('trayMenuBtn').addEventListener('click', () => { closeActionMenu(); backend.hideToTray(); });
  $('traySettingBtn').addEventListener('click', () => backend.hideToTray());
  $('minimiseWindowBtn').addEventListener('click', () => backend.minimise());
  $('toggleWindowBtn').addEventListener('click', toggleWindowedMode);
  $('closeWindowBtn').addEventListener('click', () => backend.closeWindow());
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.menu-wrap')) closeActionMenu();
    if (!event.target.closest('.custom-select')) closeSoundSelect();
  });
  $('sessionTitle').addEventListener('input', (event) => {
    state.title = event.target.value.slice(0, 70);
    $('currentTaskLabel').textContent = state.title.trim() || (state.mode === 'stopwatch' ? 'Untitled task' : 'Untitled focus session');
    saveNow();
  });
  $('chartRange').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-days]');
    if (!button) return;
    chartDays = Number(button.dataset.days);
    document.querySelectorAll('#chartRange button').forEach((item) => item.classList.toggle('active', item === button));
    renderPeriodChart();
  });
  $('historyFilter').addEventListener('input', (event) => {
    historyFilter = event.target.value;
    historyPage = 0;
    renderHistory();
  });
  $('historyPrev').addEventListener('click', () => {
    historyPage = Math.max(0, historyPage - 1);
    renderHistory();
  });
  $('historyNext').addEventListener('click', () => {
    historyPage += 1;
    renderHistory();
  });
  $('clearHistoryBtn').addEventListener('click', () => $('confirmDialog').showModal());
  $('confirmDialog').addEventListener('close', () => {
    if ($('confirmDialog').returnValue !== 'confirm') return;
    state.history = [];
    historyPage = 0;
    render();
    saveNow(true);
    showToast('History cleared.');
  });
  $('importDialog').addEventListener('close', () => {
    if ($('importDialog').returnValue === 'confirm') applyPendingImport();
    else pendingImport = null;
  });
  $('resetStopwatchDialog').addEventListener('close', () => {
    if ($('resetStopwatchDialog').returnValue === 'confirm') performReset();
    else if (resetWasRunning && state.mode === 'stopwatch') {
      state.isRunning = true;
      state.stopwatchStartedAt = Date.now();
      ensureTicker();
      render();
      saveNow(true);
    }
    resetWasRunning = false;
  });
  $('history').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const item = state.history.find((entry) => entry.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action === 'delete') {
      state.history = state.history.filter((entry) => entry.id !== item.id);
      render();
      saveNow(true);
      return;
    }
    $('editSessionId').value = item.id;
    $('editTitle').value = item.title;
    const stopwatch = item.kind === 'stopwatch';
    $('editDurationLabel').textContent = stopwatch ? 'Seconds' : 'Minutes';
    $('editMinutes').max = stopwatch ? '31536000' : '1440';
    $('editMinutes').step = '1';
    $('editMinutes').value = stopwatch ? item.durationSeconds : item.minutes;
    $('editDialog').showModal();
  });
  $('editDialog').addEventListener('close', () => {
    if ($('editDialog').returnValue !== 'save') return;
    const item = state.history.find((entry) => entry.id === $('editSessionId').value);
    if (!item) return;
    item.title = $('editTitle').value.trim().slice(0, 70) || 'Focus session';
    if (item.kind === 'stopwatch') {
      item.durationSeconds = clampNumber($('editMinutes').value, item.durationSeconds, 0, 31_536_000);
      item.minutes = item.durationSeconds / 60;
    } else {
      item.minutes = clampNumber($('editMinutes').value, item.minutes, 0, 1440);
      item.durationSeconds = item.minutes * 60;
    }
    render();
    saveNow(true);
  });
  $('exportBtn').addEventListener('click', async () => {
    closeActionMenu();
    try {
      const path = await backend.export(snapshot());
      if (path) showToast(`Export saved: ${path}`);
    } catch (error) { showToast(`Export failed: ${error}`, true); }
  });
  $('importBtn').addEventListener('click', async () => {
    closeActionMenu();
    try {
      const raw = await backend.import();
      if (raw) requestImport(raw);
    } catch (error) { showToast(`Import failed: ${error}`, true); }
  });
  $('browserImport').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (file?.size > 5 * 1024 * 1024) showToast('Import file is larger than 5 MB.', true);
    else if (file) requestImport(await file.text());
    event.target.value = '';
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('actionMenu').hidden) {
      closeActionMenu();
      $('moreMenuBtn').focus();
      return;
    }
    if (event.key === 'Escape' && !$('soundSelectMenu').hidden) {
      closeSoundSelect();
      $('soundSelectButton').focus();
      return;
    }
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName) || document.querySelector('dialog[open]')) return;
    if (event.code === 'Space') { event.preventDefault(); toggleTimer(); }
    else if (event.key.toLowerCase() === 'r') { event.preventDefault(); resetTimer(); }
    else if (event.key.toLowerCase() === 's') { event.preventDefault(); skipCurrent(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.isRunning) {
      if (state.mode === 'stopwatch') {
        renderTimerOnly();
        return;
      }
      syncRemaining();
      if (state.remaining <= 0) completeCurrent('completed', new Date(state.endAt));
      else renderTimerOnly();
    }
  });
  window.addEventListener('beforeunload', () => {
    localStorage.setItem('apple-pomodoro-emergency-state', snapshot());
  });
}

(async function init() {
  try {
    state = sanitizeState(await backend.load());
  } catch (error) {
    console.error(error);
    const emergency = localStorage.getItem('apple-pomodoro-emergency-state');
    try { state = emergency ? sanitizeState(emergency) : cloneDefaultState(); }
    catch { state = cloneDefaultState(); }
    queueMicrotask(() => showToast('Saved data could not be loaded; the emergency copy was used.', true));
  }
  const completedWhileAway = restoreTimer();
  wireEvents();
  ensureTicker();
  try {
    await backend.setAlwaysOnTop(state.alwaysOnTop);
    await backend.setCompactMode(state.compactMode, state.windowedMode);
  } catch (error) {
    console.error(error);
    queueMicrotask(() => showToast(`Could not restore the saved window mode: ${error}`, true));
  }
  render();
  await backend.showWindow();
  saveNow(true);
  if (completedWhileAway) {
    const message = `${completedWhileAway} session(s) completed while the app was closed.`;
    showToast(message);
  }
})();
