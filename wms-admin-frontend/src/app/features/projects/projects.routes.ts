import { Routes } from '@angular/router';

/** Projects feature routes (project.read only). Lazy-loaded. */
export const PROJECTS_ROUTES: Routes = [
  {
    path: '',
    title: 'Projects',
    loadComponent: () =>
      import('./project-list/project-list').then((m) => m.ProjectList),
  },
];
