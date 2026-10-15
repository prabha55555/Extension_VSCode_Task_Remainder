import { Stage } from './stage.js';
import { THEMES, themeFor } from './themes.js';

const vscode = acquireVsCodeApi();
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

let state = { userName: '', sound: true, muted: false, tasks: [], characters: [], defaultCharacter: 'bolt' };
let reminder = null;      // reminder currently on screen
let tab = 'tasks';
let stage = null;

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
};

const post = (type, extra = {}) => vscode.postMessage({ type, ...extra });
const charById = (id) => state.characters.find((c) => c.id === id);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ------------------------------------------------------------------ layout
const app = document.getElementById('app');
const stageBox = el('div', { class: 'stage' });
const bubbleText = el('div', { class: 'bubble-text' });
const yesBtn = el('button', { class: 'primary', onclick: () => answer('done') });
const SNOOZE_CHOICES = [5, 10, 15, 30, 60];
const laterBtn = el('button', { class: 'secondary', onclick: () => answer('snooze') });
const snoozeSel = el('select', { class: 'snooze-sel', 'aria-label': 'Snooze for' });
const actions = el('div', { class: 'actions' }, yesBtn, laterBtn, snoozeSel);
const bubble = el('div', { class: 'bubble hidden', role: 'alert' }, bubbleText, actions);
const charLabel = el('div', { class: 'char-label' });
const stageWrap = el('section', { class: 'stage-wrap' }, stageBox, bubble, charLabel);

const tabs = el('nav', { class: 'tabs' },
  ...[['tasks', 'Tasks'], ['chars', 'Characters']].map(([id, label]) =>
    el('button', { 'data-tab': id, onclick: () => { tab = id; renderTabs(); } }, label)));
const body = el('div', { class: 'body' });
const foot = el('footer', {},
  el('button', { class: 'link', onclick: () => post('test') }, 'Test reminder'),
  el('button', { class: 'link', onclick: () => post('toggleMute') }, ''),
  el('button', { class: 'link', onclick: () => post('openSettings') }, 'Settings'));
app.append(stageWrap, tabs, body, foot);

function answer(action) {
  if (!reminder) return;
  post('reminderAction', { id: reminder.id, action, minutes: Number(snoozeSel.value) });
  hideReminder();
}

// ------------------------------------------------------------------ stage / reminders
function descriptorFor(id) {
  const c = charById(id) || charById(state.defaultCharacter) || { id: 'bolt', kind: 'builtin', name: 'Bolt the Robot' };
  return c;
}

let shownCharId = null;
function showCharacter(id) {
  const c = descriptorFor(id);
  if (shownCharId === c.id + (c.uri || '')) return;
  shownCharId = c.id + (c.uri || '');
  charLabel.textContent = c.name || '';
  stage.setCharacter(c).catch((err) => post('loadError', { message: err.message }));
}

function chime() {
  if (!state.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [659.25, 880].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.12, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t0); o.stop(t0 + 0.55);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* audio may be blocked; the visual reminder still shows */ }
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let typer = null;

/** Types the message out once the character has landed; the buttons appear when it is done. */
function typeText(text) {
  clearInterval(typer);
  clearTimeout(typeText.failsafe);
  const chars = [...text];
  const finish = () => { clearInterval(typer); bubbleText.textContent = text; actions.classList.add('show'); };
  bubbleText.setAttribute('aria-label', text);
  actions.classList.remove('show');
  if (reduceMotion()) return finish();
  bubbleText.textContent = '';
  let i = 0;
  setTimeout(() => {
    if (!reminder) return;
    typer = setInterval(() => { bubbleText.textContent = chars.slice(0, ++i).join(''); if (i >= chars.length) finish(); }, 26);
  }, 650);
  typeText.failsafe = setTimeout(finish, 650 + chars.length * 26 + 1500);     // never leave the buttons hidden
}

