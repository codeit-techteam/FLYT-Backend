import { randomUUID } from 'crypto';
import { createSign } from 'crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError } from '../../common/errors/AppError';
import type { PushPayload, PushProvider } from './types';

/**
 * Firebase HTTP v1 push adapter.
 * Requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
 */
export class FirebasePushProvider implements PushProvider {
  readonly name = 'firebase';
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  async sendToToken(token: string, payload: PushPayload): Promise<{ messageId: string }> {
    const accessToken = await this.getAccessToken();
    const projectId = env().FIREBASE_PROJECT_ID;

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: payload.title, body: payload.body },
            data: payload.data,
          },
        }),
      },
    );

    if (!response.ok) {
      logger.error({ status: response.status }, 'FCM send failed');
      throw new AppError('Push notification failed', 502, 'INTERNAL_ERROR');
    }

    const data = (await response.json()) as { name?: string };
    return { messageId: data.name ?? randomUUID() };
  }

  async sendToTokens(tokens: string[], payload: PushPayload): Promise<{ successCount: number }> {
    let successCount = 0;
    for (const token of tokens) {
      try {
        await this.sendToToken(token, payload);
        successCount += 1;
      } catch {
        // continue
      }
    }
    return { successCount };
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const { FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_PROJECT_ID } = env();
    if (!FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY || !FIREBASE_PROJECT_ID) {
      throw AppError.badRequest('Firebase is not configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claim = Buffer.from(
      JSON.stringify({
        iss: FIREBASE_CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    ).toString('base64url');

    const unsigned = `${header}.${claim}`;
    const key = FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    const signature = signer.sign(key, 'base64url');
    const assertion = `${unsigned}.${signature}`;

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    if (!tokenResponse.ok) {
      throw new AppError('Failed to obtain Firebase access token', 502, 'INTERNAL_ERROR');
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = tokenData.access_token;
    this.tokenExpiresAt = Date.now() + tokenData.expires_in * 1000;
    return this.accessToken;
  }
}
