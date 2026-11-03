import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../common/errors/AppError';
import type {
  CreateOrderInput,
  CreateOrderResult,
  PaymentProvider,
  RefundInput,
  VerifyPaymentInput,
} from './types';

export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = 'razorpay';

  private get credentials(): { keyId: string; keySecret: string; webhookSecret: string } {
    const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = env();
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      throw AppError.badRequest('Razorpay is not configured');
    }
    return {
      keyId: RAZORPAY_KEY_ID,
      keySecret: RAZORPAY_KEY_SECRET,
      webhookSecret: RAZORPAY_WEBHOOK_SECRET || RAZORPAY_KEY_SECRET,
    };
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const { keyId, keySecret } = this.credentials;
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: input.currency,
          receipt: input.receipt,
          notes: input.notes,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Razorpay order creation failed');
        throw new AppError('Payment order creation failed', 502, 'PAYMENT_FAILED');
      }

      const data = (await response.json()) as { id: string; amount: number; currency: string };
      return {
        orderId: data.id,
        amountPaise: data.amount,
        currency: data.currency,
        provider: this.name,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  verifyPayment(input: VerifyPaymentInput): boolean {
    const { keySecret } = this.credentials;
    const expected = createHmac('sha256', keySecret)
      .update(`${input.orderId}|${input.paymentId}`)
      .digest('hex');
    return safeEqual(expected, input.signature);
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const { webhookSecret } = this.credentials;
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    return safeEqual(expected, signature);
  }

  async refund(input: RefundInput): Promise<{ refundId: string }> {
    const { keyId, keySecret } = this.credentials;
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    const response = await fetch(`https://api.razorpay.com/v1/payments/${input.paymentId}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: input.amountPaise, notes: input.notes }),
    });

    if (!response.ok) {
      throw new AppError('Refund failed', 502, 'PAYMENT_FAILED');
    }

    const data = (await response.json()) as { id: string };
    return { refundId: data.id };
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
