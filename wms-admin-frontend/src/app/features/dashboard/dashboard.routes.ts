import { Routes } from '@angular/router';

/** Dashboard feature routes. Lazy-loaded into the authenticated admin shell. */
export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    title: 'Dashboard',
    loadComponent: () =>
      import('./dashboard.component').then((m) => m.DashboardComponent),
  },
];
