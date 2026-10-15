const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  done: () => ipcRenderer.send('done'),
  snooze: () => ipcRenderer.send('snooze'),
  setClickable: (yes) => ipcRenderer.send('clickable', yes),
  onShow: (cb) => ipcRenderer.on('show', (_e, reminder) => cb(reminder)),
  onHide: (cb) => ipcRenderer.on('hide', cb)
});
