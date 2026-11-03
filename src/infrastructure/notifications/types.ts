export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushProvider {
  readonly name: string;
  sendToToken(token: string, payload: PushPayload): Promise<{ messageId: string }>;
  sendToTokens(tokens: string[], payload: PushPayload): Promise<{ successCount: number }>;
}
