import type { AppEnvironment } from './environment.type';

/**
 * Development environment configuration (DEFAULT).
 *
 * The production build replaces this file with `environment.prod.ts` via the
 * `fileReplacements` config in angular.json. Keep ALL environment-specific values
 * here so the codebase never hardcodes them.
 */
export const environment: AppEnvironment = {
  production: false,
  apiBaseUrl: 'http://localhost:8080/api/v1',
  appName: 'WMS Admin',
  enableDebugLogs: true,
};
