import { io, Socket } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:4000';

let socket: Socket | null = null;

export function connectSocket(token: string) {
  if (socket?.connected) return socket;

  socket = io(API_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socket.on('connect', () => {
    console.log('[Socket] Connected:', socket?.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket] Connection error:', err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}

export function onSocketEvent(event: string, callback: (data: any) => void) {
  if (!socket) return;
  socket.on(event, callback);
}

export function offSocketEvent(event: string, callback: (data: any) => void) {
  if (!socket) return;
  socket.off(event, callback);
}
