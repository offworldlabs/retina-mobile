const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    files: ['**/__tests__/**/*.{ts,tsx,js}', '**/*.test.{ts,tsx,js}'],
    languageOptions: { globals: globals.jest },
  },
  {
    ignores: [
      'android/',
      'ios/',
      '.expo/',
      'dist/',
      'node_modules/',
      'openapi/',
      'src/api/schema.gen.ts',
    ],
  },
]);
