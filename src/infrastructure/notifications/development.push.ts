import { randomUUID } from 'crypto';
import { logger } from '../../config/logger';
import type { PushPayload, PushProvider } from './types';

export class DevelopmentPushProvider implements PushProvider {
  readonly name = 'development';

  async sendToToken(token: string, payload: PushPayload): Promise<{ messageId: string }> {
    const messageId = `dev-push-${randomUUID()}`;
    logger.info(
      { tokenPrefix: token.slice(0, 8), title: payload.title, messageId },
      'Development push dispatched',
    );
    return { messageId };
  }

  async sendToTokens(tokens: string[], payload: PushPayload): Promise<{ successCount: number }> {
    await Promise.all(tokens.map((t) => this.sendToToken(t, payload)));
    return { successCount: tokens.length };
  }
}
