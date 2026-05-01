import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pairAPI', {
  sendCode: (code: string) =>
    ipcRenderer.send('agent-pair', code),
  onError: (cb: (msg: string) => void) =>
    ipcRenderer.on('pair-error', (_event, msg) => cb(msg)),
  onSuccess: (cb: () => void) =>
    ipcRenderer.on('pair-success', () => cb()),
});
