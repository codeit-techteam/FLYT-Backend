import { env } from '../../config/env';
import { DevelopmentPushProvider } from './development.push';
import { FirebasePushProvider } from './firebase.push';
import type { PushProvider } from './types';

let provider: PushProvider | null = null;

export function getPushProvider(): PushProvider {
  if (!provider) {
    provider =
      env().PUSH_PROVIDER === 'firebase'
        ? new FirebasePushProvider()
        : new DevelopmentPushProvider();
  }
  return provider;
}

export type { PushProvider, PushPayload } from './types';
