import { randomUUID } from 'crypto';
import type { PresignResult, PresignUploadInput, StorageProvider } from './types';
import { env } from '../../config/env';

export class DevelopmentStorageProvider implements StorageProvider {
  readonly name = 'development';

  async createPresignedUpload(input: PresignUploadInput): Promise<PresignResult> {
    const expiresAt = new Date(Date.now() + (input.expiresInSeconds ?? 900) * 1000);
    return {
      uploadUrl: `${env().API_BASE_URL}/api/v1/dev/upload/${encodeURIComponent(input.key)}?token=${randomUUID()}`,
      key: input.key,
      expiresAt,
    };
  }

  async createPresignedDownload(key: string, expiresInSeconds = 900): Promise<string> {
    return `${env().API_BASE_URL}/api/v1/dev/download/${encodeURIComponent(key)}?exp=${Date.now() + expiresInSeconds * 1000}`;
  }

  async deleteObject(_key: string): Promise<void> {
    // no-op in development
  }
}
