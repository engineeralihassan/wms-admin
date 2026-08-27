import { Routes } from '@angular/router';

/** Organizations feature routes (super_admin only). Lazy-loaded. */
export const ORGANIZATIONS_ROUTES: Routes = [
  {
    path: '',
    title: 'Organizations',
    loadComponent: () =>
      import('./organization-list/organization-list.component').then(
        (m) => m.OrganizationListComponent,
      ),
  },
];
