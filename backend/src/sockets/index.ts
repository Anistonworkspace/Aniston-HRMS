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
    const { userId, organizationId, role } = socket.data;
    logger.info(`Socket connected: user=${userId} role=${role}`);

    // Join personal room and org room
    socket.join(`user:${userId}`);
    socket.join(`org:${organizationId}`);

    // Agent registers itself with employeeId for direct communication
    socket.on('agent:register', () => {
      socket.join(`agent:${userId}`);
      logger.info(`Agent registered: user=${userId}`);
    });

    // === WebRTC Signaling for Live Screen Streaming ===

    // Admin requests to start streaming an employee's screen
    socket.on('stream:request', (data: { employeeUserId: string }) => {
      if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) return; // Only admin can request
      logger.info(`Stream requested by admin ${userId} for employee ${data.employeeUserId}`);
      // Tell the agent to start streaming, pass the admin's socket ID for direct P2P signaling
      io!.to(`agent:${data.employeeUserId}`).emit('stream:start', {
        adminSocketId: socket.id,
        adminUserId: userId,
      });
    });

    // Admin requests to stop streaming
    socket.on('stream:stop-request', (data: { employeeUserId: string }) => {
      if (!['SUPER_ADMIN', 'ADMIN'].includes(socket.data?.role)) return;
      io!.to(`agent:${data.employeeUserId}`).emit('stream:stop');
    });

    // WebRTC signaling relay — forward offer/answer/ICE between agent and admin
    socket.on('stream:signal', (data: { type: string; sdp?: any; candidate?: any; targetSocketId?: string }) => {
      if (data.targetSocketId) {
        const targetSocket = io!.sockets.sockets.get(data.targetSocketId);
        if (!targetSocket || targetSocket.data?.organizationId !== socket.data?.organizationId) return;
        // Direct to specific socket (agent → admin or admin → agent)
        io!.to(data.targetSocketId).emit('stream:signal', {
          ...data,
          fromSocketId: socket.id,
        });
      }
    });

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
 * Invalidate dashboard cache for an org and notify connected clients to refetch.
 * Call this after attendance, leave, or payroll changes.
 */
export async function invalidateDashboardCache(organizationId: string) {
  try {
    const { redis } = await import('../lib/redis.js');
    const keys = [
      `dashboard:employee:${organizationId}`,
      `dashboard:hr:${organizationId}`,
      `dashboard:superadmin:${organizationId}`,
    ];
    await Promise.all(keys.map((k) => redis.del(k)));
  } catch { /* Redis unavailable */ }

  // Notify all org users to refetch dashboard data
  if (io) {
    io.to(`org:${organizationId}`).emit('dashboard:refresh');
  }
}

/**
 * Get the Socket.io instance
 */
export function getIO(): SocketServer | null {
  return io;
}
