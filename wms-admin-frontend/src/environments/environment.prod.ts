import type { AppEnvironment } from './environment.type';

/**
 * Production environment configuration.
 * Angular replaces `environment.ts` with this file during a production build.
 */
export const environment: AppEnvironment = {
  production: true,
  apiBaseUrl: '/api/v1',
  appName: 'WMS Admin',
  enableDebugLogs: false,
};