function showReminder(r) {
  const fresh = !reminder || reminder.id !== r.id;
  reminder = r;
  const theme = themeFor(r);
  app.classList.toggle('focus', !!r.focus);          // reminder-only layout: character + message, no tabs
  stageWrap.dataset.theme = theme;
  stageWrap.style.setProperty('--accent', THEMES[theme].css);
  yesBtn.textContent = r.yes;
  laterBtn.textContent = r.kind === 'water' ? 'Remind me in' : 'Snooze';
  const wanted = r.snoozeMin || 10;
  const choices = SNOOZE_CHOICES.includes(wanted) ? SNOOZE_CHOICES : [...SNOOZE_CHOICES, wanted].sort((a, b) => a - b);
  snoozeSel.replaceChildren(...choices.map((n) => el('option', { value: n, selected: n === wanted }, n >= 60 ? `${n / 60} hr` : `${n} min`)));
  if (fresh) {
    bubble.classList.add('hidden');
    void bubble.offsetWidth;                         // restart the entrance animation
    bubble.classList.remove('hidden');
    stageWrap.classList.remove('alert');
    void stageWrap.offsetWidth;
    stageWrap.classList.add('alert');
    typeText(r.text);
    chime();
  }
  showCharacter(r.characterId || state.defaultCharacter);
  stage.setExcited(true, theme);
  post('shown', { id: r.id });
}

function hideReminder() {
  reminder = null;
  clearInterval(typer);
  clearTimeout(typeText.failsafe);
  bubble.classList.add('hidden');
  stageWrap.classList.remove('alert');
  stage.setExcited(false);                           // the character flies out to the left
  const focused = app.classList.contains('focus');
  setTimeout(() => {
    if (reminder) return;
    showCharacter(state.defaultCharacter);
    if (!focused) stage.comeBack();                  // the panel stays open, so the buddy returns
  }, 650);
  if (focused) setTimeout(() => {                    // the host closes the side bar; if it stays open, restore the normal view
    if (reminder) return;
    app.classList.remove('focus');
    stage.comeBack();
  }, 1800);
}

// ------------------------------------------------------------------ tasks tab
function repeatLabel(t) {
  if (t.date) return t.date === today() ? 'Today only' : t.date;
  if (!t.days) return 'Every day';
  return t.days.length === 5 && !t.days.includes('Sat') && !t.days.includes('Sun') ? 'Weekdays' : t.days.join(' ');
}

function taskForm() {
  const text = el('input', { type: 'text', placeholder: 'What should I remind you about?', maxlength: '200', 'aria-label': 'Task text' });
  const time = el('input', { type: 'time', value: '10:00', 'aria-label': 'Time' });
  const date = el('input', { type: 'date', value: today(), class: 'hidden', 'aria-label': 'Date' });
  const repeat = el('select', { 'aria-label': 'Repeat', onchange: () => date.classList.toggle('hidden', repeat.value !== 'once') },
    el('option', { value: 'daily' }, 'Every day'),
    el('option', { value: 'weekdays' }, 'Weekdays'),
    el('option', { value: 'weekends' }, 'Weekends'),
    el('option', { value: 'once' }, 'One time'));
  const snooze = el('select', { 'aria-label': 'Snooze length' },
    SNOOZE_CHOICES.map((n) => el('option', { value: n, selected: n === 10 }, `Snooze ${n >= 60 ? `${n / 60} hr` : `${n} min`}`)));
  const who = el('select', { 'aria-label': 'Character' },
    el('option', { value: '' }, 'Default character'),
    state.characters.map((c) => el('option', { value: c.id }, `${c.emoji || (c.kind === 'glb' ? '🧊' : '🖼️')} ${c.name}`)));

  const submit = () => {
    if (!text.value.trim() || !time.value) { text.focus(); return; }
    const task = { text: text.value, time: time.value, characterId: who.value, snoozeMinutes: Number(snooze.value) };
    if (repeat.value === 'weekdays') task.days = DAYS.slice(0, 5);
    if (repeat.value === 'weekends') task.days = ['Sat', 'Sun'];
    if (repeat.value === 'once') task.date = date.value || today();
    post('addTask', { task });
    text.value = '';
  };
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return el('div', { class: 'card form' }, text,
    el('div', { class: 'row' }, time, repeat, date),
    el('div', { class: 'row' }, who, snooze),
    el('button', { class: 'primary', onclick: submit }, 'Add task'));
}

