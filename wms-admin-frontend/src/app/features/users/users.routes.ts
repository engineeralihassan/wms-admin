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
    loadComponent: () =>
      import('./user-form/user-form.component').then((m) => m.UserFormComponent),
  },
  {
    path: ':uuid',
    title: 'User details',
    loadComponent: () =>
      import('./user-detail/user-detail.component').then((m) => m.UserDetailComponent),
  },
];
