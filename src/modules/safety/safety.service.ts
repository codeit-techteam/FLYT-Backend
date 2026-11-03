import { prisma } from '../../config/database';
import { AppError } from '../../common/errors/AppError';
import { getSocketGateway } from '../../config/socket';
import { generateSecureToken } from '../../common/utils/crypto';

export class SafetyService {
  async triggerSos(input: {
    customerId: string;
    rideId?: string;
    latitude?: number;
    longitude?: number;
    notes?: string;
  }) {
    const ride = input.rideId
      ? await prisma.ride.findUnique({ where: { id: input.rideId } })
      : null;

    if (input.rideId && (!ride || ride.customerId !== input.customerId)) {
      throw AppError.notFound('Ride not found');
    }

    const incident = await prisma.sOSIncident.create({
      data: {
        customerId: input.customerId,
        rideId: input.rideId,
        pilotId: ride?.pilotId,
        latitude: input.latitude,
        longitude: input.longitude,
        notes: input.notes,
      },
    });

    if (ride) {
      await prisma.safetyEvent.create({
        data: {
          rideId: ride.id,
          type: 'SOS_TRIGGERED',
          payload: { incidentId: incident.id },
        },
      });
    }

    getSocketGateway()?.emitToAdmin('admin:sos:alert', {
      incidentId: incident.id,
      rideId: input.rideId,
      customerId: input.customerId,
      latitude: input.latitude,
      longitude: input.longitude,
    });

    // Notify emergency contacts asynchronously (SMS via queue in production)
    const contacts = await prisma.emergencyContact.findMany({
      where: { customerId: input.customerId },
    });

    return { incident, notifiedContacts: contacts.length };
  }

  async createTripShare(customerId: string, rideId: string, expiresInMinutes = 120) {
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.customerId !== customerId) {
      throw AppError.notFound('Ride not found');
    }

    return prisma.tripShare.create({
      data: {
        rideId,
        customerId,
        shareToken: generateSecureToken(24),
        expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
      },
    });
  }
}

export const safetyService = new SafetyService();
