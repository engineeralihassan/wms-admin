import { Routes } from '@angular/router';
import { AuthLayoutComponent } from '../../layout/auth-layout/auth-layout.component';
import { guestGuard } from '../../core/auth/guards/guest.guard';

/**
 * Auth feature routes, rendered inside AuthLayout and protected by guestGuard.
 * Public registration is intentionally absent — accounts are created by admins.
 * Lazy-loaded from the root router.
 */
export const AUTH_ROUTES: Routes = [
  {
    path: '',
    component: AuthLayoutComponent,
    canActivate: [guestGuard],
    children: [
      { path: '', redirectTo: 'login', pathMatch: 'full' },
      {
        path: 'login',
        title: 'Sign in',
        loadComponent: () => import('./login/login.component').then((m) => m.LoginComponent),
      },
      {
        path: 'forgot-password',
        title: 'Forgot password',
        loadComponent: () =>
          import('./forgot-password/forgot-password.component').then(
            (m) => m.ForgotPasswordComponent,
          ),
      },
      {
        path: 'reset-password',
        title: 'Reset password',
        loadComponent: () =>
          import('./reset-password/reset-password.component').then((m) => m.ResetPasswordComponent),
      },
      {
        path: 'activate',
        title: 'Activate account',
        loadComponent: () =>
          import('./activate/activate.component').then((m) => m.ActivateComponent),
      },
    ],
  },
];
