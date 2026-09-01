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
  }

] as const;
