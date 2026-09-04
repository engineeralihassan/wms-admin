import { APP_ROUTES } from '../../core/constants/app-routes';

export interface NavItem {
  label: string;
  route: string;
  /** Inline SVG path data (24x24 viewbox) for the icon. */
  icon: string;
  /** If set, the item shows only when the user has ANY of these permissions. */
  permissions?: string[];
  /** If set, the item shows only when the user has one of these roles. */
  roles?: string[];
}

/**
 * Sidebar navigation as data. Each item can declare the permission/role needed to
 * see it; the layout filters the list against the current user. Adding a new
 * feature's menu entry is a one-line change here.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: 'Dashboard',
    route: APP_ROUTES.dashboard,
    icon: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  },
  {
    label: 'Organizations',
    route: APP_ROUTES.organizations,
    roles: ['super_admin'],
    icon: 'M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z',
  },
  {
    label: 'Users',
    route: APP_ROUTES.users,
    permissions: ['user.read'],
    icon: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z',
  },
  {
  label: 'Tickets',
  route: APP_ROUTES.tickets,
  permissions: ['ticket.read'],
  icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2ZM5 19V5h14v14H5Zm2-3h10v-2H7v2Zm0-4h10v-2H7v2Zm0-4h10V6H7v2Z',
  },
  {
    label: 'Expense Management',
    route: APP_ROUTES.expenses,
    permissions: ['expense.read'],
    icon: 'M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1H6.32c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4Z',
  },
  {
    label: 'Projects',
    route: APP_ROUTES.projects,
    permissions: ['project.read'],
    icon: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2Z',
  },
  {
    label: 'Leave Management',
    route: APP_ROUTES.leaves,
    permissions: ['leave.read'],
    icon: 'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2Zm0 16H5V10h14v10Zm0-12H5V6h14v2Zm-9 5h5v5h-5v-5Z',
  },
  {
    label: 'Timesheets',
    route: APP_ROUTES.timesheets,
    permissions: ['timesheet.read'],
    // A clock face — weekly time logging.
    icon: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2ZM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8Zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7Z',
  },
  {
    // ATS — visible only to recruiters and org admins (both hold job.read). Hidden
    // from everyone else, matching the requested "recruiter/org-admin only" access.
    label: 'Jobs & Hiring',
    route: APP_ROUTES.jobs,
    permissions: ['job.read'],
    icon: 'M20 6h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-1.99.9-1.99 2L2 19c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2Zm-6 0h-4V4h4v2Z',
  },
] as const;
