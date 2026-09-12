/**
 * Named route paths for programmatic navigation (refactor-safe vs raw strings).
 */
export const APP_ROUTES = {
  login: '/auth/login',
  forgotPassword: '/auth/forgot-password',
  resetPassword: '/auth/reset-password',
  activate: '/auth/activate',
  dashboard: '/dashboard',
  profile: '/profile',
  users: '/users',
  organizations: '/organizations',
  tickets: '/tickets',
  expenses: '/expenses',
  projects: '/projects',
  leaves: '/leaves',
  timesheets: '/timesheets',
  jobs: '/jobs',
  /** Public careers page (candidate-facing, outside the admin layout). */
  careers: (token: string) => `/careers/${token}`,
} as const;
