import { Routes } from '@angular/router';

/** Leaves feature routes (leave.read only). Lazy-loaded. */
export const LEAVES_ROUTES: Routes = [
  {
    path: '',
    title: 'Leave Management',
    loadComponent: () => import('./leave-list/leave-list').then((m) => m.LeaveList),
  },
];
