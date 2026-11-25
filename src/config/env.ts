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

/**
 * `extra.cartoApiKey` from app.config.ts, or '' when the build has none. The key is
 * in the bundle on purpose: basemap tiles are fetched by the device, as the web map
 * fetches them from the browser with its key in the page, so only a key scoped to
 * CARTO basemap tiles may be set. Never log it.
 */
export function resolveCartoApiKey(extra: unknown): string {
  const value = isRecord(extra) ? extra.cartoApiKey : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

const extra: unknown = Constants.expoConfig?.extra;

export const appEnv: AppEnv = resolveAppEnv(extra);
export const apiBaseUrl: string = resolveApiBaseUrl(extra, Platform.OS);
export const cartoApiKey: string = resolveCartoApiKey(extra);
