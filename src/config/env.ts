import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type AppEnv = 'development' | 'preview' | 'production';

const APP_ENVS: readonly string[] = ['development', 'preview', 'production'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `extra.appEnv` from app.config.ts. */
export function resolveAppEnv(extra: unknown): AppEnv {
  const value = isRecord(extra) ? extra.appEnv : undefined;
  if (typeof value !== 'string' || !APP_ENVS.includes(value)) {
    throw new Error(`App config extra.appEnv must be one of ${APP_ENVS.join(', ')}`);
  }
  return value as AppEnv;
}

/** The API base URL app.config.ts set for this platform, without a trailing slash. */
export function resolveApiBaseUrl(extra: unknown, platform: string): string {
  if (!isRecord(extra)) throw new Error('App config extra is missing');
  const urls = extra.apiBaseUrl;
  if (!isRecord(urls)) throw new Error('App config extra.apiBaseUrl is missing');
  const url = urls[platform];
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error(`App config extra.apiBaseUrl.${platform} is missing`);
  }
  return url.trim().replace(/\/+$/, '');
}

const extra: unknown = Constants.expoConfig?.extra;

export const appEnv: AppEnv = resolveAppEnv(extra);
export const apiBaseUrl: string = resolveApiBaseUrl(extra, Platform.OS);
