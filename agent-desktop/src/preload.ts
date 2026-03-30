// Preload script — currently minimal, can be expanded for secure IPC
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agentAPI', {
  login: (email: string, password: string) => ipcRenderer.send('agent-login', { email, password }),
  onLoginError: (callback: (msg: string) => void) => ipcRenderer.on('login-error', (_, msg) => callback(msg)),
  onLoginSuccess: (callback: () => void) => ipcRenderer.on('login-success', () => callback()),
});
