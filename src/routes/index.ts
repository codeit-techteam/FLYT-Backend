import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { customersRouter } from '../modules/customers/customers.routes';
import { pilotsRouter, pilotOffersRouter } from '../modules/pilots/pilots.routes';
import { pilotCompatRouter } from '../modules/pilots/pilot-compat.routes';
import { bookingsRouter } from '../modules/bookings/bookings.routes';
import { tripsRouter } from '../modules/trips/trips.routes';
import { paymentsRouter } from '../modules/payments/payments.routes';
import { adminRouter } from '../modules/admin/admin.routes';
import { safetyRouter } from '../modules/safety/safety.routes';
import { serviceCategoriesRouter } from '../modules/service-categories/service-categories.routes';
import { checkDatabaseHealth } from '../config/database';
import { checkRedisHealth } from '../config/redis';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/customers', customersRouter);
apiRouter.use('/pilots', pilotsRouter);
apiRouter.use('/pilot', pilotOffersRouter);
apiRouter.use('/pilot', pilotCompatRouter);
apiRouter.use('/rides', bookingsRouter);
apiRouter.use('/rides', tripsRouter);
apiRouter.use('/payments', paymentsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/safety', safetyRouter);
apiRouter.use('/service-categories', serviceCategoriesRouter);

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const [db, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);
  const status = db && redis ? 'ok' : 'degraded';
  res.status(status === 'ok' ? 200 : 503).json({
    success: true,
    data: {
      status,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks: { database: db, redis },
    },
  });
});

healthRouter.get('/ready', async (_req, res) => {
  const [db, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);
  if (!db || !redis) {
    res.status(503).json({ success: false, error: { code: 'NOT_READY', message: 'Dependencies not ready' } });
    return;
  }
  res.json({ success: true, data: { ready: true } });
});

healthRouter.get('/live', (_req, res) => {
  res.json({ success: true, data: { live: true } });
});
