import { Injectable, inject } from '@angular/core';
import { StorageService } from '../services/storage.service';
import { STORAGE_KEYS } from '../constants/storage-keys';

/**
 * Owns the ACCESS token only.
 *
 * The refresh token is NOT stored here (or anywhere in JS): the backend delivers it
 * as an httpOnly cookie the browser sends automatically on /auth/* calls. This means
 * an XSS payload cannot read the refresh token. The short-lived access token is kept
 * in localStorage so it survives reloads; treat it as the lower-value credential.
 */
@Injectable({ providedIn: 'root' })
export class TokenStorageService {
  private readonly storage = inject(StorageService);

  getAccessToken(): string | null {
    return this.storage.get<string>(STORAGE_KEYS.accessToken);
  }

  setAccessToken(accessToken: string): void {
    this.storage.set(STORAGE_KEYS.accessToken, accessToken);
  }

  clear(): void {
    this.storage.remove(STORAGE_KEYS.accessToken);
  }
}
