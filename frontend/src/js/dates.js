const pad = (value) => String(value).padStart(2, '0');

export function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addLocalDays(date, amount) {
  const result = new Date(date);
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() + amount);
  return result;
}

export function recentLocalDays(count, now = new Date()) {
  return Array.from({ length: count }, (_, index) => addLocalDays(now, index - count + 1));
}

export function completedMinutes(items) {
  return completedSeconds(items) / 60;
}

export function completedSeconds(items) {
  return items
    .filter((item) => item.status !== 'interrupted')
    .reduce((sum, item) => sum + (item.kind === 'stopwatch'
      ? Math.max(0, Number(item.durationSeconds || 0))
      : Math.max(0, Number(item.minutes || 0)) * 60), 0);
}

export function historyDayKey(item) {
  return /^\d{4}-\d{2}-\d{2}$/.test(item?.localDay || '')
    ? item.localDay
    : localDayKey(new Date(item.finishedAt));
}

export function statsForPeriod(history, start, end) {
  const startKey = localDayKey(start);
  const endKey = localDayKey(end);
  const items = history.filter((item) => {
    const day = historyDayKey(item);
    return day >= startKey && day < endKey;
  });
  return {
    seconds: completedSeconds(items),
    minutes: completedMinutes(items),
    completed: items.filter((item) => item.status !== 'interrupted').length,
    interrupted: items.filter((item) => item.status === 'interrupted').length
  };
}

export function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfLocalWeek(date = new Date()) {
  const start = startOfLocalDay(date);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

export function startOfLocalMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function nextLocalMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export function computeStreak(history, now = new Date()) {
  const activeDays = new Set(history.filter((item) => item.status !== 'interrupted').map(historyDayKey));
  let cursor = startOfLocalDay(now);
  if (!activeDays.has(localDayKey(cursor))) cursor = addLocalDays(cursor, -1);
  let streak = 0;
  while (streak < 3650 && activeDays.has(localDayKey(cursor))) {
    streak += 1;
    cursor = addLocalDays(cursor, -1);
  }
  return streak;
}
