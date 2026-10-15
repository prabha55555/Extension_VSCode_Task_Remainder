// Starts the transparent overlay window (see ../overlay) with an Electron binary and talks to it over a local socket.
// (Electron on Windows has no usable stdin, so the window connects back to a server we run on 127.0.0.1.)
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const readline = require('readline');

const BIN = process.platform === 'win32' ? 'electron.exe'
  : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';

/** Look for an installed Electron: the setting, the saved choice, a workspace's node_modules, then a global npm install. */
function findElectron({ configured, saved, folders }) {
  const globalRoots = [process.env.APPDATA && path.join(process.env.APPDATA, 'npm'), '/usr/local/lib', '/usr/lib'].filter(Boolean);
  const candidates = [
    configured, saved,
    ...folders.map((f) => path.join(f, 'node_modules', 'electron', 'dist', BIN)),
    ...globalRoots.map((r) => path.join(r, 'node_modules', 'electron', 'dist', BIN))
  ].filter(Boolean);
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

class Overlay {
  /** handlers: { answer(id, action, minutes), shown(id), error(message), exited() } */
  constructor(dir, handlers) {
    this.dir = dir;
    this.handlers = handlers;
    this.child = null;
    this.server = null;
    this.socket = null;
    this.queue = [];             // messages sent before the window has connected
  }

  get running() { return Boolean(this.child); }

  /** Starts the window process if needed. Returns false when no Electron was given or it could not be started. */
  start(electronPath) {
    if (this.child) return true;
    if (!electronPath) return false;
    const token = crypto.randomBytes(16).toString('hex');
    const server = net.createServer((socket) => {
      const rl = readline.createInterface({ input: socket });
      let trusted = false;
      rl.on('line', (line) => {
        let m;
        try { m = JSON.parse(line); } catch { return; }
        if (!trusted) {                                     // only the window we started may talk to us
          if (m.type === 'hello' && m.token === token) {
            trusted = true;
            this.socket = socket;
            this.queue.splice(0).forEach((q) => this.send(q));
          } else socket.destroy();
          return;
        }
        if (m.type === 'answer') this.handlers.answer(m.id, m.action, m.minutes);
        else if (m.type === 'shown') this.handlers.shown(m.id);
        else if (m.type === 'error') this.handlers.error(m.message);
      });
      socket.on('error', () => { /* the window closed; 'exit' handles it */ });
    });
    this.server = server;
    this.child = {};                                        // placeholder until the process is spawned
    server.listen(0, '127.0.0.1', () => {
      if (this.server !== server) return;
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;                      // VS Code's extension host sets this; Electron would then run as plain Node
      const fail = () => { if (this.server === server) { this.cleanup(); this.handlers.exited(); } };
      try {
        const child = spawn(electronPath, [this.dir, `--port=${server.address().port}`, `--token=${token}`], { env, stdio: 'ignore' });
        this.child = child;
        child.on('error', fail);
        child.on('exit', fail);
      } catch { fail(); }
    });
    return true;
  }

  cleanup() {
    const { server, socket } = this;
    this.child = null; this.server = null; this.socket = null; this.queue = [];
    if (socket) socket.destroy();
    if (server) server.close();
  }

  send(msg) {
    if (this.socket && this.socket.writable) this.socket.write(JSON.stringify(msg) + '\n');
    else if (this.child) this.queue.push(msg);
  }

  dispose() {
    if (!this.child) return;
    this.send({ type: 'quit' });
    const c = this.child;
    setTimeout(() => { try { if (c.kill) c.kill(); } catch { /* already gone */ } this.cleanup(); }, 500);
  }
}

module.exports = { Overlay, findElectron };
