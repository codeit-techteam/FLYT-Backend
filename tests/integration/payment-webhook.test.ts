import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import { DevelopmentPaymentProvider } from '../../src/infrastructure/payments/development.payments';

describe('Payment webhook signature verification', () => {
  const provider = new DevelopmentPaymentProvider();

  it('accepts valid HMAC signatures', () => {
    const body = JSON.stringify({ event: 'payment.captured', id: 'evt_1' });
    const signature = createHmac('sha256', 'dev_webhook_secret').update(body).digest('hex');
    expect(provider.verifyWebhookSignature(body, signature)).toBe(true);
  });

  it('rejects invalid signatures', () => {
    const body = JSON.stringify({ event: 'payment.captured', id: 'evt_2' });
    expect(provider.verifyWebhookSignature(body, 'bad-signature')).toBe(false);
  });

  it('verifies payment signatures', () => {
    const orderId = 'order_dev_abc';
    const paymentId = 'pay_dev_xyz';
    const signature = createHmac('sha256', 'dev_webhook_secret')
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    expect(provider.verifyPayment({ orderId, paymentId, signature })).toBe(true);
  });
});
