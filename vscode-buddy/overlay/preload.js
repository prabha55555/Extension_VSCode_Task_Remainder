const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  onRemind: (cb) => ipcRenderer.on('remind', (_e, m) => cb(m)),
  onDismiss: (cb) => ipcRenderer.on('dismiss', (_e, m) => cb(m)),
  shown: (id) => ipcRenderer.send('shown', id),
  answer: (a) => ipcRenderer.send('answer', a),
  hidden: () => ipcRenderer.send('hidden'),
  clickable: (yes) => ipcRenderer.send('clickable', yes),
  error: (message) => ipcRenderer.send('error', message)
});
