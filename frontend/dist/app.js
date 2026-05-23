const $ = (id) => document.getElementById(id);
const DAY = 86400000;
const defaultState = {
  mode: 'focus',
  isRunning: false,
  remaining: 25 * 60,
  total: 25 * 60,
  round: 1,
  activeSection: 'settings',
  theme: 'light',
  settings: { focus: 25, short: 5, long: 15, rounds: 4, autoStart: false, sound: true },
  title: '',
  history: []
};

let state = structuredClone(defaultState);
let tick = null;
let lastSaved = 0;
let endAt = null;

const modeNames = { focus: 'Focus', short: 'Short Break', long: 'Long Break' };
const modeColors = { focus: '#007aff', short: '#34c759', long: '#af52de' };
const ringRadius = 122;
const ringLength = 2 * Math.PI * ringRadius;

const backend = {
  async load() {
    try {
      if (window.go?.main?.App?.LoadState) return await window.go.main.App.LoadState();
    } catch (e) { console.warn(e); }
    return localStorage.getItem('apple-pomodoro-state') || '';
  },
  async save(data) {
    try {
      if (window.go?.main?.App?.SaveState) return await window.go.main.App.SaveState(data);
    } catch (e) { console.warn(e); }
    localStorage.setItem('apple-pomodoro-state', data);
  },
  async export(data) {
    try {
      if (window.go?.main?.App?.ExportState) return await window.go.main.App.ExportState(data);
    } catch (e) { console.warn(e); }
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pomodoro-export-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return 'Downloaded by browser';
  }
};

