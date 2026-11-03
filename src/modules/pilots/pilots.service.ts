import { AvailabilityStatus, Gender } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../common/errors/AppError';
import { locationsService } from '../locations/locations.service';
import { getSocketGateway } from '../../config/socket';

export class PilotsService {
  async getMe(pilotId: string) {
    const pilot = await prisma.pilot.findUnique({
      where: { id: pilotId },
      include: {
        user: { select: { phone: true, email: true, status: true } },
        availability: true,
        verification: true,
        vehicles: true,
        documents: { select: { id: true, type: true, status: true, expiresAt: true } },
      },
    });
    if (!pilot) throw AppError.notFound('Pilot not found');
    return pilot;
  }

  async updateMe(
    pilotId: string,
    input: {
      firstName?: string;
      lastName?: string;
      gender?: Gender;
      city?: string;
    },
  ) {
    await prisma.pilot.update({
      where: { id: pilotId },
      data: input,
    });
    return this.getMe(pilotId);
  }

  async goOnline(pilotId: string) {
    const pilot = await prisma.pilot.findUnique({
      where: { id: pilotId },
      include: { verification: true, vehicles: { where: { status: 'ACTIVE' } } },
    });
    if (!pilot) throw AppError.notFound('Pilot not found');
    if (pilot.status !== 'ACTIVE') {
      throw AppError.forbidden('Pilot account is not active');
    }
    if (!pilot.vehicles.length) {
      throw AppError.badRequest('Active vehicle required to go online');
    }

    await prisma.pilotAvailability.upsert({
      where: { pilotId },
      create: {
        pilotId,
        status: AvailabilityStatus.ONLINE,
        lastOnlineAt: new Date(),
      },
      update: {
        status: AvailabilityStatus.ONLINE,
        lastOnlineAt: new Date(),
      },
    });

    getSocketGateway()?.emitToAdmin('admin:pilot:location', {
      pilotId,
      status: AvailabilityStatus.ONLINE,
    });

    return { status: AvailabilityStatus.ONLINE };
  }

  async goOffline(pilotId: string) {
    const activeRide = await prisma.ride.findFirst({
      where: {
        pilotId,
        status: { in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] },
      },
    });
    if (activeRide) {
      throw AppError.conflict('Cannot go offline during an active ride');
    }

    await prisma.pilotAvailability.upsert({
      where: { pilotId },
      create: {
        pilotId,
        status: AvailabilityStatus.OFFLINE,
        lastOfflineAt: new Date(),
      },
      update: {
        status: AvailabilityStatus.OFFLINE,
        lastOfflineAt: new Date(),
      },
    });

    return { status: AvailabilityStatus.OFFLINE };
  }

  async updateLocation(
    pilotId: string,
    input: {
      latitude: number;
      longitude: number;
      heading?: number;
      speedMps?: number;
      accuracyM?: number;
    },
  ) {
    await locationsService.updatePilotLocation({ pilotId, ...input });

    // Broadcast to assigned customer if on active ride
    const ride = await prisma.ride.findFirst({
      where: {
        pilotId,
        status: { in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] },
      },
    });

    if (ride) {
      getSocketGateway()?.emitToCustomer(ride.customerId, 'customer:pilot:location', {
        rideId: ride.id,
        latitude: input.latitude,
        longitude: input.longitude,
        heading: input.heading,
      });
      await prisma.rideTracking.create({
        data: {
          rideId: ride.id,
          latitude: input.latitude,
          longitude: input.longitude,
          heading: input.heading,
          speedMps: input.speedMps,
          recordedAt: new Date(),
        },
      });
    }

    getSocketGateway()?.emitToAdmin('admin:pilot:location', {
      pilotId,
      latitude: input.latitude,
      longitude: input.longitude,
    });

    return { updated: true };
  }

  async listOffers(pilotId: string) {
    return prisma.rideOffer.findMany({
      where: { pilotId, status: 'PENDING', expiresAt: { gt: new Date() } },
      include: {
        ride: {
          select: {
            id: true,
            rideNumber: true,
            pickupLat: true,
            pickupLng: true,
            dropLat: true,
            dropLng: true,
            pickupAddress: true,
            dropAddress: true,
            estimatedFare: true,
            mode: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const pilotsService = new PilotsService();
