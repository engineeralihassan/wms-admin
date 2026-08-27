import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from '../http/api.service';
import { TokenStorageService } from './token-storage.service';
import { StorageService } from '../services/storage.service';
import { API_ENDPOINTS } from '../constants/api-endpoints';
import { STORAGE_KEYS } from '../constants/storage-keys';
import type {
  SignInRequest,
  SignInData,
  RefreshData,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  User,
} from '../models';

const SUPER_ADMIN_ROLE = 'super_admin';

/**
 * Central authentication + authorization state.
 *
 * Exposes signals so components/guards react without manual subscriptions:
 *  - currentUser(), isAuthenticated()
 *  - role(), permissions(), isSuperAdmin()
 *  - hasPermission(), hasAnyPermission(), hasRole()  (authorization helpers)
 *
 * IMPORTANT: these checks are for UX only. The backend is the real security gate;
 * the frontend just hides/blocks things the user can't do.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly tokenStorage = inject(TokenStorageService);
  private readonly storage = inject(StorageService);

  private readonly _currentUser = signal<User | null>(this.storage.get<User>(STORAGE_KEYS.user));
  readonly currentUser = this._currentUser.asReadonly();

  readonly isAuthenticated = computed(() => this._currentUser() !== null);
  readonly role = computed(() => this._currentUser()?.role ?? null);
  readonly permissions = computed(() => this._currentUser()?.permissions ?? []);
  readonly isSuperAdmin = computed(() => this.role() === SUPER_ADMIN_ROLE);

  /**
   * Authenticate. The access token comes back in the body (stored locally); the
   * refresh token is set by the server as an httpOnly cookie (never touched by JS).
   * withCredentials lets the browser store/send that cookie.
   */
  signIn(payload: SignInRequest): Observable<SignInData> {
    return this.api
      .post<SignInData>(API_ENDPOINTS.auth.signIn, payload, { withCredentials: true })
      .pipe(
        tap((data) => {
          this.tokenStorage.setAccessToken(data.access.token);
          this.setUser(data.user);
        }),
      );
  }

  /** Load the current user (re-validates a restored session; refreshes permissions). */
  loadCurrentUser(): Observable<User> {
    return this.api.get<User>(API_ENDPOINTS.auth.me).pipe(tap((user) => this.setUser(user)));
  }

  /**
   * Get a fresh access token. The refresh token travels via the httpOnly cookie,
   * so no token is sent in the body. withCredentials makes the browser include it.
   */
  refresh(): Observable<RefreshData> {
    return this.api
      .post<RefreshData>(API_ENDPOINTS.auth.refresh, {}, { withCredentials: true })
      .pipe(tap((data) => this.tokenStorage.setAccessToken(data.access.token)));
  }

  forgotPassword(payload: ForgotPasswordRequest): Observable<null> {
    return this.api.post<null>(API_ENDPOINTS.auth.forgotPassword, payload);
  }

  resetPassword(payload: ResetPasswordRequest): Observable<null> {
    return this.api.post<null>(API_ENDPOINTS.auth.resetPassword, payload, {
      withCredentials: true,
    });
  }

  /** Revoke the session server-side (clears the cookie), then clear local state. */
  logout(): Observable<null> {
    return this.api
      .post<null>(API_ENDPOINTS.auth.logout, {}, { withCredentials: true })
      .pipe(tap(() => this.clearSession()));
  }

  /** Clear all local auth state (used on logout and on hard 401). */
  clearSession(): void {
    this.tokenStorage.clear();
    this.storage.remove(STORAGE_KEYS.user);
    this._currentUser.set(null);
  }

  hasAccessToken(): boolean {
    return this.tokenStorage.getAccessToken() !== null;
  }

  // ---- Authorization helpers ----

  /** True if the user has the given permission (super admin always true). */
  hasPermission(permission: string): boolean {
    if (this.isSuperAdmin()) return true;
    return this.permissions().includes(permission);
  }

  /** True if the user has ANY of the given permissions. */
  hasAnyPermission(permissions: string[]): boolean {
    if (this.isSuperAdmin()) return true;
    return permissions.some((p) => this.permissions().includes(p));
  }

  /** True if the user has ALL of the given permissions. */
  hasAllPermissions(permissions: string[]): boolean {
    if (this.isSuperAdmin()) return true;
    return permissions.every((p) => this.permissions().includes(p));
  }

  /** True if the user's role is one of the given roles (super admin always true). */
  hasRole(...roles: string[]): boolean {
    if (this.isSuperAdmin()) return true;
    const current = this.role();
    return current !== null && roles.includes(current);
  }

  private setUser(user: User): void {
    this.storage.set(STORAGE_KEYS.user, user);
    this._currentUser.set(user);
  }
}
