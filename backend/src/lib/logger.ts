import winston from 'winston';
import path from 'path';
import { mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// logs/ lives at backend/logs/ — two levels up from src/lib/
export const logsDirectory = path.resolve(__dirname, '../../logs');

// Ensure the directory exists before attaching the File transport
if (!existsSync(logsDirectory)) {
  mkdirSync(logsDirectory, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Human-readable format used by the Console transport
const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  defaultMeta: { service: 'aniston-hrms-api' },
  transports: [
    // ── Console: colourised human-readable output ──────────────────────────
    new winston.transports.Console({
      format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        colorize(),
        consoleFormat,
      ),
    }),
    // ── File: structured JSON — used by the System Logs UI ────────────────
    // Winston rotates automatically: app.log (current), app1.log, … app4.log
    new winston.transports.File({
      filename: path.join(logsDirectory, 'app.log'),
      maxsize: 10 * 1024 * 1024, // 10 MB per file
      maxFiles: 5,
      tailable: true, // newest entries always in app.log
      format: combine(
        errors({ stack: true }),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json(),
      ),
    }),
  ],
});
