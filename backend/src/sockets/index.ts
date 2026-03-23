import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let io: SocketServer | null = null;

export function initSocketServer(httpServer: HttpServer) {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.FRONTEND_URL,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Auth middleware — verify JWT from handshake
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as any;
      socket.data.userId = decoded.userId;
      socket.data.organizationId = decoded.organizationId;
      socket.data.role = decoded.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, organizationId } = socket.data;
    logger.info(`Socket connected: user=${userId}`);

    // Join personal room and org room
    socket.join(`user:${userId}`);
    socket.join(`org:${organizationId}`);

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: user=${userId}`);
    });
  });

  logger.info('✅ Socket.io initialized');
  return io;
}

/**
 * Emit event to a specific user
 */
export function emitToUser(userId: string, event: string, data: any) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

/**
 * Emit event to all users in an organization
 */
export function emitToOrg(organizationId: string, event: string, data: any) {
  if (!io) return;
  io.to(`org:${organizationId}`).emit(event, data);
}

/**
 * Get the Socket.io instance
 */
export function getIO(): SocketServer | null {
  return io;
}
