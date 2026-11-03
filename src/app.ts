import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import { corsOrigins, env } from './config/env';
import { logger } from './config/logger';
import { requestId } from './common/middleware/requestId';
import { errorHandler, notFoundHandler } from './common/middleware/errorHandler';
import { apiRouter, healthRouter } from './routes';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/live',
      },
      customProps: (req) => ({ requestId: (req as express.Request).requestId }),
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: env().NODE_ENV === 'production' ? undefined : false,
    }),
  );

  app.use(
    cors({
      origin: corsOrigins(),
      credentials: true,
    }),
  );

  if (env().NODE_ENV !== 'test') {
    app.use(
      rateLimit({
        windowMs: env().RATE_LIMIT_WINDOW_MS,
        max: env().RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
      }),
    );
  }

  app.use(compression());

  // Raw body for Razorpay webhooks — mounted before JSON parser for that path
  app.use(
    '/api/v1/payments/webhooks/razorpay',
    express.raw({ type: 'application/json' }),
    (req, _res, next) => {
      if (Buffer.isBuffer(req.body)) {
        (req as express.Request & { rawBody?: string }).rawBody = req.body.toString('utf8');
        try {
          req.body = JSON.parse((req as express.Request & { rawBody?: string }).rawBody ?? '{}');
        } catch {
          req.body = {};
        }
      }
      next();
    },
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(healthRouter);

  try {
    const openapiPath = join(process.cwd(), 'openapi.yaml');
    const document = YAML.parse(readFileSync(openapiPath, 'utf8')) as object;
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(document));
    app.get('/openapi.yaml', (_req, res) => {
      res.type('text/yaml').send(readFileSync(openapiPath, 'utf8'));
    });
  } catch {
    logger.warn('OpenAPI document not found; Swagger UI disabled');
  }

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
