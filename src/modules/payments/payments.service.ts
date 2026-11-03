import { PaymentMethod, PaymentStatus, RideStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../common/errors/AppError';
import { getPaymentProvider } from '../../infrastructure/payments';
import { commissionsService } from '../commissions/commissions.service';
import { ledgerService } from './ledger.service';
import { getSocketGateway } from '../../config/socket';
import { enqueueWebhookProcessing } from '../../infrastructure/queues/payment.queue';

export class PaymentsService {
  async createOrder(input: {
    rideId: string;
    customerId: string;
    idempotencyKey?: string;
  }) {
    if (input.idempotencyKey) {
      const existing = await prisma.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return existing;
      }
    }

    const ride = await prisma.ride.findUnique({ where: { id: input.rideId } });
    if (!ride || ride.customerId !== input.customerId) {
      throw AppError.notFound('Ride not found');
    }

    if (
      ride.status !== RideStatus.PAYMENT_PENDING &&
      ride.status !== RideStatus.COMPLETED &&
      ride.status !== RideStatus.PAID
    ) {
      throw AppError.conflict('Ride is not ready for payment');
    }

    const amount = Number(ride.finalFare ?? ride.estimatedFare);
    const amountPaise = Math.round(amount * 100);
    const provider = getPaymentProvider();

    const order = await provider.createOrder({
      amountPaise,
      currency: ride.currency,
      receipt: ride.rideNumber,
      notes: { rideId: ride.id, customerId: input.customerId },
    });

    const payment = await prisma.payment.upsert({
      where: { rideId: ride.id },
      create: {
        rideId: ride.id,
        customerId: input.customerId,
        method: PaymentMethod.RAZORPAY,
        status: PaymentStatus.CREATED,
        amount,
        currency: ride.currency,
        providerOrderId: order.orderId,
        idempotencyKey: input.idempotencyKey,
      },
      update: {
        status: PaymentStatus.CREATED,
        providerOrderId: order.orderId,
        amount,
      },
    });

    return {
      paymentId: payment.id,
      orderId: order.orderId,
      amount,
      amountPaise,
      currency: ride.currency,
      provider: order.provider,
    };
  }

  async verifyPayment(input: {
    paymentId: string;
    orderId: string;
    providerPaymentId: string;
    signature: string;
    customerId: string;
  }) {
    const payment = await prisma.payment.findUnique({
      where: { id: input.paymentId },
      include: { ride: true },
    });

    if (!payment || payment.customerId !== input.customerId) {
      throw AppError.notFound('Payment not found');
    }

    const provider = getPaymentProvider();
    const valid = provider.verifyPayment({
      orderId: input.orderId,
      paymentId: input.providerPaymentId,
      signature: input.signature,
    });

    if (!valid) {
      throw new AppError('Payment signature verification failed', 400, 'PAYMENT_FAILED');
    }

    return this.markCaptured(payment.id, input.providerPaymentId, input.signature);
  }

  async markCaptured(paymentId: string, providerPaymentId: string, signature?: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { ride: true },
    });
    if (!payment) throw AppError.notFound('Payment not found');

    if (payment.status === PaymentStatus.CAPTURED) {
      return payment;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.CAPTURED,
          providerPaymentId,
          providerSignature: signature,
          paidAt: new Date(),
        },
      });

      await tx.ride.update({
        where: { id: payment.rideId },
        data: { status: RideStatus.PAID },
      });

      await tx.rideEvent.create({
        data: {
          rideId: payment.rideId,
          type: 'PAYMENT_CAPTURED',
          actorType: 'system',
          payload: { paymentId, providerPaymentId },
        },
      });

      return p;
    });

    const commission = await commissionsService.calculateForRide(payment.rideId);
    await ledgerService.recordOnlinePayment({
      rideId: payment.rideId,
      paymentId: payment.id,
      amount: Number(payment.amount),
      commissionAmount: Number(commission.commissionAmount),
      pilotPayable: Number(commission.pilotPayable),
    });

    getSocketGateway()?.emitToCustomer(payment.customerId, 'customer:payment:updated', {
      paymentId: payment.id,
      rideId: payment.rideId,
      status: PaymentStatus.CAPTURED,
    });

    return updated;
  }

  async handleRazorpayWebhook(rawBody: string, signature: string) {
    const provider = getPaymentProvider();
    if (!provider.verifyWebhookSignature(rawBody, signature)) {
      throw AppError.unauthorized('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody) as {
      event: string;
      payload?: {
        payment?: { entity?: { id: string; order_id: string; status: string } };
      };
      id?: string;
    };

    const eventId = payload.id ?? `${payload.event}:${payload.payload?.payment?.entity?.id ?? Date.now()}`;

    const existing = await prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider: 'razorpay', eventId } },
    });
    if (existing?.processedAt) {
      return { duplicate: true };
    }

    await prisma.webhookEvent.upsert({
      where: { provider_eventId: { provider: 'razorpay', eventId } },
      create: {
        provider: 'razorpay',
        eventId,
        eventType: payload.event,
        payload: payload as object,
      },
      update: {},
    });

    await enqueueWebhookProcessing(eventId);
    return { accepted: true };
  }

  async processWebhookEvent(eventId: string): Promise<void> {
    const event = await prisma.webhookEvent.findUnique({
      where: { provider_eventId: { provider: 'razorpay', eventId } },
    });
    if (!event || event.processedAt) return;

    const payload = event.payload as {
      event: string;
      payload?: { payment?: { entity?: { id: string; order_id: string; status: string } } };
    };

    if (payload.event === 'payment.captured') {
      const entity = payload.payload?.payment?.entity;
      if (entity?.order_id) {
        const payment = await prisma.payment.findUnique({
          where: { providerOrderId: entity.order_id },
        });
        if (payment) {
          await this.markCaptured(payment.id, entity.id);
        }
      }
    }

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
  }

  async getPayment(paymentId: string, customerId?: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { refunds: true },
    });
    if (!payment) throw AppError.notFound('Payment not found');
    if (customerId && payment.customerId !== customerId) throw AppError.forbidden();
    return payment;
  }
}

export const paymentsService = new PaymentsService();
