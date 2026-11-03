import type { Response } from 'express';
import type { ApiSuccess } from '../types/api';

export function sendSuccess<T>(
  res: Response,
  data: T,
  status = 200,
  meta?: Record<string, unknown>,
): void {
  const body: ApiSuccess<T> = { success: true, data };
  if (meta) body.meta = meta;
  res.status(status).json(body);
}
