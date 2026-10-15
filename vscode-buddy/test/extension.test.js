// Drives src/extension.js against a stubbed `vscode` module: tasks, reminder delivery, answering, upload cleanup.
const assert = require('assert');
const Module = require('module');
const os = require('os');
const fs = require('fs');
const path = require('path');

const store = {};
const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-'));
const toasts = [];
const commands = {};
let provider = null;

const uri = (p) => ({ fsPath: p, toString: () => 'vsc://' + p });
const vscode = {
  StatusBarAlignment: { Right: 2 },
  ViewColumn: { Beside: -2 },
  Uri: { file: uri, joinPath: (b, ...s) => uri(path.join(b.fsPath, ...s)) },
  window: {
    state: { focused: true },
    createStatusBarItem: () => ({ show() {}, dispose() {} }),
    registerWebviewViewProvider: (_id, p) => { provider = p; return { dispose() {} }; },
    showInformationMessage: (text, ...btns) => { toasts.push({ text, btns }); return new Promise(() => {}); },
    showWarningMessage: () => Promise.resolve(),
    onDidChangeWindowState: () => ({ dispose() {} })
  },
  commands: {
    registerCommand: (id, fn) => { commands[id] = fn; return { dispose() {} }; },
    executeCommand: () => Promise.resolve()
  },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => ({ userName: 'Sam', waterEveryMinutes: 45, snoozeMinutes: 10, autoReveal: true, sound: false, display: 'sidebar' }[k] ?? d) }),
    onDidChangeConfiguration: () => ({ dispose() {} })
  }
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : origLoad.call(this, req, ...rest); };

const ext = require('../src/extension.js');
const ctx = {
  subscriptions: [],
  extensionUri: uri(path.join(__dirname, '..')),
  globalStorageUri: uri(globalDir),
  globalState: { get: (k, d) => (k in store ? store[k] : d), update: (k, v) => { store[k] = v; return Promise.resolve(); } }
};

(async () => {
  ext.activate(ctx);
  assert.ok(provider, 'view provider registered');

  const posted = [];
  let handler;
  const view = {
    visible: true,
    webview: {
      options: {}, cspSource: 'csp', html: '',
      asWebviewUri: (u) => u,
      postMessage: (m) => { posted.push(m); return Promise.resolve(); },
      onDidReceiveMessage: (fn) => { handler = fn; }
    },
    onDidChangeVisibility() {}, onDidDispose() {}, show() {}
  };
  provider.resolveWebviewView(view);
  assert.ok(view.webview.html.includes('Content-Security-Policy') && view.webview.html.includes('webview.js'), 'html built');

  await handler({ type: 'ready' });
  const first = posted.find((m) => m.type === 'state');
  assert.strictEqual(first.state.characters.length, 5, '5 built-in characters');

  await handler({ type: 'addTask', task: { text: 'Standup', time: '10:00', characterId: 'astro' } });
  await handler({ type: 'addTask', task: { text: 'bad', time: 'nope' } });
  assert.strictEqual(store.tasks.length, 1, 'only valid task saved');
  assert.strictEqual(store.tasks[0].characterId, 'astro');

  // water reminder -> shown in the visible view, answering clears it and restarts the timer
  await handler({ type: 'test' });
  const remind = posted.find((m) => m.type === 'remind');
  assert.ok(remind && /Sam, time to drink some water/.test(remind.reminder.text), 'reminder delivered to view');
  await handler({ type: 'reminderAction', id: remind.reminder.id, action: 'done' });
  assert.ok(posted.some((m) => m.type === 'dismiss' && m.id === remind.reminder.id), 'dismiss sent');
  assert.ok(Date.now() - store.lastWaterAt < 2000, 'water timer restarted on Yes');

  // hidden view + autoReveal off path: falls back to a native notification
  view.visible = false;
  await handler({ type: 'toggleTask', id: store.tasks[0].id });
  assert.strictEqual(store.tasks[0].done, true, 'toggle works');
  await handler({ type: 'deleteTask', id: store.tasks[0].id });
  assert.strictEqual(store.tasks.length, 0, 'delete works');

  // uploaded character + deleting it resets tasks/default
  const file = path.join(globalDir, 'characters', 'u-x.png');
  fs.writeFileSync(file, 'x');
  store.characters = [{ id: 'u-x', name: 'Me', kind: 'image', file: 'u-x.png' }];
  store.defaultCharacter = 'u-x';
  store.tasks = [{ id: 't', text: 'a', time: '10:00', characterId: 'u-x' }];
  await handler({ type: 'deleteCharacter', id: 'u-x' });
  assert.ok(!fs.existsSync(file), 'file removed');
  assert.strictEqual(store.defaultCharacter, 'bolt', 'default reset');
  assert.strictEqual(store.tasks[0].characterId, undefined, 'task falls back to default character');

  // foreign messages are ignored
  await handler({ type: 'nonsense' });
  await handler(null);

  ctx.subscriptions.forEach((s) => s.dispose && s.dispose());
  console.log('extension host tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
