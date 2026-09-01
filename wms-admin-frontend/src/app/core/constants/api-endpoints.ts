/**
 * Centralized API endpoint paths (relative to environment.apiBaseUrl).
 * A backend route change is a one-line edit here.
 */
export const API_ENDPOINTS = {
  auth: {
    signIn: '/auth/signIn',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    forgotPassword: '/auth/forgot-password',
    resetPassword: '/auth/reset-password',
    verifyActivation: '/auth/activate/verify',
    activate: '/auth/activate',
    me: '/auth/me',
  },
  organizations: {
    root: '/organizations',
    status: (uuid: string) => `/organizations/${uuid}/status`,
  },
  users: {
    root: '/users',
    byUuid: (uuid: string) => `/users/${uuid}`,
  },
  tickets: {
    root: '/tickets',
    byUuid: (uuid: string) => `/tickets/${uuid}`,
    assignee: (uuid: string) => `/tickets/${uuid}/assignee`,
    assignableUsers: (uuid: string) => `/tickets/${uuid}/assignable-users`,
    status: (uuid: string) => `/tickets/${uuid}/status`,
  },
  expenses: {
    root: '/expenses',
    byUuid: (uuid: string) => `/expenses/${uuid}`,
    submit: (uuid: string) => `/expenses/${uuid}/submit`,
    review: (uuid: string) => `/expenses/${uuid}/review`,
  },
} as const;
