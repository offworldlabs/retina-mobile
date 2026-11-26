import type { ConfigContext, ExpoConfig } from 'expo/config';

// Bundle id and Android package.
const APP_ID = 'retina.fm';

type AppEnv = 'development' | 'preview' | 'production';

const API_BASE_URLS: Record<AppEnv, { ios: string; android: string }> = {
  development: { ios: 'http://localhost:18422', android: 'http://10.0.2.2:18422' },
  preview: { ios: 'https://test-app.retina.fm', android: 'https://test-app.retina.fm' },
  production: { ios: 'https://app.retina.fm', android: 'https://app.retina.fm' },
};

function resolveAppEnv(value: string | undefined): AppEnv {
  const appEnv = value ?? 'development';
  if (appEnv !== 'development' && appEnv !== 'preview' && appEnv !== 'production') {
    throw new Error(`APP_ENV must be one of development, preview, production (got "${appEnv}")`);
  }
  return appEnv;
}

const appEnv = resolveAppEnv(process.env.APP_ENV);
const apiOverride = appEnv === 'development' ? process.env.RETINA_API_URL : undefined;
const apiBaseUrl = apiOverride ? { ios: apiOverride, android: apiOverride } : API_BASE_URLS[appEnv];

function appLinkHost(baseUrl: string): string | undefined {
  const url = new URL(baseUrl);
  return url.protocol === 'https:' ? url.hostname : undefined;
}

const iosLinkHost = apiOverride ? undefined : appLinkHost(apiBaseUrl.ios);
const androidLinkHost = apiOverride ? undefined : appLinkHost(apiBaseUrl.android);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'RETINA',
  slug: 'retina',
  scheme: 'retina',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  icon: './assets/images/icon.png',
  ios: {
    bundleIdentifier: APP_ID,
    icon: './assets/expo.icon',
    ...(iosLinkHost && { associatedDomains: [`applinks:${iosLinkHost}`] }),
  },
  android: {
    package: APP_ID,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    ...(androidLinkHost && {
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            { scheme: 'https', host: androidLinkHost, pathPrefix: '/auth/link' },
            { scheme: 'https', host: androidLinkHost, pathPrefix: '/auth/email' },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    }),
  },
  plugins: [
    'expo-router',
    ['expo-secure-store', { faceIDPermission: false }],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#f1f5f9',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
        dark: { backgroundColor: '#0d1b2a' },
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: { appEnv, apiBaseUrl },
});
