import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { ApiResponse } from '../models';
import type { ListQuery, PageMeta, PaginatedResult } from '../models/pagination.model';

/** Loose shape for query params accepted by the API service. */
export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Generic HTTP gateway for the WMS backend.
 *
 * Responsibilities:
 *  - Prefix every request with `environment.apiBaseUrl` (dynamic per environment).
 *  - Unwrap the backend's `{ message, data }` envelope so callers get `data` directly.
 *
 * Feature-specific services (AuthService, UserService, ...) build on top of this
 * rather than injecting HttpClient directly, keeping the envelope logic in one place.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  get<T>(path: string, params?: QueryParams): Observable<T> {
    return this.http
      .get<ApiResponse<T>>(this.url(path), { params: this.toHttpParams(params) })
      .pipe(map((res) => res.data));
  }

  post<T>(path: string, body: unknown, options?: { withCredentials?: boolean }): Observable<T> {
    return this.http
      .post<ApiResponse<T>>(this.url(path), body, {
        withCredentials: options?.withCredentials ?? false,
      })
      .pipe(map((res) => res.data));
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<ApiResponse<T>>(this.url(path), body).pipe(map((res) => res.data));
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<ApiResponse<T>>(this.url(path), body).pipe(map((res) => res.data));
  }

  delete<T>(path: string, params?: QueryParams): Observable<T> {
    return this.http
      .delete<ApiResponse<T>>(this.url(path), { params: this.toHttpParams(params) })
      .pipe(map((res) => res.data));
  }

  /**
   * Paginated list request. Returns BOTH data and meta (unlike get(), which unwraps
   * to data only). Serializes a ListQuery — including nested `filters.*` — into query
   * params. Every list endpoint uses this, so pagination behavior is uniform.
   */
  list<T>(path: string, query: ListQuery = {}): Observable<PaginatedResult<T>> {
    return this.http
      .get<ApiResponse<T[]>>(this.url(path), { params: this.toListParams(query) })
      .pipe(
        map((res) => ({
          data: res.data,
          meta: res.meta as PageMeta,
        })),
      );
  }

  private toListParams(query: ListQuery): HttpParams {
    let params = new HttpParams();
    const setIf = (key: string, value: unknown) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    };
    setIf('page', query.page);
    setIf('limit', query.limit);
    setIf('sortBy', query.sortBy);
    setIf('sortDir', query.sortDir);
    setIf('search', query.search);
    setIf('cursor', query.cursor);
    if (query.filters) {
      for (const [key, value] of Object.entries(query.filters)) {
        setIf(`filters[${key}]`, value);
      }
    }
    return params;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private toHttpParams(params?: QueryParams): HttpParams {
    let httpParams = new HttpParams();
    if (!params) return httpParams;
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        httpParams = httpParams.set(key, String(value));
      }
    }
    return httpParams;
  }
}
