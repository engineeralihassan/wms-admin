/**
 * The Settings sidebar navigation model.
 *
 * This is the single source of truth for what sections appear in the left rail. To add
 * a future section (theme, notifications, ...) you add one entry here and one matching
 * child route in `settings.routes.ts` — the layout renders whatever is in this list, so
 * no template edits are needed.
 */
export interface SettingsNavItem {
  /** Child route segment under /settings (e.g. 'password'). */
  path: string;
  /** Label shown in the sidebar. */
  label: string;
  /** Short helper text under the label. */
  description: string;
  /** Inline SVG path data (24x24 viewBox) for the item icon. */
  iconPath: string;
}

export const SETTINGS_NAV: readonly SettingsNavItem[] = [
  {
    path: 'password',
    label: 'Change password',
    description: 'Update your account password',
    iconPath:
      'M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm3 8H9V6a3 3 0 0 1 6 0v3Zm-3 4a2 2 0 0 1 1 3.73V19a1 1 0 0 1-2 0v-2.27A2 2 0 0 1 12 13Z',
  },
] as const;
