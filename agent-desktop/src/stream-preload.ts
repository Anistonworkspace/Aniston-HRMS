import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('streamAPI', {
  onStartStream: (cb: (config: unknown) => void) =>
    ipcRenderer.on('start-stream', (_event, config) => cb(config)),
  onSignalingMessage: (cb: (data: unknown) => void) =>
    ipcRenderer.on('signaling-message', (_event, data) => cb(data)),
  onStopStream: (cb: () => void) =>
    ipcRenderer.on('stop-stream', () => cb()),
  sendSignal: (data: unknown) =>
    ipcRenderer.send('webrtc-signal', data),
  sendError: (data: unknown) =>
    ipcRenderer.send('webrtc-error', data),
  getSources: (): Promise<{ id: string; name: string; thumbnailDataUrl: string }[]> =>
    ipcRenderer.invoke('get-screen-sources'),
});
