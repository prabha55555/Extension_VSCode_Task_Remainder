const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// ---- Settings ----
const YOUR_NAME = '';           // optional: your name, used in the reminder text
const WATER_EVERY_MIN = 45;
const SNOOZE_MIN = 10;
const FIRST_WATER_SEC = 5;      // first water popup after launch (for testing)
const W = 340, H = 460;
const TASKS_FILE = path.join(__dirname, 'tasks.json');

const greet = () => (YOUR_NAME ? `${YOUR_NAME}, ` : '');

let win, waterTimer;
let tasks = [];
const queue = [];               // reminders waiting to be shown
let current = null;             // reminder on screen right now
const firedToday = new Set();   // "taskId|YYYY-MM-DD" so a task fires once a day

// ---------- Window ----------
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: W, height: H,
    x: workArea.x + workArea.width - W - 60,
    y: workArea.y + workArea.height - H + 30,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    skipTaskbar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile('index.html');
}

// ---------- Queue ----------
function enqueue(reminder) {
  queue.push(reminder);
  showNext();
}

function showNext() {
  if (current || queue.length === 0) return;
  current = queue.shift();
  win.showInactive();
  win.webContents.send('show', current);
}

function closeCurrent() {
  win.webContents.send('hide');
  current = null;
  setTimeout(() => {
    if (queue.length) showNext();
    else win.hide();
  }, 450);
}

// ---------- Water ----------
function scheduleWater(minutes) {
  clearTimeout(waterTimer);
  waterTimer = setTimeout(() => enqueue({
    type: 'water',
    text: YOUR_NAME ? `${greet()}time to drink some water! 💧` : `Time to drink some water! 💧`
  }), minutes * 60 * 1000);
}

// ---------- Tasks ----------
function loadTasks() {
  try {
    tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
    console.log(`Loaded ${tasks.length} task(s)`);
  } catch (e) {
    console.error('Could not read tasks.json:', e.message);
  }
}

const pad = (n) => String(n).padStart(2, '0');
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function checkTasks() {
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dayName = DAY_NAMES[now.getDay()];

  for (const t of tasks) {
    if (t.done) continue;
    if (t.date && t.date !== today) continue;              // one-off task on another day
    if (t.days && !t.days.includes(dayName)) continue;     // not scheduled today
    if (t.time !== hhmm) continue;
    const key = `${t.id}|${today}`;
    if (firedToday.has(key)) continue;
    firedToday.add(key);
    enqueue({ type: 'task', id: t.id, text: `${greet()}${t.text} 📝` });
  }
}

function markOneOffDone(id) {
  const t = tasks.find((x) => x.id === id);
  if (t && t.date) {                       // one-off tasks get marked done in the file
    t.done = true;
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
  }
}

// ---------- Button handlers ----------
ipcMain.on('done', () => {
  if (!current) return;
  if (current.type === 'water') scheduleWater(WATER_EVERY_MIN);
  else markOneOffDone(current.id);
  closeCurrent();
});

ipcMain.on('snooze', () => {
  if (!current) return;
  const r = current;
  if (r.type === 'water') scheduleWater(SNOOZE_MIN);
  else setTimeout(() => enqueue(r), SNOOZE_MIN * 60 * 1000);
  closeCurrent();
});

ipcMain.on('clickable', (_e, yes) => win.setIgnoreMouseEvents(!yes, { forward: true }));

// ---------- Start ----------
app.whenReady().then(() => {
  createWindow();
  // Only auto-start once packaged; in dev it would register bare electron.exe
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });

  loadTasks();
  fs.watchFile(TASKS_FILE, { interval: 2000 }, loadTasks); // edit tasks.json anytime, no restart
  setInterval(checkTasks, 20 * 1000);
  checkTasks();

  setTimeout(() => scheduleWater(0), FIRST_WATER_SEC * 1000);
});
