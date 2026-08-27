import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { APP_ROUTES } from '../../constants/app-routes';

/**
 * Keeps already-authenticated users out of guest-only pages (login/register),
 * redirecting them to the dashboard instead.
 */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated() || auth.hasAccessToken()) {
    return router.createUrlTree([APP_ROUTES.dashboard]);
  }
  return true;
};
