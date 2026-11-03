export interface CreateOrderInput {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface CreateOrderResult {
  orderId: string;
  amountPaise: number;
  currency: string;
  provider: string;
}

export interface VerifyPaymentInput {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface RefundInput {
  paymentId: string;
  amountPaise: number;
  notes?: Record<string, string>;
}

export interface PaymentProvider {
  readonly name: string;
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  verifyPayment(input: VerifyPaymentInput): boolean;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
  refund(input: RefundInput): Promise<{ refundId: string }>;
}
