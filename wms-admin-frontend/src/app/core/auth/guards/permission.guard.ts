import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { APP_ROUTES } from '../../constants/app-routes';

/**
 * Route guard factory: restricts a route to users holding at least one of the
 * given permissions. Attach in the route config via `canActivate: [permissionGuard('user.read')]`.
 *
 * On denial, authenticated users are sent to the dashboard (they're logged in but
 * lack access); unauthenticated users go to login. UX only — the backend enforces
 * the real rule on every API call.
 */
export const permissionGuard = (...permissions: string[]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.isAuthenticated()) {
      return router.createUrlTree([APP_ROUTES.login]);
    }
    if (auth.hasAnyPermission(permissions)) {
      return true;
    }
    return router.createUrlTree([APP_ROUTES.dashboard]);
  };
};

/**
 * Route guard factory restricting by role (e.g. super_admin-only areas).
 */
export const roleGuard = (...roles: string[]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.isAuthenticated()) {
      return router.createUrlTree([APP_ROUTES.login]);
    }
    if (auth.hasRole(...roles)) {
      return true;
    }
    return router.createUrlTree([APP_ROUTES.dashboard]);
  };
};
