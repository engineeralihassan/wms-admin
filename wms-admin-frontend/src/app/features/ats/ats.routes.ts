import { Routes } from '@angular/router';

/**
 * ATS feature routes (recruiter + org admin). Guarded upstream by permissionGuard
 * ('job.read') in app.routes.ts, and lazy-loaded. The list shows jobs; the detail
 * route shows a single job's applicants (uuid bound via component input binding).
 */
export const ATS_ROUTES: Routes = [
  {
    path: '',
    title: 'Jobs & Hiring',
    loadComponent: () => import('./job-list/job-list').then((m) => m.JobList),
  },
  {
    path: ':uuid',
    title: 'Job Applicants',
    loadComponent: () => import('./job-detail/job-detail').then((m) => m.JobDetail),
  },
];
