import type { NextFunction, Request, Response } from 'express';
import type { AnyZodObject, ZodEffects, ZodTypeAny } from 'zod';
import { AppError } from '../errors/AppError';

type Schema = AnyZodObject | ZodEffects<AnyZodObject> | ZodTypeAny;

interface RequestSchemas {
  body?: Schema;
  query?: Schema;
  params?: Schema;
}

export function validateRequest(schemas: RequestSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as Request['query'];
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as Request['params'];
      }
      next();
    } catch (error) {
      next(AppError.validation('Request validation failed', error));
    }
  };
}
