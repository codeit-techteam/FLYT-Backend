import { env } from '../../config/env';
import { DevelopmentStorageProvider } from './development.storage';
import { R2StorageProvider } from './r2.storage';
import type { StorageProvider } from './types';

let provider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!provider) {
    provider =
      env().STORAGE_PROVIDER === 'r2' ? new R2StorageProvider() : new DevelopmentStorageProvider();
  }
  return provider;
}

export type { StorageProvider, PresignUploadInput, PresignResult } from './types';