function secondsFor(mode) {
  const s = state.settings;
  return (mode === 'focus' ? s.focus : mode === 'short' ? s.short : s.long) * 60;
}
function pad(n) { return String(n).padStart(2, '0'); }
function todayKey(d = new Date()) { return d.toISOString().slice(0, 10); }
function formatTime(sec) { return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`; }
function safeNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function sanitizeLoaded(raw) {
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state = { ...structuredClone(defaultState), ...parsed };
    state.settings = { ...defaultState.settings, ...(parsed.settings || {}) };
    state.history = Array.isArray(parsed.history) ? parsed.history.slice(0, 250) : [];
    state.activeSection = parsed.activeSection || 'settings';
    state.theme = parsed.theme === 'dark' ? 'dark' : 'light';
    state.isRunning = false;
    state.total = secondsFor(state.mode);
    state.remaining = Math.min(Math.max(1, Number(state.remaining || state.total)), state.total);
  } catch (e) {
    console.warn('Bad saved state', e);
  }
}

function snapshot() {
  return JSON.stringify({ ...state, isRunning: false }, null, 2);
}
async function saveNow(force = false) {
  const now = Date.now();
  if (!force && now - lastSaved < 800) return;
  lastSaved = now;
  await backend.save(snapshot());
}
function showToast(text) {
  const toast = $('toast');
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}
function beep() {
  if (!state.settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    master.connect(compressor).connect(ctx.destination);

    // Loud 4-second bell made with Web Audio: no external audio file needed.
    const duration = 4.0;
    const start = ctx.currentTime;
    const bellHits = [0, 0.85, 1.7, 2.55, 3.25];

    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(0.72, start + 0.04);
    master.gain.setValueAtTime(0.72, start + duration - 0.25);
    master.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    bellHits.forEach((offset, index) => {
      const t = start + offset;
      const hitGain = ctx.createGain();
      hitGain.connect(master);
      hitGain.gain.setValueAtTime(0.0001, t);
      hitGain.gain.exponentialRampToValueAtTime(index === 0 ? 0.9 : 0.72, t + 0.018);
      hitGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);

      [880, 1320, 1760].forEach((freq, partial) => {
        const osc = ctx.createOscillator();
        osc.type = partial === 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.985, t + 0.65);
        osc.connect(hitGain);
        osc.start(t);
        osc.stop(t + 0.75);
      });
    });

    if (navigator.vibrate) navigator.vibrate([250, 120, 250, 120, 350]);
    setTimeout(() => ctx.close?.(), Math.ceil((duration + 0.5) * 1000));
  } catch (error) {
    console.warn('Sound error', error);
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $('themeToggle').textContent = state.theme === 'dark' ? '☀️' : '🌙';
}

function setSection(section) {
  state.activeSection = section;
  document.querySelectorAll('#sectionTabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.section === section));
  document.querySelectorAll('.tab-section').forEach(el => el.classList.remove('active'));
  $(`${section}Section`).classList.add('active');
  renderStats();
  renderHistory();
  saveNow();
}

function setMode(mode, resetTime = true) {
  const changing = state.mode !== mode;
  state.mode = mode;
  const newTotal = secondsFor(mode);
  state.total = newTotal;
  if (resetTime) state.remaining = newTotal;
  else state.remaining = Math.min(state.remaining, newTotal);
  render();
  if (changing) saveNow(true);
}

function nextMode() {
  if (state.mode === 'focus') {
    const longBreak = state.round % state.settings.rounds === 0;
    return longBreak ? 'long' : 'short';
  }
  return 'focus';
}

function completeSession() {
  beep();
  const finishedMode = state.mode;
  if (finishedMode === 'focus') {
    state.history.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      title: state.title?.trim() || 'Focus session',
      minutes: state.settings.focus,
      finishedAt: new Date().toISOString()
    });
    state.history = state.history.slice(0, 250);
  }
  const target = nextMode();
  if (finishedMode !== 'focus') state.round = state.round >= state.settings.rounds ? 1 : state.round + 1;
  endAt = null;
  state.mode = target;
  state.total = secondsFor(target);
  state.remaining = state.total;
  state.isRunning = state.settings.autoStart;
  showToast(finishedMode === 'focus' ? 'Focus complete. Time to rest.' : 'Break complete. Time to focus.');
  ensureTicker();
  render();
  saveNow(true);
}

function ensureTicker() {
  if (tick) clearInterval(tick);
  tick = null;

  if (!state.isRunning) {
    endAt = null;
    return;
  }

  // Important: calculate from real clock time instead of doing remaining--.
  // This keeps the timer accurate even if the UI lags.
  endAt = Date.now() + Math.max(0, state.remaining) * 1000;

  tick = setInterval(() => {
    const msLeft = endAt - Date.now();
    state.remaining = Math.max(0, Math.ceil(msLeft / 1000));
    if (state.remaining <= 0) {
      clearInterval(tick);
      tick = null;
      endAt = null;
      completeSession();
    } else {
      renderTimerOnly();
    }
  }, 250);
}

function renderTimerOnly() {
  $('time').textContent = formatTime(Math.max(0, state.remaining));
  const progress = state.total > 0 ? state.remaining / state.total : 0;
  $('ring').style.strokeDashoffset = String(ringLength * (1 - progress));
}
function renderWeekChart() {
  const chart = $('weekChart');
  const now = new Date();
  const items = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY);
    const key = todayKey(d);
    const minutes = state.history.filter(s => todayKey(new Date(s.finishedAt)) === key).reduce((sum, s) => sum + Number(s.minutes || 0), 0);
    items.push({ label: d.toLocaleDateString('en-US', { weekday: 'short' }), minutes });
  }
  const max = Math.max(25, ...items.map(x => x.minutes));
  chart.innerHTML = items.map(x => `
    <div class="bar" title="${x.minutes} minutes">
      <div class="bar-fill" style="height:${Math.max(4, (x.minutes / max) * 88)}px"></div>
      <small>${x.label}</small>
    </div>`).join('');
}
function computeStreak() {
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const key = todayKey(new Date(Date.now() - i * DAY));
    const has = state.history.some(s => todayKey(new Date(s.finishedAt)) === key);
    if (!has) break;
    streak++;
  }
  return streak;
}
function renderStats() {
  const today = todayKey();
  const sessions = state.history.filter(s => todayKey(new Date(s.finishedAt)) === today);
  $('todayFocus').textContent = sessions.reduce((sum, s) => sum + Number(s.minutes || 0), 0);
  $('todaySessions').textContent = sessions.length;
  $('streak').textContent = computeStreak();
  renderWeekChart();
}
function renderHistory() {
  const el = $('history');
  if (state.history.length === 0) {
    el.innerHTML = '<div class="empty">No completed focus sessions yet.</div>';
    return;
  }
  el.innerHTML = state.history.slice(0, 30).map(item => {
    const date = new Date(item.finishedAt);
    return `<div class="history-item">
      <div>
        <div class="history-title">${escapeHTML(item.title || 'Focus session')}</div>
        <div class="history-meta">${date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</div>
      </div>
      <div class="history-duration">${Number(item.minutes || 0)} min</div>
    </div>`;
  }).join('');
}
function escapeHTML(s) {
  return String(s).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function render() {
  applyTheme();
  $('modeLabel').textContent = modeNames[state.mode];
  $('roundLabel').textContent = `Round ${state.round} of ${state.settings.rounds}`;
  $('startPauseBtn').textContent = state.isRunning ? 'Pause' : 'Start';
  $('ring').style.stroke = modeColors[state.mode];
  $('ring').style.strokeDasharray = String(ringLength);
  $('soundToggle').textContent = state.settings.sound ? '🔔' : '🔕';
  $('autoStart').classList.toggle('on', state.settings.autoStart);
  $('sessionTitle').value = state.title || '';
  $('focusMin').value = state.settings.focus;
  $('shortMin').value = state.settings.short;
  $('longMin').value = state.settings.long;
  $('rounds').value = state.settings.rounds;
  document.querySelectorAll('#modeTabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === state.mode));
  document.querySelectorAll('#sectionTabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.section === state.activeSection));
  document.querySelectorAll('.tab-section').forEach(el => el.classList.toggle('active', el.id === `${state.activeSection}Section`));
  renderTimerOnly();
  renderStats();
  renderHistory();
}

function applySettingsFromInputs() {
  const oldTotal = state.total;
  const oldRemaining = state.remaining;
  const oldModeTotal = secondsFor(state.mode);
  state.settings.focus = safeNumber($('focusMin').value, 25, 1, 180);
  state.settings.short = safeNumber($('shortMin').value, 5, 1, 60);
  state.settings.long = safeNumber($('longMin').value, 15, 1, 120);
  state.settings.rounds = safeNumber($('rounds').value, 4, 1, 12);
  state.total = secondsFor(state.mode);
  if (!state.isRunning && oldRemaining === oldTotal) state.remaining = state.total;
  else {
    const ratio = oldModeTotal > 0 ? oldRemaining / oldModeTotal : 1;
    state.remaining = Math.max(1, Math.min(state.total, Math.round(state.total * ratio)));
  }
  if (state.isRunning) ensureTicker();
  showToast('Settings saved');
  render();
  saveNow(true);
}

function wireEvents() {
  $('sectionTabs').addEventListener('click', e => {
    if (e.target.matches('button')) setSection(e.target.dataset.section);
  });
  $('modeTabs').addEventListener('click', e => {
    if (!e.target.matches('button')) return;
    const targetMode = e.target.dataset.mode;
    if (targetMode === state.mode) return;
    if (state.isRunning) {
      showToast('Timer is running. Pause it or skip the mode first.');
      return;
    }
    setMode(targetMode, true);
  });
  $('startPauseBtn').addEventListener('click', () => {
    state.isRunning = !state.isRunning;
    ensureTicker();
    render();
    saveNow(true);
  });
  $('resetBtn').addEventListener('click', () => {
    state.isRunning = false;
    state.remaining = secondsFor(state.mode);
    ensureTicker();
    render();
    saveNow(true);
  });
  $('skipBtn').addEventListener('click', completeSession);
  $('saveSettingsBtn').addEventListener('click', applySettingsFromInputs);
  $('autoStart').addEventListener('click', () => {
    state.settings.autoStart = !state.settings.autoStart;
    render();
    saveNow(true);
  });
  $('soundToggle').addEventListener('click', () => {
    state.settings.sound = !state.settings.sound;
    render();
    saveNow(true);
  });
  $('themeToggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    render();
    saveNow(true);
  });
  $('sessionTitle').addEventListener('input', e => {
    state.title = e.target.value;
    saveNow();
  });
  $('clearHistoryBtn').addEventListener('click', async () => {
    state.history = [];
    render();
    await saveNow(true);
    showToast('History cleared');
  });
  $('exportBtn').addEventListener('click', async () => {
    const path = await backend.export(snapshot());
    showToast(`Export ready: ${path}`);
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      $('startPauseBtn').click();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.isRunning) renderTimerOnly();
  });
}

(async function init() {
  sanitizeLoaded(await backend.load());
  state.total = secondsFor(state.mode);
  if (!state.remaining) state.remaining = state.total;
  wireEvents();
  render();
})();
