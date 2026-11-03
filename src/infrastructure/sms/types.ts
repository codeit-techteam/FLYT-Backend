export interface SendOtpInput {
  phone: string;
  otp: string;
  templateId?: string;
}

export interface SmsProvider {
  readonly name: string;
  sendOtp(input: SendOtpInput): Promise<{ messageId: string }>;
  sendSms(phone: string, message: string): Promise<{ messageId: string }>;
}
