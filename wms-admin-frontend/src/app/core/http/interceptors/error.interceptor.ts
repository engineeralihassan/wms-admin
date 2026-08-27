import {
  HttpErrorResponse,
  HttpEvent,
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  catchError,
  filter,
  switchMap,
  take,
  throwError,
  Observable,
  Subject,
} from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { NotificationService } from '../../services/notification.service';
import { API_ENDPOINTS } from '../../constants/api-endpoints';
import { APP_ROUTES } from '../../constants/app-routes';

/**
 * Centralized HTTP error handling with automatic, concurrency-safe token refresh.
 *
 * On a 401 (not from an auth endpoint):
 *  - The FIRST failing request triggers a single refresh (refresh token travels via
 *    the httpOnly cookie). Concurrent 401s DON'T each trigger a refresh or force a
 *    logout — they wait on a shared subject and replay once the new access token lands.
 *  - If refresh fails, the session is cleared and the user is sent to login.
 *
 * Other errors surface the backend's { message } as a toast.
 */

// Module-level coordination shared across all requests handled by this interceptor.
let isRefreshing = false;
// Emits the new access token when a refresh completes; null while none is in flight.
const refreshDone$ = new Subject<string>();

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const notify = inject(NotificationService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const isAuthCall =
        req.url.includes(API_ENDPOINTS.auth.signIn) ||
        req.url.includes(API_ENDPOINTS.auth.refresh);

      if (error.status === 401 && !isAuthCall) {
        return handle401(req, next, auth, router, notify);
      }
      if (error.status === 401) {
        auth.clearSession();
        void router.navigate([APP_ROUTES.login]);
      } else if (error.status === 0) {
        notify.error('Cannot reach the server. Check your connection.');
      } else {
        notify.error(extractMessage(error));
      }
      return throwError(() => error);
    }),
  );
};

function handle401(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  auth: AuthService,
  router: Router,
  notify: NotificationService,
): Observable<HttpEvent<unknown>> {
  // A refresh is already running: wait for it, then replay this request.
  if (isRefreshing) {
    return refreshDone$.pipe(
      filter((token) => !!token),
      take(1),
      switchMap(() => next(req)),
    );
  }

  // We are the first: run the refresh once.
  isRefreshing = true;
  return auth.refresh().pipe(
    switchMap((data) => {
      isRefreshing = false;
      refreshDone$.next(data.access.token); // release any queued requests
      return next(req);
    }),
    catchError((refreshError) => {
      isRefreshing = false;
      refreshDone$.next(''); // unblock queued requests so they fail cleanly
      auth.clearSession();
      notify.error('Your session has expired. Please sign in again.');
      void router.navigate([APP_ROUTES.login]);
      return throwError(() => refreshError);
    }),
  );
}

function extractMessage(error: HttpErrorResponse): string {
  if (error.error && typeof error.error === 'object' && 'message' in error.error) {
    return String((error.error as { message: unknown }).message);
  }
  return error.message || 'An unexpected error occurred.';
}
