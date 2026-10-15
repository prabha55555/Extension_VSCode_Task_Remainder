const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDue, normalizeTask, waterMinutesLeft, dateStr } = require('./scheduler');
const BUILTINS = require('../shared/builtins.json');
const { Overlay, findElectron } = require('./overlay');

const TICK_MS = 10 * 1000;
const ACK_WAIT_MS = 2500;               // how long to wait for the view to confirm it is showing a reminder
const GIVE_UP_MS = 5 * 60 * 1000;       // unanswered reminder is auto-snoozed after this
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const OVERLAY_ACK_MS = 12000;           // the overlay window needs a moment to start the first time

const uid = () => crypto.randomBytes(6).toString('hex');
const cfg = () => vscode.workspace.getConfiguration('deskBuddy');

class Buddy {
  constructor(ctx) {
    this.ctx = ctx;
    this.hosts = new Set();     // every open webview (sidebar view + editor panels)
    this.view = null;           // the sidebar WebviewView, once resolved
    this.queue = [];
    this.current = null;
    this.muted = false;
    this.ackTimer = null;
    this.giveUpTimer = null;
    this.overlay = new Overlay(path.join(ctx.extensionUri.fsPath, 'overlay'), {
      answer: (id, action, minutes) => this.resolve(id, action === 'done' ? 'done' : 'snooze', minutes),
      shown: (id) => { if (this.current && this.current.id === id) clearTimeout(this.ackTimer); },
      error: (message) => vscode.window.showWarningMessage(`Desk Buddy: ${message}. Showing the default character instead.`),
      exited: () => { if (this.current && this.current.onOverlay) { this.current.onOverlay = false; this.toast(this.current); } }
    });
    ctx.subscriptions.push({ dispose: () => this.overlay.dispose() });
    this.charDir = path.join(ctx.globalStorageUri.fsPath, 'characters');
    fs.mkdirSync(this.charDir, { recursive: true });

    if (typeof ctx.globalState.get('lastWaterAt') !== 'number') {
      ctx.globalState.update('lastWaterAt', Date.now());
    }

    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.status.command = 'deskBuddy.view.focus';
    this.status.show();
    ctx.subscriptions.push(this.status);
  }

  // ---------- persisted state ----------
  get tasks() { return this.ctx.globalState.get('tasks', []); }
  get uploaded() { return this.ctx.globalState.get('characters', []); }
  get defaultCharacter() { return this.ctx.globalState.get('defaultCharacter', 'bolt'); }
  get lastWaterAt() { return this.ctx.globalState.get('lastWaterAt', Date.now()); }
  get fired() { return this.ctx.globalState.get('fired', {}); }
  saveTasks(t) { return this.ctx.globalState.update('tasks', t); }
  saveUploaded(c) { return this.ctx.globalState.update('characters', c); }

  characterExists(id) {
    return BUILTINS.some((b) => b.id === id) || this.uploaded.some((c) => c.id === id);
  }

