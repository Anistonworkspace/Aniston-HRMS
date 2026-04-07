import { io, Socket } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:4000';

let socket: Socket | null = null;

// Queue of pending listeners registered before socket was ready
const pendingListeners: Array<{ event: string; callback: (data: any) => void }> = [];

export function connectSocket(token: string) {
  if (socket?.connected) return socket;

  // Prevent duplicate socket creation if one is already connecting
  if (socket && !socket.connected) {
    socket.disconnect();
    socket = null;
  }

  socket = io(API_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socket.on('connect', () => {
    if (import.meta.env.DEV) console.log('[Socket] Connected:', socket?.id);
    // Flush any pending listeners that were queued before connection
    while (pendingListeners.length > 0) {
      const { event, callback } = pendingListeners.shift()!;
      socket?.on(event, callback);
    }
  });

  socket.on('disconnect', (reason) => {
    if (import.meta.env.DEV) console.log('[Socket] Disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    if (import.meta.env.DEV) console.warn('[Socket] Connection error:', err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  // Clear any pending listeners on disconnect
  pendingListeners.length = 0;
}

export function getSocket(): Socket | null {
  return socket;
}

export function onSocketEvent(event: string, callback: (data: any) => void) {
  if (socket?.connected) {
    socket.on(event, callback);
  } else if (socket) {
    // Socket exists but not yet connected — only queue, do NOT also register directly
    // (registering both here + flushing from pendingListeners causes duplicate handlers)
    pendingListeners.push({ event, callback });
  } else {
    // Socket not initialized yet — queue for when connectSocket() is called
    pendingListeners.push({ event, callback });
  }
}

export function offSocketEvent(event: string, callback: (data: any) => void) {
  if (socket) {
    socket.off(event, callback);
  }
  // Also remove from pending queue if it's there
  const idx = pendingListeners.findIndex(p => p.event === event && p.callback === callback);
  if (idx !== -1) pendingListeners.splice(idx, 1);
}
