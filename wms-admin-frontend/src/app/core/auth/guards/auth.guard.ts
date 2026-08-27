import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../auth.service';
import { APP_ROUTES } from '../../constants/app-routes';

/**
 * Protects authenticated areas. Allows navigation only when a valid session/token exists,
 * otherwise redirects to the login page (preserving the attempted URL as returnUrl).
 *
 * Functional guard (Angular's modern approach) — no class needed.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated() || auth.hasAccessToken()) {
    return true;
  }

  return router.createUrlTree([APP_ROUTES.login], {
    queryParams: { returnUrl: state.url },
  });
};
