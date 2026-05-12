import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

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
      // G-03: Reject MFA temp tokens — they are only valid for the /auth/mfa/verify endpoint
      if (decoded.mfaPending) {
        return next(new Error('MFA verification required. Complete MFA before connecting.'));
      }
      socket.data.userId = decoded.userId;
      socket.data.organizationId = decoded.organizationId;
      socket.data.role = decoded.role;
      socket.data.tokenExp = decoded.exp ?? 0; // Unix timestamp
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

    // Warn client ~60s before token expiry so it can refresh before socket auth goes stale.
    // On expiry the client should reconnect with a new token via socket.auth.token update.
    const tokenExp: number = socket.data.tokenExp ?? 0;
    if (tokenExp > 0) {
      const warnAt = (tokenExp - Math.floor(Date.now() / 1000) - 60) * 1000;
      if (warnAt > 0) {
        const warnTimer = setTimeout(() => {
          socket.emit('token:expire-soon', { expiresAt: tokenExp });
        }, warnAt);
        socket.on('disconnect', () => clearTimeout(warnTimer));
      }
    }

    // Agent registers itself with employeeId for direct communication
    socket.on('agent:register', () => {
      socket.join(`agent:${userId}`);
      logger.info(`Agent registered: user=${userId}`);
      // Notify the user's own browser sessions immediately so AgentDownloadBanner
      // transitions to "Connected" instantly rather than waiting for the next poll cycle.
      emitToUser(userId, 'agent:connected', { isActive: true });
    });

    // === WebRTC Signaling for Live Screen Streaming ===

    // Admin requests to start streaming an employee's screen
    socket.on('stream:request', async (data: { employeeUserId: string }) => {
      if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) return;

      // Audit log: record who initiated monitoring and of whom
      try {
        await prisma.auditLog.create({
          data: {
            action: 'STREAM_REQUEST',
            entity: 'ActivityMonitoring',
            entityId: data.employeeUserId,
            userId,
            organizationId,
            newValue: { adminUserId: userId, targetEmployeeUserId: data.employeeUserId, event: 'stream:request' },
          },
        });
      } catch { /* non-blocking */ }

      logger.info(`Stream requested by admin ${userId} for employee ${data.employeeUserId}`);

      const agentSockets = await io!.in(`agent:${data.employeeUserId}`).fetchSockets();
      if (agentSockets.length === 0) {
        socket.emit('stream:error', {
          employeeUserId: data.employeeUserId,
          message: 'Desktop agent is not running or not connected. Ask the employee to start the agent.',
        });
        return;
      }

      // DPDP Act 2023 compliance: notify the employee that screen monitoring has been initiated.
      // The employee's browser/app receives 'stream:monitoring-notice' and should display a visible banner.
      // This is a notice (not a blocking consent request) consistent with employment agreements where
      // monitoring is a disclosed condition of using company equipment/systems.
      io!.to(`user:${data.employeeUserId}`).emit('stream:monitoring-notice', {
        message: 'Your screen is being monitored by an administrator as per company policy.',
        adminUserId: userId,
        startedAt: new Date().toISOString(),
      });

      io!.to(`agent:${data.employeeUserId}`).emit('stream:start', {
        adminSocketId: socket.id,
        adminUserId: userId,
      });
    });

    // Admin requests to stop streaming
    socket.on('stream:stop-request', async (data: { employeeUserId: string }) => {
      if (!['SUPER_ADMIN', 'ADMIN'].includes(socket.data?.role)) return;

      try {
        await prisma.auditLog.create({
          data: {
            action: 'STREAM_STOP',
            entity: 'ActivityMonitoring',
            entityId: data.employeeUserId,
            userId,
            organizationId,
            newValue: { adminUserId: userId, targetEmployeeUserId: data.employeeUserId, event: 'stream:stop' },
          },
        });
      } catch { /* non-blocking */ }

      io!.to(`agent:${data.employeeUserId}`).emit('stream:stop');
    });

    // WebRTC signaling relay — only ADMIN/SUPER_ADMIN or registered agents may relay signals.
    // Agents are identified by being registered in the agent: room.
    socket.on('stream:signal', async (data: { type: string; sdp?: any; candidate?: any; targetSocketId?: string }) => {
      const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(socket.data?.role);
      const agentRoom = io!.sockets.adapter.rooms.get(`agent:${userId}`);
      const isAgent = agentRoom ? agentRoom.has(socket.id) : false;

      // Only admins and registered agents may participate in WebRTC signaling
      if (!isAdmin && !isAgent) return;

      if (data.targetSocketId) {
        const targetSocket = io!.sockets.sockets.get(data.targetSocketId);
        if (!targetSocket || targetSocket.data?.organizationId !== socket.data?.organizationId) return;

        // Validate that the target is either an admin or a registered agent (no arbitrary relay)
        const targetIsAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(targetSocket.data?.role);
        const targetAgentRoom = io!.sockets.adapter.rooms.get(`agent:${targetSocket.data?.userId}`);
        const targetIsAgent = targetAgentRoom ? targetAgentRoom.has(data.targetSocketId) : false;

        if (!targetIsAdmin && !targetIsAgent) return;

        io!.to(data.targetSocketId).emit('stream:signal', {
          ...data,
          fromSocketId: socket.id,
        });
      }
    });

    // Agent reports a WebRTC error — relay to the requesting admin (sanitize message).
    socket.on('stream:agent-error', (data: { message: string; targetSocketId?: string }) => {
      const agentRoom = io!.sockets.adapter.rooms.get(`agent:${userId}`);
      const isAgent = agentRoom ? agentRoom.has(socket.id) : false;
      if (!isAgent) return; // Only registered agents may send errors

      const targetId = data.targetSocketId;
      if (targetId) {
        const targetSocket = io!.sockets.sockets.get(targetId);
        if (targetSocket && targetSocket.data?.organizationId === socket.data?.organizationId) {
          const isTargetAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(targetSocket.data?.role);
          if (!isTargetAdmin) return; // Only relay errors to admins

          // Sanitize message to prevent XSS via relay
          const safeMessage = String(data.message ?? 'Agent error').slice(0, 500).replace(/[<>]/g, '');
          io!.to(targetId).emit('stream:error', {
            message: safeMessage,
            employeeUserId: socket.data.userId,
          });
        }
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
