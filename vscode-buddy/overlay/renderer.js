import { Stage } from '../webview/stage.js';
import { THEMES, themeFor } from '../webview/themes.js';

const api = window.buddy;
const SNOOZE_CHOICES = [5, 10, 15, 30, 60];

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

const stageBox = el('div', { class: 'stage' });
const text = el('div', { class: 'text' });
const yesBtn = el('button', { class: 'primary', onclick: () => answer('done') });
const laterBtn = el('button', { class: 'secondary', onclick: () => answer('snooze') });
const snoozeSel = el('select', { 'aria-label': 'Snooze for' });
const actions = el('div', { class: 'actions' }, yesBtn, laterBtn, snoozeSel);
const bubble = el('div', { class: 'bubble hidden', role: 'alert' }, text, actions);
document.getElementById('app').append(stageBox, bubble);

const stage = new Stage(stageBox);
let current = null;                // reminder on screen
let typer = null, failsafe = null;

function typeText(message) {
  clearInterval(typer); clearTimeout(failsafe);
  const chars = [...message];
  const finish = () => { clearInterval(typer); text.textContent = message; actions.classList.add('show'); };
  actions.classList.remove('show');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
  text.textContent = '';
  let i = 0;
  setTimeout(() => {
    if (!current) return;
    typer = setInterval(() => { text.textContent = chars.slice(0, ++i).join(''); if (i >= chars.length) finish(); }, 26);
  }, 650);
  failsafe = setTimeout(finish, 650 + chars.length * 26 + 1500);        // never leave the buttons hidden
}

/** Fly out to the left, then tell the host to hide the window (unless another reminder arrived meanwhile). */
function leave() {
  current = null;
  clearInterval(typer); clearTimeout(failsafe);
  bubble.classList.add('hidden');
  stage.setExcited(false);
  setTimeout(() => { if (!current) api.hidden(); }, 1000);
}

function answer(action) {
  if (!current) return;
  api.answer({ id: current.id, action, minutes: Number(snoozeSel.value) });
  leave();
}

api.onRemind(async ({ reminder, character }) => {
  current = reminder;
  const theme = themeFor(reminder);
  document.documentElement.style.setProperty('--accent', THEMES[theme].css);
  yesBtn.textContent = reminder.yes;
  laterBtn.textContent = reminder.kind === 'water' ? 'Remind me in' : 'Snooze';
  const wanted = reminder.snoozeMin || 10;
  const choices = SNOOZE_CHOICES.includes(wanted) ? SNOOZE_CHOICES : [...SNOOZE_CHOICES, wanted].sort((a, b) => a - b);
  snoozeSel.replaceChildren(...choices.map((n) => el('option', { value: n, selected: n === wanted }, n >= 60 ? `${n / 60} hr` : `${n} min`)));

  bubble.classList.add('hidden');
  void bubble.offsetWidth;                                   // restart the bubble's entrance animation
  bubble.classList.remove('hidden');
  typeText(reminder.text);
  api.shown(reminder.id);

  stage.setExcited(false);
  stage.readImage = () => Promise.resolve(character.data);
  try { await stage.setCharacter(character); } catch (e) { api.error(`could not load "${character.name || character.id}": ${e.message}`); }
  if (current === reminder) stage.setExcited(true, theme);
});

api.onDismiss(({ id }) => { if (current && current.id === id) leave(); });

// The window ignores the mouse except over the speech bubble and the character, so it never blocks the editor beneath it.
let clickable = false;
window.addEventListener('mousemove', (e) => {
  const b = bubble.classList.contains('hidden') ? null : bubble.getBoundingClientRect();
  const overBubble = b && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
  const overChar = e.clientX > innerWidth * 0.25 && e.clientX < innerWidth * 0.75 && e.clientY > innerHeight * 0.3;
  const yes = Boolean(current) && Boolean(overBubble || overChar);
  if (yes !== clickable) { clickable = yes; api.clickable(yes); }
});
