import { Routes } from '@angular/router';

/**
 * Users feature routes: list at the root, a create form at `new`, and a detail +
 * edit form under `:uuid`. `new` is declared before `:uuid` so it isn't captured as
 * a uuid param. Lazy-loaded into the authenticated admin shell.
 */
export const USERS_ROUTES: Routes = [
  {
    path: '',
    title: 'Users',
    loadComponent: () =>
      import('./user-list/user-list.component').then((m) => m.UserListComponent),
  },
  {
    path: 'new',
    title: 'New user',
    loadComponent: () =>
      import('./user-form/user-form.component').then((m) => m.UserFormComponent),
  },
  {
    path: ':uuid/edit',
    title: 'Edit user',
    data: { mode: 'edit' },
    loadComponent: () =>
      import('./user-form/user-form.component').then((m) => m.UserFormComponent),
  },
  {
    // View = the same tabbed form as edit, but read-only + admin verification actions.
    path: ':uuid',
    title: 'User profile',
    data: { mode: 'view' },
    loadComponent: () =>
      import('./user-form/user-form.component').then((m) => m.UserFormComponent),
  },
];