function taskList() {
  if (!state.tasks.length) return el('p', { class: 'empty' }, 'No tasks yet. Add one above and your buddy will remind you at that time.');
  const sorted = [...state.tasks].sort((a, b) => a.time.localeCompare(b.time));
  return el('ul', { class: 'tasks' }, sorted.map((t) => {
    const c = t.characterId && charById(t.characterId);
    return el('li', { class: t.done ? 'done' : '' },
      el('input', { type: 'checkbox', checked: t.done, 'aria-label': `Mark "${t.text}" done`, onchange: () => post('toggleTask', { id: t.id }) }),
      el('span', { class: 'time' }, t.time),
      el('div', { class: 'what' }, el('div', { class: 'text' }, t.text),
        el('div', { class: 'meta' }, repeatLabel(t) + (c ? ` · ${c.emoji || (c.kind === 'glb' ? '🧊' : '🖼️')} ${c.name}` : ''))),
      el('button', { class: 'icon', title: 'Delete task', 'aria-label': `Delete "${t.text}"`, onclick: () => post('deleteTask', { id: t.id }) }, '✕'));
  }));
}

// ------------------------------------------------------------------ characters tab
function charGrid() {
  const cards = state.characters.map((c) => {
    const active = c.id === state.defaultCharacter;
    const thumb = c.kind === 'image'
      ? el('img', { src: c.uri, alt: '' })
      : el('span', { class: 'emoji' }, c.emoji || '🧊');
    return el('div', { class: 'char' + (active ? ' active' : '') },
      el('button', { class: 'char-main', title: active ? 'Default character' : 'Use as default', onclick: () => post('setDefault', { id: c.id }) },
        el('div', { class: 'thumb' }, thumb),
        el('div', { class: 'name' }, c.name),
        el('div', { class: 'badge' }, active ? 'Default' : c.kind === 'builtin' ? '3D' : c.kind === 'glb' ? '3D model' : 'Photo')),
      c.kind !== 'builtin' && el('button', { class: 'icon del', title: 'Remove', 'aria-label': `Remove ${c.name}`, onclick: () => post('deleteCharacter', { id: c.id }) }, '✕'));
  });
  cards.push(el('button', { class: 'char upload', onclick: () => post('uploadCharacter') },
    el('div', { class: 'thumb' }, el('span', { class: 'emoji' }, '＋')),
    el('div', { class: 'name' }, 'Upload'),
    el('div', { class: 'badge' }, '.glb or photo')));
  return el('div', { class: 'grid' }, cards);
}

// ------------------------------------------------------------------ render
function renderTabs() {
  tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  body.replaceChildren(...(tab === 'tasks'
    ? [taskForm(), taskList()]
    : [charGrid(), el('p', { class: 'hint' }, 'Tip: use a .glb for a full 3D model. A photo or PNG is turned into a puffy 3D figure (a plain background is removed automatically; busy backgrounds become a photo card). Pick a character per task when you add it.')]));
}

function render() {
  foot.children[1].textContent = state.muted ? 'Unmute' : 'Mute';
  stageWrap.classList.toggle('muted', state.muted);
  // keep what the user is typing: only rebuild the tasks form when it is not focused
  const typing = body.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName) && tab === 'tasks';
  if (!typing) renderTabs();
  else {
    const list = body.querySelector('ul, .empty');
    if (list) list.replaceWith(taskList());
  }
}

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'state') {
    state = m.state;
    render();
    if (!reminder) showCharacter(state.defaultCharacter);
  } else if (m.type === 'remind') {
    showReminder(m.reminder);
  } else if (m.type === 'dismiss') {
    if (reminder && reminder.id === m.id) hideReminder();
  } else if (m.type === 'image') {
    const p = pendingImages.get(m.reqId);
    pendingImages.delete(m.reqId);
    if (p) (m.data ? p.resolve(m.data) : p.reject(new Error(m.error || 'could not read the image')));
  }
});

const pendingImages = new Map();
stage = new Stage(stageBox);
stage.readImage = (id) => new Promise((resolve, reject) => {
  const reqId = Math.random().toString(36).slice(2);
  pendingImages.set(reqId, { resolve, reject });
  post('readImage', { id, reqId });
  setTimeout(() => { if (pendingImages.delete(reqId)) reject(new Error('timed out reading the image')); }, 15000);
});
renderTabs();
post('ready');
