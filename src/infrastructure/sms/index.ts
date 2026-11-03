import { env } from '../../config/env';
import { DevelopmentSmsProvider } from './development.sms';
import { Msg91SmsProvider } from './msg91.sms';
import type { SmsProvider } from './types';

let provider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (!provider) {
    provider = env().OTP_PROVIDER === 'msg91' ? new Msg91SmsProvider() : new DevelopmentSmsProvider();
  }
  return provider;
}

export type { SmsProvider, SendOtpInput } from './types';
