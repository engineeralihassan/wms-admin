import { Routes } from '@angular/router';

/**
 * Self-service profile route. No permission guard — any authenticated user may view
 * and complete their OWN profile (the backend serves it from /auth/me/*). Lazy-loaded
 * into the authenticated admin shell.
 */
export const PROFILE_ROUTES: Routes = [
  {
    path: '',
    title: 'My Profile',
    loadComponent: () => import('./profile.component').then((m) => m.ProfileComponent),
  },
];
