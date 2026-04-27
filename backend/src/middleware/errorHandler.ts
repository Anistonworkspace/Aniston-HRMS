import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Bad request') {
    super(message, 400, 'BAD_REQUEST');
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class GoneError extends AppError {
  constructor(message: string = 'Resource no longer available') {
    super(message, 410, 'GONE');
    Object.setPrototypeOf(this, GoneError.prototype);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message: string = 'Unprocessable entity') {
    super(message, 422, 'UNPROCESSABLE_ENTITY');
    Object.setPrototypeOf(this, UnprocessableEntityError.prototype);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
    Object.setPrototypeOf(this, ServiceUnavailableError.prototype);
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // Zod validation errors
  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    err.errors.forEach((e) => {
      const path = e.path.join('.') || 'unknown';
      if (!details[path]) details[path] = [];
      details[path].push(e.message);
    });

    // Build a human-readable summary from field errors
    const fieldSummaries = Object.entries(details).map(
      ([field, messages]) => `${field}: ${messages.join(', ')}`
    );
    const message = fieldSummaries.length === 1
      ? fieldSummaries[0]
      : `Validation failed — ${fieldSummaries.join('; ')}`;

    logger.warn('Validation error:', { details, url: _req.originalUrl, method: _req.method });

    res.status(400).json({
      success: false,
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message,
        details,
      },
    });
    return;
  }

  // Operational errors (our custom errors)
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      data: null,
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  // Multer file upload errors (file too large, wrong type, etc.)
  if (err instanceof multer.MulterError) {
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE: 'File is too large. Please use a smaller file and try again.',
      LIMIT_FILE_COUNT: 'Too many files uploaded.',
      LIMIT_FIELD_KEY: 'Field name is too long.',
      LIMIT_FIELD_VALUE: 'Field value is too long.',
      LIMIT_FIELD_COUNT: 'Too many fields.',
      LIMIT_UNEXPECTED_FILE: 'Unexpected file field. Please try again.',
      LIMIT_PART_COUNT: 'Too many parts in the upload.',
    };
    res.status(400).json({
      success: false,
      data: null,
      error: {
        code: 'UPLOAD_ERROR',
        message: messages[err.code] || `File upload error: ${err.message}`,
      },
    });
    return;
  }

  // Prisma validation errors (e.g., undefined passed to required field)
  if (err.constructor.name === 'PrismaClientValidationError') {
    logger.error('Prisma validation error:', err.message);
    res.status(400).json({
      success: false,
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid data provided. Please check your input and try again.',
      },
    });
    return;
  }

  // Prisma known errors
  if (err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as any;
    const requestId = (_req.headers?.['x-request-id'] as string) || undefined;

    if (prismaErr.code === 'P2002') {
      const target = prismaErr.meta?.target?.join(', ') || 'field';
      res.status(409).json({
        success: false,
        data: null,
        error: {
          code: 'DUPLICATE_ENTRY',
          message: `A record with this ${target} already exists`,
        },
      });
      return;
    }
    if (prismaErr.code === 'P2003') {
      const field = prismaErr.meta?.field_name || 'related record';
      res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'FOREIGN_KEY_ERROR',
          message: `Referenced ${field} does not exist`,
        },
      });
      return;
    }
    if (prismaErr.code === 'P2025') {
      res.status(404).json({
        success: false,
        data: null,
        error: {
          code: 'NOT_FOUND',
          message: 'Record not found',
        },
      });
      return;
    }
    if (prismaErr.code === 'P2000') {
      res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A field value is too long for the database column.',
        },
      });
      return;
    }
    if (prismaErr.code === 'P2001') {
      res.status(404).json({
        success: false,
        data: null,
        error: {
          code: 'NOT_FOUND',
          message: 'The record you searched for does not exist.',
        },
      });
      return;
    }
    if (prismaErr.code === 'P2011') {
      const field = prismaErr.meta?.constraint || 'field';
      res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Required field "${field}" cannot be null.`,
        },
      });
      return;
    }
    if (prismaErr.code === 'P2012') {
      const field = prismaErr.meta?.path || 'field';
      res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Missing required value for "${field}".`,
        },
      });
      return;
    }
    if (prismaErr.code === 'P2014') {
      res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'RELATION_VIOLATION',
          message: 'The change violates a required relation. Check that all referenced records exist.',
        },
      });
      return;
    }
    if (prismaErr.code === 'P2016') {
      logger.error('Prisma query interpretation error:', {
        message: prismaErr.message,
        requestId,
        url: _req.originalUrl,
      });
      res.status(400).json({
        success: false,
        data: null,
        error: {
          code: 'QUERY_ERROR',
          message: 'Invalid query. Please check your input and try again.',
        },
      });
      return;
    }
    if (prismaErr.code === 'P2021') {
      logger.error('Prisma table-not-found error — possible migration out of sync:', {
        message: prismaErr.message,
        requestId,
        url: _req.originalUrl,
      });
      res.status(500).json({
        success: false,
        data: null,
        error: {
          code: 'SCHEMA_ERROR',
          message: 'A database schema error occurred. Please contact support.',
        },
      });
      return;
    }
    if (prismaErr.code === 'P2034') {
      res.status(409).json({
        success: false,
        data: null,
        error: {
          code: 'TRANSACTION_CONFLICT',
          message: 'A concurrent update conflict occurred. Please try again.',
        },
      });
      return;
    }
  }

  // Prisma unknown request errors (e.g. connection issues, driver errors)
  if (err.constructor.name === 'PrismaClientUnknownRequestError' || err.constructor.name === 'PrismaClientRustPanicError') {
    const requestId2 = (_req.headers?.['x-request-id'] as string) || 'unknown';
    logger.error('Prisma unknown error:', { message: (err as any).message, requestId: requestId2, url: _req.originalUrl });
    res.status(500).json({
      success: false,
      data: null,
      error: {
        code: 'DATABASE_ERROR',
        message: 'A database error occurred. Please try again in a moment.',
      },
    });
    return;
  }

  // Unknown / programmer errors
  const requestId = (_req.headers?.['x-request-id'] as string) || 'unknown';
  logger.error('Unhandled error:', {
    message: (err as any).message,
    stack: (err as any).stack,
    requestId,
    method: _req.method,
    url: _req.originalUrl,
  });
  res.status(500).json({
    success: false,
    data: null,
    error: {
      code: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production'
        ? 'Something went wrong. Please try again, or contact support if the issue persists.'
        : err.message,
    },
  });
}
