import { Injectable } from '@angular/core';

/**
 * Thin, typed wrapper around localStorage.
 *
 * Centralizing access here means:
 *  - JSON serialization is handled once,
 *  - storage failures (private mode, quota) are swallowed safely,
 *  - it can be swapped for sessionStorage / cookies / an in-memory store later.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable — ignore */
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  clear(): void {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  }
}