  // ---------- webviews ----------
  attach(webview, isVisible) {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'media'), this.ctx.globalStorageUri]
    };
    webview.html = this.html(webview);
    const host = { webview, isVisible, ready: false };
    this.hosts.add(host);
    webview.onDidReceiveMessage((m) => this.onMessage(host, m));
    return host;
  }

  detach(host) {
    this.hosts.delete(host);
    if (this.current && ![...this.hosts].some((h) => h.ready && h.isVisible())) {
      // the view the reminder was in just closed; fall back to a notification
      this.clearTimers();
      this.toast(this.current);
    }
  }

  html(webview) {
    const media = (f) => webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', f));
    const nonce = uid() + uid();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data: blob:`,
      `media-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `connect-src ${webview.cspSource} blob: data:`,
      `worker-src blob:`
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('webview.css')}">
<title>Desk Buddy</title></head>
<body><div id="app"></div>
<script nonce="${nonce}" src="${media('webview.js')}"></script>
</body></html>`;
  }

  stateFor(host) {
    const asUri = (file) => host.webview.asWebviewUri(vscode.Uri.file(path.join(this.charDir, file))).toString();
    const characters = [
      ...BUILTINS.map((b) => ({ id: b.id, name: b.name, emoji: b.emoji, kind: 'builtin' })),
      ...this.uploaded.map((c) => ({ id: c.id, name: c.name, kind: c.kind, uri: asUri(c.file) }))
    ];
    return {
      userName: cfg().get('userName', ''),
      sound: cfg().get('sound', true),
      muted: this.muted,
      tasks: this.tasks,
      characters,
      defaultCharacter: this.characterExists(this.defaultCharacter) ? this.defaultCharacter : 'bolt'
    };
  }

  post(host, msg) { if (host.ready) host.webview.postMessage(msg); }
  broadcast(msg) { this.hosts.forEach((h) => this.post(h, msg)); }
  pushState() { this.hosts.forEach((h) => this.post(h, { type: 'state', state: this.stateFor(h) })); this.updateStatus(); }

  async onMessage(host, m) {
    switch (m && m.type) {
      case 'ready':
        host.ready = true;
        this.post(host, { type: 'state', state: this.stateFor(host) });
        if (this.current) this.post(host, { type: 'remind', reminder: this.current });
        break;
      case 'shown':
        if (this.current && this.current.id === m.id) clearTimeout(this.ackTimer);
        break;
      case 'addTask': {
        const task = normalizeTask(m.task, uid());
        if (task && task.characterId && !this.characterExists(task.characterId)) delete task.characterId;
        if (task) { await this.saveTasks([...this.tasks, task]); this.pushState(); }
        break;
      }
      case 'toggleTask':
        await this.saveTasks(this.tasks.map((t) => (t.id === m.id ? { ...t, done: !t.done } : t)));
        this.pushState();
        break;
      case 'deleteTask':
        await this.saveTasks(this.tasks.filter((t) => t.id !== m.id));
        this.pushState();
        break;
      case 'readImage': this.sendImage(host, m); break;
      case 'uploadCharacter': await this.uploadCharacters(); break;
      case 'deleteCharacter': await this.deleteCharacter(m.id); break;
      case 'setDefault':
        if (this.characterExists(m.id)) { await this.ctx.globalState.update('defaultCharacter', m.id); this.pushState(); }
        break;
      case 'reminderAction': this.resolve(m.id, m.action === 'done' ? 'done' : 'snooze', m.minutes); break;
      case 'test': this.testReminder(); break;
      case 'toggleMute': this.toggleMute(); break;
      case 'openSettings': vscode.commands.executeCommand('deskBuddy.openSettings'); break;
      case 'loadError': vscode.window.showWarningMessage(`Desk Buddy: could not load that character (${m.message || 'unknown error'}). Using the default instead.`); break;
    }
  }

  // ---------- characters ----------
  async uploadCharacters() {
    const picks = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Add character',
      filters: { '3D model (.glb) or image': ['glb', ...IMAGE_EXT.map((e) => e.slice(1))] }
    });
    if (!picks) return;
    const list = [...this.uploaded];
    for (const uri of picks) {
      const ext = path.extname(uri.fsPath).toLowerCase();
      const isGlb = ext === '.glb';
      if (!isGlb && !IMAGE_EXT.includes(ext)) {
        vscode.window.showWarningMessage(`Desk Buddy: ${path.basename(uri.fsPath)} is not a .glb model or an image. (For .gltf, export as .glb.)`);
        continue;
      }
      if (fs.statSync(uri.fsPath).size > MAX_UPLOAD_BYTES) {
        vscode.window.showWarningMessage(`Desk Buddy: ${path.basename(uri.fsPath)} is larger than 40 MB.`);
        continue;
      }
      const name = await vscode.window.showInputBox({
        prompt: 'Name for this character',
        value: path.basename(uri.fsPath, ext)
      });
      if (name === undefined) continue;
      const id = 'u-' + uid();
      const file = id + ext;
      fs.copyFileSync(uri.fsPath, path.join(this.charDir, file));
      list.push({ id, name: name.trim().slice(0, 40) || id, kind: isGlb ? 'glb' : 'image', file });
    }
    await this.saveUploaded(list);
    this.pushState();
  }

  /** Webviews can't read their own uploaded images (cross-origin), so the host sends them as a data: URI. */
  sendImage(host, m) {
    const c = this.uploaded.find((x) => x.id === m.id && x.kind === 'image');
    try {
      if (!c) throw new Error('image not found');
      const data = fs.readFileSync(path.join(this.charDir, c.file)).toString('base64');
      const type = MIME[path.extname(c.file)] || 'image/png';
      this.post(host, { type: 'image', reqId: m.reqId, data: `data:${type};base64,${data}` });
    } catch (err) {
      this.post(host, { type: 'image', reqId: m.reqId, error: err.message });
    }
  }

  async deleteCharacter(id) {
    const c = this.uploaded.find((x) => x.id === id);
    if (!c) return;
    try { fs.unlinkSync(path.join(this.charDir, c.file)); } catch { /* already gone */ }
    await this.saveUploaded(this.uploaded.filter((x) => x.id !== id));
    await this.saveTasks(this.tasks.map((t) => (t.characterId === id ? { ...t, characterId: undefined } : t)));
    if (this.defaultCharacter === id) await this.ctx.globalState.update('defaultCharacter', 'bolt');
    this.pushState();
  }

  // ---------- reminders ----------
  makeReminder(kind, task) {
    const name = cfg().get('userName', '').trim();
    const hello = name ? `${name}, ` : '';
    const snooze = (task && task.snoozeMinutes) || cfg().get('snoozeMinutes', 10);
    if (kind === 'water') {
      return { id: uid(), kind, snoozeMin: snooze, text: name ? `${hello}time to drink some water! 💧` : `Time to drink some water! 💧`, yes: 'Yes', later: 'Remind me later', characterId: '' };
    }
    return {
      id: uid(), kind, taskId: task.id, text: `${hello}${task.text} 📝`,
      yes: 'Done', later: `Snooze ${snooze} min`, snoozeMin: snooze, characterId: task.characterId || ''
    };
  }

  enqueue(reminder) {
    this.queue.push(reminder);
    this.pump();
  }

  /** Reminders are only delivered while VS Code is the focused app. */
  pump() {
    if (this.current || !this.queue.length || this.muted || !vscode.window.state.focused) return;
    this.current = this.queue.shift();
    this.deliver(this.current);
  }

  /** The buddy as its own small window on the desktop, so nothing opens in VS Code. Returns false if it can't be used. */
  deliverOverlay(r) {
    if (cfg().get('display', 'overlay') !== 'overlay') return false;
    const electron = findElectron({
      configured: cfg().get('overlayElectronPath', ''),
      saved: this.ctx.globalState.get('electronPath', ''),
      folders: (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath)
    });
    if (!electron) { this.askForElectron(); return false; }
    if (!this.overlay.start(electron)) return false;
    r.onOverlay = true;
    this.overlay.send({ type: 'remind', reminder: r, character: this.characterPayload(r.characterId || this.defaultCharacter) });
    this.ackTimer = setTimeout(() => this.current && this.current.id === r.id && this.toast(r), OVERLAY_ACK_MS);
    this.armGiveUp();
    return true;
  }

  askForElectron() {
    if (this.askedElectron) return;
    this.askedElectron = true;
    vscode.window.showInformationMessage(
      'Desk Buddy can show the character on your desktop instead of opening a side bar. It needs an Electron runtime (electron.exe).',
      'Choose electron.exe', 'Use the side bar'
    ).then(async (pick) => {
      if (pick === 'Use the side bar') return cfg().update('display', 'sidebar', vscode.ConfigurationTarget.Global);
      if (pick !== 'Choose electron.exe') return;
      const [file] = (await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Use this Electron' })) || [];
      if (file) { await this.ctx.globalState.update('electronPath', file.fsPath); this.askedElectron = false; }
    });
  }

  /** What the overlay needs to draw a character: built-ins by id, uploads as data: URIs. */
  characterPayload(id) {
    const u = this.uploaded.find((c) => c.id === id);
    if (!u) {
      const b = BUILTINS.find((x) => x.id === id) || BUILTINS[0];
      return { kind: 'builtin', id: b.id, name: b.name };
    }
    try {
      const data = fs.readFileSync(path.join(this.charDir, u.file)).toString('base64');
      if (u.kind === 'glb') return { kind: 'glb', id: u.id, name: u.name, uri: `data:model/gltf-binary;base64,${data}` };
      return { kind: 'image', id: u.id, name: u.name, data: `data:${MIME[path.extname(u.file)] || 'image/png'};base64,${data}` };
    } catch {
      return { kind: 'builtin', id: BUILTINS[0].id, name: BUILTINS[0].name };
    }
  }

  deliver(r) {
    if (this.deliverOverlay(r)) return;
    clearTimeout(this.closeTimer);
    if ([...this.hosts].some((h) => h.ready && h.isVisible())) {
      r.focus = this.autoRevealed;            // we opened it for a reminder: show just the character
      this.broadcast({ type: 'remind', reminder: r });
      this.armGiveUp();
      return;
    }
    if (cfg().get('autoReveal', true)) {
      this.autoRevealed = true;
      r.focus = true;                         // only the character and its message, no task list
      this.reveal();
      // when the view loads it sends 'ready' and gets the reminder; if that never happens use a notification
      this.ackTimer = setTimeout(() => this.current && this.current.id === r.id && this.toast(r), ACK_WAIT_MS);
      this.armGiveUp();
    } else {
      this.toast(r);
    }
  }

  reveal() {
    if (this.view) {
      this.view.show(true);                         // preserveFocus: don't steal the editor cursor
    } else {
      vscode.commands.executeCommand('deskBuddy.view.focus').then(() =>
        vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'));
    }
  }

  toast(r) {
    this.armGiveUp();
    vscode.window.showInformationMessage(r.text, r.yes, r.later).then((choice) => {
      if (!this.current || this.current.id !== r.id) return;   // already answered elsewhere
      if (choice === r.yes) this.resolve(r.id, 'done');
      else if (choice === r.later) this.resolve(r.id, 'snooze');
    });
  }

  armGiveUp() {
    clearTimeout(this.giveUpTimer);
    const id = this.current && this.current.id;
    this.giveUpTimer = setTimeout(() => id && this.resolve(id, 'snooze'), GIVE_UP_MS);
  }

  clearTimers() { clearTimeout(this.ackTimer); clearTimeout(this.giveUpTimer); }

  resolve(id, action, minutes) {
    const r = this.current;
    if (!r || r.id !== id) return;
    this.clearTimers();
    this.current = null;
    this.broadcast({ type: 'dismiss', id });
    if (r.onOverlay) this.overlay.send({ type: 'dismiss', id });
    if (this.autoRevealed && !this.queue.length && cfg().get('closeAfterAnswer', true)) {
      // the character flies out, then the side bar we opened for the reminder closes again
      this.closeTimer = setTimeout(() => {
        this.autoRevealed = false;
        if (this.view && this.view.visible) vscode.commands.executeCommand('workbench.action.closeSidebar');
      }, 1100);
    }
    const picked = Math.round(Number(minutes));
    const snoozeMin = picked >= 1 && picked <= 240 ? picked : r.snoozeMin || cfg().get('snoozeMinutes', 10);

    if (r.kind === 'water') {
      const interval = cfg().get('waterEveryMinutes', 0);
      const last = action === 'done' ? Date.now() : Date.now() - Math.max(0, interval - snoozeMin) * 60000;
      this.ctx.globalState.update('lastWaterAt', last);
    } else if (action === 'done') {
      const task = this.tasks.find((t) => t.id === r.taskId);
      if (task && task.date) {                       // one-off tasks finish for good
        this.saveTasks(this.tasks.map((t) => (t.id === task.id ? { ...t, done: true } : t))).then(() => this.pushState());
      }
    } else {
      setTimeout(() => this.enqueue({ ...r, id: uid() }), snoozeMin * 60000);
    }
    setTimeout(() => this.pump(), 700);
    this.updateStatus();
  }

  testReminder() {
    this.enqueue(this.makeReminder('water'));
  }

  toggleMute() {
    this.muted = !this.muted;
    vscode.window.showInformationMessage(this.muted ? 'Desk Buddy muted.' : 'Desk Buddy reminders are on.');
    this.pushState();
    if (!this.muted) this.pump();
  }

  // ---------- timer ----------
  tick() {
    if (!this.muted && vscode.window.state.focused) {
      const now = new Date();
      const interval = cfg().get('waterEveryMinutes', 0);
      const waterQueued = (this.current && this.current.kind === 'water') || this.queue.some((q) => q.kind === 'water');
      if (interval > 0 && !waterQueued && now.getTime() - this.lastWaterAt >= interval * 60000) {
        this.enqueue(this.makeReminder('water'));
      }

      // `fired` lives in globalState so several VS Code windows don't all pop the same task
      const today = dateStr(now);
      let fired = Object.fromEntries(Object.entries(this.fired).filter(([k]) => k.endsWith('|' + today)));
      let changed = false;
      for (const t of this.tasks) {
        if (isDue(t, now, fired)) {
          fired = { ...fired, [`${t.id}|${today}`]: true };
          changed = true;
          this.enqueue(this.makeReminder('task', t));
        }
      }
      if (changed) this.ctx.globalState.update('fired', fired);
    }
    this.pump();
    this.updateStatus();
  }

  updateStatus() {
    const left = waterMinutesLeft(this.lastWaterAt, cfg().get('waterEveryMinutes', 0), Date.now());
    const water = left === null ? '' : ` ${left}m`;
    this.status.text = this.muted ? '$(bell-slash) Buddy' : `$(smiley) Buddy${left === null ? "" : "$(droplet)"}${water}`;
    this.status.tooltip = this.muted ? 'Desk Buddy is muted' : 'Open Desk Buddy';
  }
}

function activate(ctx) {
  const buddy = new Buddy(ctx);

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('deskBuddy.view', {
      resolveWebviewView(view) {
        buddy.view = view;
        const host = buddy.attach(view.webview, () => view.visible);
        // a hidden webview is torn down and reloaded when shown again; it re-sends 'ready' when it is back
        view.onDidChangeVisibility(() => { if (!view.visible) host.ready = false; });
        view.onDidDispose(() => { buddy.view = null; buddy.detach(host); });
      }
    }),

    vscode.commands.registerCommand('deskBuddy.openInEditor', () => {
      const panel = vscode.window.createWebviewPanel('deskBuddy.panel', 'Desk Buddy', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
      const host = buddy.attach(panel.webview, () => panel.visible);
      panel.onDidChangeViewState(() => { if (!panel.visible) host.ready = false; });
      panel.onDidDispose(() => buddy.detach(host));
    }),
    vscode.commands.registerCommand('deskBuddy.uploadCharacter', () => buddy.uploadCharacters()),
    vscode.commands.registerCommand('deskBuddy.testReminder', () => buddy.testReminder()),
    vscode.commands.registerCommand('deskBuddy.toggleMute', () => buddy.toggleMute()),
    vscode.commands.registerCommand('deskBuddy.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local.desk-buddy')),

    vscode.window.onDidChangeWindowState(() => buddy.pump()),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('deskBuddy')) buddy.pushState(); })
  );

  const timer = setInterval(() => buddy.tick(), TICK_MS);
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) });
  buddy.updateStatus();
}

function deactivate() {}

module.exports = { activate, deactivate };
