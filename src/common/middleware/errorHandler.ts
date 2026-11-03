import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import type { ApiFailure } from '../types/api';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`));
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = AppError.validation('Validation failed', err.flatten());
  } else {
    logger.error({ err, requestId: req.requestId }, 'Unhandled error');
    appError = new AppError('Internal server error', 500, 'INTERNAL_ERROR');
  }

  if (!appError.isOperational || appError.statusCode >= 500) {
    logger.error(
      {
        err,
        code: appError.code,
        requestId: req.requestId,
        path: req.path,
        method: req.method,
      },
      appError.message,
    );
  }

  const body: ApiFailure = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      requestId: req.requestId,
    },
  };

  if (appError.details && env().NODE_ENV !== 'production') {
    body.error.details = appError.details;
  }

  if (env().NODE_ENV === 'production' && appError.statusCode >= 500) {
    body.error.message = 'Internal server error';
  }

  res.status(appError.statusCode).json(body);
}
