// Pure scheduling helpers (no vscode import) so they can be unit-tested with plain node.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CATCHUP_MS = 10 * 60 * 1000; // still fire a task up to 10 min late (VS Code opened late, laptop woke up)

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Is `task` due to fire at `now`?
 * `fired` is a map of "taskId|YYYY-MM-DD" -> true for reminders already shown.
 * A task with neither `date` nor `days` repeats every day.
 */
function isDue(task, now, fired) {
  if (task.done) return false;
  const today = dateStr(now);
  if (task.date && task.date !== today) return false;
  if (task.days && task.days.length && !task.days.includes(DAY_NAMES[now.getDay()])) return false;
  const m = /^(\d{2}):(\d{2})$/.exec(task.time || '');
  if (!m) return false;
  const due = new Date(now);
  due.setHours(Number(m[1]), Number(m[2]), 0, 0);
  const late = now.getTime() - due.getTime();
  if (late < 0 || late > CATCHUP_MS) return false;
  return !fired[`${task.id}|${today}`];
}

/** Clean up a task coming from the webview. Returns null if unusable. */
function normalizeTask(raw, newId) {
  if (!raw || typeof raw !== 'object') return null;
  const text = String(raw.text || '').trim().slice(0, 200);
  if (!text) return null;
  if (!/^\d{2}:\d{2}$/.test(raw.time || '')) return null;
  const task = { id: newId, text, time: raw.time, done: false };
  if (Array.isArray(raw.days)) {
    const days = raw.days.filter((d) => DAY_NAMES.includes(d));
    if (days.length && days.length < 7) task.days = days;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '')) task.date = raw.date;
  const snooze = Math.round(Number(raw.snoozeMinutes));
  if (snooze >= 1 && snooze <= 240) task.snoozeMinutes = snooze;
  if (typeof raw.characterId === 'string' && raw.characterId) task.characterId = raw.characterId.slice(0, 64);
  return task;
}

/** Minutes until the next water reminder, or null when disabled. */
function waterMinutesLeft(lastWaterAt, intervalMin, nowMs) {
  if (!intervalMin || intervalMin <= 0) return null;
  return Math.max(0, Math.ceil((lastWaterAt + intervalMin * 60000 - nowMs) / 60000));
}

module.exports = { DAY_NAMES, CATCHUP_MS, dateStr, isDue, normalizeTask, waterMinutesLeft };
