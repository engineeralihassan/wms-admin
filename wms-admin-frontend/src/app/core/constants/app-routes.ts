/**
 * Named route paths for programmatic navigation (refactor-safe vs raw strings).
 */
export const APP_ROUTES = {
  login: '/auth/login',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
  dashboard: '/dashboard',
  users: '/users',
  organizations: '/organizations',
} as const;
