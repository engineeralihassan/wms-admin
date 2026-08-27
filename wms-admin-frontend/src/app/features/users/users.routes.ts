import { Routes } from '@angular/router';

/**
 * Users feature routes: list at the root, detail as a `:uuid` sub-route.
 * This is the reference structure to copy for future CRUD features.
 * Lazy-loaded into the authenticated admin shell.
 */
export const USERS_ROUTES: Routes = [
  {
    path: '',
    title: 'Users',
    loadComponent: () =>
      import('./user-list/user-list.component').then((m) => m.UserListComponent),
  },
  {
    path: ':uuid',
    title: 'User details',
    loadComponent: () =>
      import('./user-detail/user-detail.component').then((m) => m.UserDetailComponent),
  },
];
