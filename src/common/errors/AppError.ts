export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_MAX_ATTEMPTS'
  | 'INVALID_STATE_TRANSITION'
  | 'DUPLICATE_ASSIGNMENT'
  | 'NO_PILOT_FOUND'
  | 'ELIGIBILITY_DENIED'
  | 'PAYMENT_FAILED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code: ErrorCode = 'INTERNAL_ERROR',
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(message, 400, 'BAD_REQUEST', details);
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(message, 401, 'UNAUTHORIZED');
  }

  static forbidden(message = 'Forbidden'): AppError {
    return new AppError(message, 403, 'FORBIDDEN');
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(message, 404, 'NOT_FOUND');
  }

  static conflict(message: string, code: ErrorCode = 'CONFLICT'): AppError {
    return new AppError(message, 409, code);
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(message, 422, 'VALIDATION_ERROR', details);
  }

  static rateLimited(message = 'Too many requests'): AppError {
    return new AppError(message, 429, 'RATE_LIMITED');
  }
}
