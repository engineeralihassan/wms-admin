/**
 * Shared shape for all environment files.
 * Kept separate so `environment.prod.ts` can import the type without importing
 * the file it replaces during a production build.
 */
export interface AppEnvironment {
  production: boolean;
  /** Base URL of the WMS Node/Express backend. */
  apiBaseUrl: string;
  /** App display name, used in titles and the layout. */
  appName: string;
  /** Toggle verbose console logging. */
  enableDebugLogs: boolean;
}
