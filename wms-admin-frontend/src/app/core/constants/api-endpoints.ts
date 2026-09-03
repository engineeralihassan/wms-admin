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
    vendors: '/users/vendors',
    byUuid: (uuid: string) => `/users/${uuid}`,
    profile: (uuid: string) => `/users/${uuid}/profile`,
    documents: (uuid: string) => `/users/${uuid}/documents`,
    resendInvite: (uuid: string) => `/users/${uuid}/resend-invite`,
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
    attachments: (uuid: string) => `/expenses/${uuid}/attachments`,
    attachment: (uuid: string, attachmentUuid: string) =>
      `/expenses/${uuid}/attachments/${attachmentUuid}`,
  },
  files: {
    root: '/files',
    byOwner: (ownerType: string, ownerId: number | string) => `/files/${ownerType}/${ownerId}`,
    byUuid: (uuid: string) => `/files/${uuid}`,
    limits: '/files/limits',
  },
  projects: {
    root: '/projects',
    mine: '/projects/mine',
    byUuid: (uuid: string) => `/projects/${uuid}`,
    members: (uuid: string) => `/projects/${uuid}/members`,
    member: (uuid: string, userUuid: string) => `/projects/${uuid}/members/${userUuid}`,
    assignableUsers: (uuid: string) => `/projects/${uuid}/assignable-users`,
  },
  leaves: {
    root: '/leaves',
    byUuid: (uuid: string) => `/leaves/${uuid}`,
    submit: (uuid: string) => `/leaves/${uuid}/submit`,
    withdraw: (uuid: string) => `/leaves/${uuid}/withdraw`,
    decision: (uuid: string) => `/leaves/${uuid}/decision`,
    cancel: (uuid: string) => `/leaves/${uuid}/cancel`,
    myBalances: '/leaves/balances/me',
    calendar: '/leaves/calendar',
    types: '/leaves/types',
    typeByUuid: (uuid: string) => `/leaves/types/${uuid}`,
    balances: '/leaves/balances',
  },
  jobs: {
    root: '/jobs',
    byUuid: (uuid: string) => `/jobs/${uuid}`,
    status: (uuid: string) => `/jobs/${uuid}/status`,
    applications: (uuid: string) => `/jobs/${uuid}/applications`,
    rankedApplications: (uuid: string) => `/jobs/${uuid}/applications/ranked`,
  },
  applications: {
    byUuid: (uuid: string) => `/applications/${uuid}`,
    status: (uuid: string) => `/applications/${uuid}/status`,
    rating: (uuid: string) => `/applications/${uuid}/rating`,
    notes: (uuid: string) => `/applications/${uuid}/notes`,
  },
  careers: {
    byToken: (token: string) => `/careers/${token}`,
    apply: (token: string) => `/careers/${token}/apply`,
  },
  dashboard: {
    me: '/dashboard/me',
    charts: {
      leaves: '/dashboard/charts/leaves',
      tickets: '/dashboard/charts/tickets',
      expenses: '/dashboard/charts/expenses',
      projects: '/dashboard/charts/projects',
      users: '/dashboard/charts/users',
      organizations: '/dashboard/charts/organizations',
    },
    summary: '/dashboard/summary',
    recentProjects: '/dashboard/recent-projects',
    recentTickets: '/dashboard/recent-tickets',
  },
} as const;
