import { env } from '../../config/env';
import { DevelopmentPaymentProvider } from './development.payments';
import { RazorpayPaymentProvider } from './razorpay.payments';
import type { PaymentProvider } from './types';

let provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    provider =
      env().PAYMENT_PROVIDER === 'razorpay'
        ? new RazorpayPaymentProvider()
        : new DevelopmentPaymentProvider();
  }
  return provider;
}

export type {
  PaymentProvider,
  CreateOrderInput,
  CreateOrderResult,
  VerifyPaymentInput,
  RefundInput,
} from './types';
