import { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis.js';
import { AppError } from './errorHandler.js';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  keyFn?: (req: Request) => string;
}

export function rateLimiter(options: RateLimitOptions) {
  const { windowMs, max, keyPrefix = 'rl', keyFn } = options;
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
    } catch {
      // If Redis is down, allow the request
      next();
    }
  };
}
