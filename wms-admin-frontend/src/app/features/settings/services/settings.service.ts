import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type { ChangePasswordRequest } from '../models/settings.model';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly api = inject(ApiService);

  changePassword(payload: ChangePasswordRequest): Observable<null> {
    return this.api.post<null>(API_ENDPOINTS.auth.changePassword, payload, {
      withCredentials: true,
    });
  }
}
