import { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis.js';
import { AppError } from './errorHandler.js';
import { logger } from '../lib/logger.js';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  keyFn?: (req: Request) => string;
  // When true, Redis failures cause a 503 instead of allowing the request.
  // Set this on sensitive endpoints (auth, MFA) to prevent bypass on Redis outage.
  failClosed?: boolean;
}

export function rateLimiter(options: RateLimitOptions) {
  const { windowMs, max, keyPrefix = 'rl', keyFn, failClosed = false } = options;
  const windowSec = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const key = keyFn ? keyFn(req) : `${keyPrefix}:${ip}`;

      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowSec);
      }

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - current));

      if (current > max) {
        next(new AppError('Too many requests, please try again later', 429, 'RATE_LIMIT_EXCEEDED'));
        return;
      }

      next();
    } catch (err) {
      logger.error('Rate limiter Redis error', { error: (err as Error).message, path: req.path });
      if (failClosed) {
        // Sensitive endpoints must not allow unbounded requests when Redis is unavailable
        next(new AppError('Service temporarily unavailable. Please try again in a moment.', 503, 'SERVICE_UNAVAILABLE'));
        return;
      }
      // Non-sensitive endpoints fail open to preserve availability
      next();
    }
  };
}
