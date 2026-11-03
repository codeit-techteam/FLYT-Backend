import { createHmac, randomUUID } from 'crypto';
import type {
  CreateOrderInput,
  CreateOrderResult,
  PaymentProvider,
  RefundInput,
  VerifyPaymentInput,
} from './types';

export class DevelopmentPaymentProvider implements PaymentProvider {
  readonly name = 'development';
  private readonly secret = 'dev_webhook_secret';

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    return {
      orderId: `order_dev_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      amountPaise: input.amountPaise,
      currency: input.currency,
      provider: this.name,
    };
  }

  verifyPayment(input: VerifyPaymentInput): boolean {
    const expected = createHmac('sha256', this.secret)
      .update(`${input.orderId}|${input.paymentId}`)
      .digest('hex');
    return expected === input.signature || input.signature === 'dev_valid_signature';
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const expected = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    return expected === signature || signature === 'dev_valid_signature';
  }

  async refund(_input: RefundInput): Promise<{ refundId: string }> {
    return { refundId: `rfnd_dev_${randomUUID().replace(/-/g, '').slice(0, 10)}` };
  }
}
