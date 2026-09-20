import { Routes } from '@angular/router';

/**
 * Account Settings routes.
 *
 * A shell layout (left sidebar + outlet) wraps one child route per section. Entering
 * /settings redirects to the first section (Change password), so it's selected by
 * default. Add future sections (theme, notifications, ...) as sibling children here
 * plus an entry in SETTINGS_NAV — no other wiring needed.
 *
 * No permission guard: any authenticated user may manage their OWN account settings
 * (served from the /auth/me/* endpoints).
 */
export const SETTINGS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./settings-layout/settings-layout.component').then(
        (m) => m.SettingsLayoutComponent,
      ),
    children: [
      { path: '', redirectTo: 'password', pathMatch: 'full' },
      {
        path: 'password',
        title: 'Change Password',
        loadComponent: () =>
          import('./change-password/change-password.component').then(
            (m) => m.ChangePasswordComponent,
          ),
      },
      // Future: { path: 'appearance', ... }, { path: 'notifications', ... }
    ],
  },
];
