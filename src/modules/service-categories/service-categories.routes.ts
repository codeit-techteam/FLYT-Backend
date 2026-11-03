import { Router } from 'express';
import { prisma } from '../../config/database';
import { sendSuccess } from '../../common/utils/response';

export const serviceCategoriesRouter = Router();

serviceCategoriesRouter.get('/', async (_req, res, next) => {
  try {
    const items = await prisma.serviceCategory.findMany({
      where: { isActive: true },
      include: { vehicleCategory: true },
      orderBy: { name: 'asc' },
    });
    sendSuccess(
      res,
      items.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        description: c.description,
        vehicleCategoryId: c.vehicleCategoryId,
        vehicleCategoryCode: c.vehicleCategory.code,
        capacity: c.vehicleCategory.capacity,
      })),
    );
  } catch (error) {
    next(error);
  }
});
