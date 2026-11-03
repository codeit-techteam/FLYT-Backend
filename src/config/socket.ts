import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { UserType } from '@prisma/client';
import { env, corsOrigins } from './env';
import { logger } from './logger';
import { getRedisPubSub } from './redis';
import { verifyAccessToken } from '../modules/auth/token.service';
import { prisma } from './database';
import { AppError } from '../common/errors/AppError';

export type SocketEvents =
  | 'customer:ride:created'
  | 'customer:ride:status'
  | 'customer:pilot:assigned'
  | 'customer:pilot:location'
  | 'customer:ride:cancelled'
  | 'customer:trip:completed'
  | 'customer:payment:updated'
  | 'pilot:ride:offer'
  | 'pilot:ride:accepted'
  | 'pilot:ride:rejected'
  | 'pilot:ride:cancelled'
  | 'pilot:trip:started'
  | 'pilot:trip:completed'
  | 'admin:ride:update'
  | 'admin:pilot:location'
  | 'admin:dispatch:update'
  | 'admin:sos:alert';

interface AuthedSocket extends Socket {
  data: {
    userId: string;
    userType: UserType;
    customerId?: string;
    pilotId?: string;
    adminId?: string;
  };
}

export class SocketGateway {
  private io: Server;

  constructor(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: corsOrigins(),
        credentials: true,
      },
      pingInterval: env().SOCKET_PING_INTERVAL,
      pingTimeout: env().SOCKET_PING_TIMEOUT,
    });

    const { pub, sub } = getRedisPubSub();
    this.io.adapter(createAdapter(pub, sub));

    this.io.use(async (socket, next) => {
      try {
        const token =
          (socket.handshake.auth?.token as string | undefined) ??
          (socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '') as
            | string
            | undefined);

        if (!token) {
          next(new Error('Unauthorized'));
          return;
        }

        const payload = verifyAccessToken(token);
        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          include: { customer: true, pilot: true, admin: true },
        });

        if (!user || user.status !== 'ACTIVE') {
          next(new Error('Unauthorized'));
          return;
        }

        (socket as AuthedSocket).data = {
          userId: user.id,
          userType: user.userType,
          customerId: user.customer?.id,
          pilotId: user.pilot?.id,
          adminId: user.admin?.id,
        };

        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });

    this.io.on('connection', (socket) => this.onConnection(socket as AuthedSocket));
    logger.info('Socket.IO server initialized with Redis adapter');
  }

  private onConnection(socket: AuthedSocket): void {
    const { userId, userType, customerId, pilotId, adminId } = socket.data;
    logger.info({ userId, userType, socketId: socket.id }, 'Socket connected');

    socket.join(`user:${userId}`);
    if (customerId) socket.join(`customer:${customerId}`);
    if (pilotId) socket.join(`pilot:${pilotId}`);
    if (adminId || userType === UserType.ADMIN) socket.join('admin');

    socket.on('customer:connect', () => {
      if (customerId) socket.join(`customer:${customerId}`);
      socket.emit('customer:connected', { customerId });
    });

    socket.on('pilot:online', async (ack?: (res: unknown) => void) => {
      if (!pilotId) {
        ack?.({ ok: false, error: 'Not a pilot' });
        return;
      }
      socket.join(`pilot:${pilotId}`);
      ack?.({ ok: true });
    });

    socket.on('pilot:offline', (ack?: (res: unknown) => void) => {
      if (pilotId) socket.leave(`pilot:${pilotId}`);
      ack?.({ ok: true });
    });

    socket.on(
      'join:ride',
      async (payload: { rideId: string }, ack?: (res: unknown) => void) => {
        try {
          await this.authorizeRideRoom(socket, payload.rideId);
          socket.join(`ride:${payload.rideId}`);
          ack?.({ ok: true });
        } catch (error) {
          ack?.({
            ok: false,
            error: error instanceof AppError ? error.message : 'Forbidden',
          });
        }
      },
    );

    socket.on('disconnect', (reason) => {
      logger.info({ userId, reason }, 'Socket disconnected');
    });
  }

  private async authorizeRideRoom(socket: AuthedSocket, rideId: string): Promise<void> {
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw AppError.notFound('Ride not found');

    const { userType, customerId, pilotId } = socket.data;
    if (userType === UserType.ADMIN) return;
    if (userType === UserType.CUSTOMER && ride.customerId === customerId) return;
    if (userType === UserType.PILOT && ride.pilotId === pilotId) return;
    throw AppError.forbidden('Cannot subscribe to this ride');
  }

  emitToCustomer(customerId: string, event: SocketEvents, data: unknown): void {
    this.io.to(`customer:${customerId}`).emit(event, data);
  }

  emitToPilot(pilotId: string, event: SocketEvents, data: unknown): void {
    this.io.to(`pilot:${pilotId}`).emit(event, data);
  }

  emitToAdmin(event: SocketEvents, data: unknown): void {
    this.io.to('admin').emit(event, data);
  }

  emitToRide(rideId: string, event: SocketEvents, data: unknown): void {
    this.io.to(`ride:${rideId}`).emit(event, data);
  }

  async close(): Promise<void> {
    await this.io.close();
  }
}

let gateway: SocketGateway | null = null;

export function initSocketGateway(httpServer: HttpServer): SocketGateway {
  gateway = new SocketGateway(httpServer);
  return gateway;
}

export function getSocketGateway(): SocketGateway | null {
  return gateway;
}
