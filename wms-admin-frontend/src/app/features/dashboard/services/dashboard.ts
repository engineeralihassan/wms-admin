import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { API_ENDPOINTS } from '../../../core/constants/api-endpoints';
import type {
  ChartData,
  DashboardMe,
  RecentProject,
  RecentTicket,
  SummaryCard,
} from '../models/dashboard.model';

/**
 * Data access for the dashboard feature.
 *
 * The backend exposes ONE endpoint per widget so the frontend can fire them all in
 * parallel and show a per-widget loader — a slow query for one module never blocks
 * the rest of the page. This service is a thin map from method -> endpoint; the
 * backend already scopes every response to what the caller may see (tenant + role).
 */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly api = inject(ApiService);

  /** Logged-in user's profile card. */
  me(): Observable<DashboardMe> {
    return this.api.get<DashboardMe>(API_ENDPOINTS.dashboard.me);
  }

  // ---- Charts (one per module) ----

  leaveChart(): Observable<ChartData> {
    return this.api.get<ChartData>(API_ENDPOINTS.dashboard.charts.leaves);
  }

  ticketChart(): Observable<ChartData> {
    return this.api.get<ChartData>(API_ENDPOINTS.dashboard.charts.tickets);
  }

  expenseChart(): Observable<ChartData> {
    return this.api.get<ChartData>(API_ENDPOINTS.dashboard.charts.expenses);
  }

  projectChart(): Observable<ChartData> {
    return this.api.get<ChartData>(API_ENDPOINTS.dashboard.charts.projects);
  }

  userChart(): Observable<ChartData> {
    return this.api.get<ChartData>(API_ENDPOINTS.dashboard.charts.users);
  }

  /** Organizations chart — super admin only (backend enforces organization.read_all). */
  organizationChart(): Observable<ChartData> {
    return this.api.get<ChartData>(API_ENDPOINTS.dashboard.charts.organizations);
  }

  // ---- Cards + recent lists ----

  summary(): Observable<SummaryCard[]> {
    return this.api.get<SummaryCard[]>(API_ENDPOINTS.dashboard.summary);
  }

  recentProjects(): Observable<RecentProject[]> {
    return this.api.get<RecentProject[]>(API_ENDPOINTS.dashboard.recentProjects);
  }

  recentTickets(): Observable<RecentTicket[]> {
    return this.api.get<RecentTicket[]>(API_ENDPOINTS.dashboard.recentTickets);
  }
}
