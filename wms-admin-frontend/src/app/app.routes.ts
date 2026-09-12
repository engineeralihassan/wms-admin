import { Routes } from '@angular/router';
import { AdminLayoutComponent } from './layout/admin-layout/admin-layout.component';
import { authGuard } from './core/auth/guards/auth.guard';
import { permissionGuard, roleGuard } from './core/auth/guards/permission.guard';

/**
 * Root route table.
 *
 *  - /auth/* : public (login, forgot/reset password), rendered in AuthLayout.
 *  - everything else: authGuard-protected AdminLayout, each feature lazy-loaded
 *    AND permission/role-guarded so users can't even navigate to areas they lack
 *    access to. (Backend still enforces the real rule per request.)
 */
export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    // PUBLIC careers page — no auth, rendered outside the AdminLayout. Candidates open
    // the recruiter-shared link (/careers/:token) to view a job and apply.
    path: 'careers/:token',
    title: 'Careers',
    loadComponent: () =>
      import('./features/careers/careers-page/careers-page').then((m) => m.CareersPage),
  },
  {
    path: '',
    component: AdminLayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES),
      },
      {
        // Self-service profile. No permission guard — any authenticated user may view
        // and complete their OWN profile (served from /auth/me/*).
        path: 'profile',
        loadChildren: () =>
          import('./features/profile/profile.routes').then((m) => m.PROFILE_ROUTES),
      },
      {
        path: 'users',
        canActivate: [permissionGuard('user.read')],
        loadChildren: () => import('./features/users/users.routes').then((m) => m.USERS_ROUTES),
      },
      {
        path: 'organizations',
        canActivate: [roleGuard('super_admin')],
        loadChildren: () =>
          import('./features/organizations/organizations.routes').then(
            (m) => m.ORGANIZATIONS_ROUTES,
          ),
      },
       {
        path: 'tickets',
        canActivate: [permissionGuard('ticket.read')],
        loadChildren: () =>
          import('./features/tickets/tickets.routes').then(
            (m) => m.TICKETS_ROUTES,
          ),
      },
      {
        path: 'expenses',
        canActivate: [permissionGuard('expense.read')],
        loadChildren: () =>
          import('./features/expenses/expenses.routes').then(
            (m) => m.EXPENSES_ROUTES,
          ),
      },
      {
        path: 'projects',
        canActivate: [permissionGuard('project.read')],
        loadChildren: () =>
          import('./features/projects/projects.routes').then(
            (m) => m.PROJECTS_ROUTES,
          ),
      },
      {
        path: 'leaves',
        canActivate: [permissionGuard('leave.read')],
        loadChildren: () =>
          import('./features/leaves/leaves.routes').then(
            (m) => m.LEAVES_ROUTES,
          ),
      },
      {
        path: 'timesheets',
        canActivate: [permissionGuard('timesheet.read')],
        loadChildren: () =>
          import('./features/timesheets/timesheets.routes').then(
            (m) => m.TIMESHEETS_ROUTES,
          ),
      },
      {
        // ATS (recruiter + org admin). Only holders of job.read reach it; the nav link
        // is hidden for everyone else. Recruiters see own jobs; org admins see all.
        path: 'jobs',
        canActivate: [permissionGuard('job.read')],
        loadChildren: () => import('./features/ats/ats.routes').then((m) => m.ATS_ROUTES),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
