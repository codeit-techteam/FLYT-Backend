import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../common/errors/AppError';
import type { SendOtpInput, SmsProvider } from './types';

export class Msg91SmsProvider implements SmsProvider {
  readonly name = 'msg91';

  async sendOtp(input: SendOtpInput): Promise<{ messageId: string }> {
    const { MSG91_AUTH_KEY, MSG91_TEMPLATE_ID, MSG91_SENDER_ID } = env();
    if (!MSG91_AUTH_KEY || !MSG91_TEMPLATE_ID) {
      throw AppError.badRequest('MSG91 is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch('https://control.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authkey: MSG91_AUTH_KEY,
        },
        body: JSON.stringify({
          template_id: input.templateId ?? MSG91_TEMPLATE_ID,
          mobile: input.phone.replace(/\D/g, ''),
          sender: MSG91_SENDER_ID || undefined,
          otp: input.otp,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        logger.error({ status: response.status, provider: this.name }, 'MSG91 OTP send failed');
        throw new AppError('Failed to send OTP', 502, 'INTERNAL_ERROR');
      }

      const data = (await response.json()) as { request_id?: string; type?: string };
      return { messageId: data.request_id ?? `msg91-${Date.now()}` };
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendSms(phone: string, message: string): Promise<{ messageId: string }> {
    const { MSG91_AUTH_KEY, MSG91_SENDER_ID } = env();
    if (!MSG91_AUTH_KEY) {
      throw AppError.badRequest('MSG91 is not configured');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const url = new URL('https://control.msg91.com/api/v5/flow/');
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authkey: MSG91_AUTH_KEY,
        },
        body: JSON.stringify({
          sender: MSG91_SENDER_ID,
          short_url: '0',
          recipients: [{ mobiles: phone.replace(/\D/g, ''), message }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AppError('Failed to send SMS', 502, 'INTERNAL_ERROR');
      }

      return { messageId: `msg91-sms-${Date.now()}` };
    } finally {
      clearTimeout(timeout);
    }
  }
}
