// Exposed ONLY to our own local pages (splash / error / diagnostics), never to
// the web app served from http://127.0.0.1.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('nodedrShell', {
    onState: (cb) => ipcRenderer.on('shell:state', (_e, s) => cb(s)),
    ready: () => ipcRenderer.send('shell:page-ready'),
    action: (name) => ipcRenderer.invoke('shell:action', name),
  });
}
