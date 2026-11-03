import { randomUUID } from 'crypto';
import { logger } from '../../config/logger';
import type { SendOtpInput, SmsProvider } from './types';

/**
 * Development OTP provider — never logs the OTP value.
 * OTP is returned only through the auth API response in development mode.
 */
export class DevelopmentSmsProvider implements SmsProvider {
  readonly name = 'development';

  async sendOtp(input: SendOtpInput): Promise<{ messageId: string }> {
    const messageId = `dev-otp-${randomUUID()}`;
    logger.info(
      { phone: maskPhone(input.phone), messageId, provider: this.name },
      'Development OTP dispatched (value not logged)',
    );
    return { messageId };
  }

  async sendSms(phone: string, _message: string): Promise<{ messageId: string }> {
    const messageId = `dev-sms-${randomUUID()}`;
    logger.info({ phone: maskPhone(phone), messageId }, 'Development SMS dispatched');
    return { messageId };
  }
}

function maskPhone(phone: string): string {
  if (phone.length < 4) return '****';
  return `${phone.slice(0, 2)}****${phone.slice(-2)}`;
}
