/**
 * Keys used for browser storage. The refresh token is intentionally absent —
 * it lives in an httpOnly cookie managed by the browser, never in JS-readable storage.
 */
export const STORAGE_KEYS = {
  accessToken: 'wms_access_token',
  user: 'wms_user',
} as const;
