// Transparent, always-on-top window that shows the buddy at the left edge of the screen.
// The VS Code extension starts this with Electron and talks to it over a local socket (one JSON object per line):
//   extension -> here: { type: 'remind', reminder, character } | { type: 'dismiss', id } | { type: 'quit' }
//   here -> extension: { type: 'hello', token } | { type: 'shown', id } | { type: 'answer', id, action, minutes } | { type: 'error', message }
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const net = require('net');
const readline = require('readline');

const W = 460, H = 480;
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
let win = null;
let loaded = false;
const waiting = [];                    // messages that arrived before the page finished loading
let sock = null;

const out = (m) => { if (sock && sock.writable) sock.write(JSON.stringify(m) + '\n'); };

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: W, height: H,
    x: workArea.x, y: workArea.y + workArea.height - H,
    transparent: true, frame: false, resizable: false, hasShadow: false,
    skipTaskbar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('did-finish-load', () => { loaded = true; waiting.splice(0).forEach(handle); });
}

function handle(m) {
  if (!win) return;
  if (!loaded) { waiting.push(m); return; }
  if (m.type === 'remind') {
    const { workArea } = screen.getPrimaryDisplay();
    win.setPosition(workArea.x, workArea.y + workArea.height - H);
    win.showInactive();
    win.webContents.send('remind', m);
  } else if (m.type === 'dismiss') {
    win.webContents.send('dismiss', m);
  }
}

app.whenReady().then(() => {
  createWindow();
  const port = Number(arg('port'));
  if (!port) return;
  sock = net.connect(port, '127.0.0.1', () => out({ type: 'hello', token: arg('token') }));
  readline.createInterface({ input: sock }).on('line', (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'quit') app.quit();
    else handle(m);
  });
  sock.on('close', () => app.quit());               // the extension went away
  sock.on('error', () => app.quit());
});

ipcMain.on('shown', (_e, id) => out({ type: 'shown', id }));
ipcMain.on('answer', (_e, a) => out({ type: 'answer', ...a }));
ipcMain.on('error', (_e, message) => out({ type: 'error', message }));
ipcMain.on('hidden', () => { if (win) win.hide(); });
ipcMain.on('clickable', (_e, yes) => { if (win) win.setIgnoreMouseEvents(!yes, { forward: true }); });
app.on('window-all-closed', () => app.quit());
