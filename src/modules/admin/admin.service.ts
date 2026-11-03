import { prisma } from '../../config/database';
import { AppError } from '../../common/errors/AppError';

export class AdminService {
  async dashboard() {
    const [ridesToday, activePilots, openSos, pendingPayments, revenueAgg] = await Promise.all([
      prisma.ride.count({
        where: {
          createdAt: { gte: startOfUtcDay() },
        },
      }),
      prisma.pilotAvailability.count({ where: { status: 'ONLINE' } }),
      prisma.sOSIncident.count({ where: { status: 'OPEN' } }),
      prisma.payment.count({ where: { status: { in: ['PENDING', 'CREATED'] } } }),
      prisma.commission.aggregate({
        _sum: { commissionAmount: true },
        where: { createdAt: { gte: startOfUtcDay() } },
      }),
    ]);

    return {
      ridesToday,
      activePilots,
      openSos,
      pendingPayments,
      commissionToday: Number(revenueAgg._sum.commissionAmount ?? 0),
    };
  }

  async listRides(query: { status?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where = query.status ? { status: query.status as never } : {};

    const [items, total] = await Promise.all([
      prisma.ride.findMany({
        where,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true } },
          pilot: { select: { id: true, firstName: true, lastName: true } },
          payment: true,
          commission: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.ride.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async listPilots(query: { status?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where = query.status ? { status: query.status as never } : {};

    const [items, total] = await Promise.all([
      prisma.pilot.findMany({
        where,
        include: {
          user: { select: { phone: true, status: true } },
          availability: true,
          verification: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.pilot.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async listCustomers(query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);

    const [items, total] = await Promise.all([
      prisma.customer.findMany({
        include: {
          user: { select: { phone: true, status: true } },
          modeEligibilities: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.customer.count(),
    ]);

    return { items, total, page, limit };
  }

  async listPayments(query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);

    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        include: { ride: { select: { rideNumber: true, status: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.payment.count(),
    ]);

    return { items, total, page, limit };
  }

  async verifyCustomerDob(customerId: string, adminUserId: string) {
    const customer = await prisma.customer.update({
      where: { id: customerId },
      data: { dobVerified: true },
    });

    await prisma.auditLog.create({
      data: {
        actorId: adminUserId,
        action: 'CUSTOMER_DOB_VERIFIED',
        entityType: 'Customer',
        entityId: customerId,
      },
    });

    return customer;
  }

  async getRideDetail(rideId: string) {
    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        customer: true,
        pilot: true,
        vehicle: true,
        fareQuote: { include: { breakdown: true } },
        payment: { include: { refunds: true } },
        commission: true,
        cashCollection: true,
        offers: true,
        events: { orderBy: { createdAt: 'asc' } },
        cancellation: true,
      },
    });
    if (!ride) throw AppError.notFound('Ride not found');
    return ride;
  }
}

function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const adminService = new AdminService();
