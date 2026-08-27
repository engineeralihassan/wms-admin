import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { TokenStorageService } from '../../auth/token-storage.service';

/**
 * Attaches the JWT access token to outgoing API requests as a Bearer token.
 *
 * The backend's `authVerify` middleware expects: `Authorization: Bearer <token>`.
 * We only attach when a token exists, leaving public endpoints (signIn/signUp) untouched.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenStorage = inject(TokenStorageService);
  const token = tokenStorage.getAccessToken();

  if (!token) {
    return next(req);
  }

  const authReq = req.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  });
  return next(authReq);
};
