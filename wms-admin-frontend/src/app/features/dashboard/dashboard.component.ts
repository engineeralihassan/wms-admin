import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { CardComponent } from '../../shared/components/card/card.component';
import { SpinnerComponent } from '../../shared/components/spinner/spinner.component';
import { BarChartCardComponent } from './components/bar-chart-card/bar-chart-card.component';
import { DashboardService } from './services/dashboard';
import { createWidget, type Widget } from './widget-state';
import type {
  ChartData,
  DashboardMe,
  RecentProject,
  RecentTicket,
  SummaryCard,
  TodosResponse,
} from './models/dashboard.model';

/**
 * Dashboard landing page.
 *
 * Every widget loads INDEPENDENTLY: on init we fire all requests in parallel and each
 * widget renders its own loader, then swaps to content (or an error+retry) the moment
 * its own call resolves. Nothing waits for the whole page. The organizations chart is
 * only requested for super admins (the route/backend also enforce this).
 *
 * All six charts render through the SAME reusable BarChartCardComponent, driven purely
 * by the normalized ChartData the backend returns.
 */
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardComponent, SpinnerComponent, BarChartCardComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private readonly api = inject(DashboardService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly isSuperAdmin = computed(() => this.auth.isSuperAdmin());

  // Per-widget visibility (UX only — the backend re-enforces the real rule). A widget
  // is shown only when the caller has the module read permission its endpoint requires,
  // so users never see an error card for something they simply aren't allowed to load.
  protected readonly canReadLeaves = computed(() => this.auth.hasPermission('leave.read'));
  protected readonly canReadTickets = computed(() => this.auth.hasPermission('ticket.read'));
  protected readonly canReadExpenses = computed(() => this.auth.hasPermission('expense.read'));
  protected readonly canReadProjects = computed(() => this.auth.hasPermission('project.read'));
  protected readonly canReadUsers = computed(() => this.auth.hasPermission('user.read'));
  protected readonly canReadTimesheets = computed(() =>
    this.auth.hasPermission('timesheet.read'),
  );
  protected readonly canReadSummary = computed(() =>
    this.auth.hasAnyPermission([
      'leave.read',
      'ticket.read',
      'expense.read',
      'project.read',
      'user.read',
    ]),
  );

  protected readonly greeting = computed(() => {
    const user = this.auth.currentUser();
    return user ? `Welcome back, ${user.first_name}` : 'Welcome';
  });

  // ---- Widget state (each is an independent loader/data/error unit) ----
  protected readonly me = signal<DashboardMe | null>(null);
  protected readonly meLoading = signal(true);

  protected readonly leaves = createWidget<ChartData>();
  protected readonly tickets = createWidget<ChartData>();
  protected readonly expenses = createWidget<ChartData>();
  protected readonly projects = createWidget<ChartData>();
  protected readonly users = createWidget<ChartData>();
  protected readonly organizations = createWidget<ChartData>();
  protected readonly timesheets = createWidget<ChartData>();

  protected readonly summary = createWidget<SummaryCard[]>();
  protected readonly todos = createWidget<TodosResponse>();
  protected readonly recentProjects = createWidget<RecentProject[]>();
  protected readonly recentTickets = createWidget<RecentTicket[]>();

  /** The todo items (empty array when none), for clean template access. */
  protected readonly todoItems = computed(() => this.todos.data()?.items ?? []);

  /** Whether the full todo list is expanded (vs. the compact capped view). */
  protected readonly todosExpanded = signal(false);

  /** How many todos to show before "Show all" (keeps the panel from eating the page). */
  private readonly TODO_COLLAPSED_COUNT = 4;

  /** Urgent (danger) todos first, then upcoming (warning) — the display order. */
  protected readonly sortedTodos = computed(() => {
    const rank: Record<string, number> = { danger: 0, warning: 1 };
    return [...this.todoItems()].sort(
      (a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9),
    );
  });

  /** The todos actually rendered: capped when collapsed, everything when expanded. */
  protected readonly visibleTodos = computed(() =>
    this.todosExpanded()
      ? this.sortedTodos()
      : this.sortedTodos().slice(0, this.TODO_COLLAPSED_COUNT),
  );

  /** Count of urgent (danger) items — drives the header summary + blink. */
  protected readonly dangerCount = computed(
    () => this.todoItems().filter((t) => t.severity === 'danger').length,
  );

  /** Count of upcoming (warning) items. */
  protected readonly warningCount = computed(
    () => this.todoItems().filter((t) => t.severity === 'warning').length,
  );

  /** How many todos are hidden in the collapsed view (for the "Show all (N)" label). */
  protected readonly hiddenTodoCount = computed(() =>
    Math.max(0, this.sortedTodos().length - this.TODO_COLLAPSED_COUNT),
  );

  protected toggleTodos(): void {
    this.todosExpanded.update((v) => !v);
  }

  constructor() {
    this.loadAll();
  }

  /**
   * Fire every PERMITTED widget's request in parallel — no widget waits for another.
   * We only request widgets the caller can access so they never see an error card for
   * something they aren't allowed to load; the backend still enforces the real rule.
   */
  private loadAll(): void {
    this.loadMe();
    if (this.isSuperAdmin()) this.reloadOrganizations();
    if (this.canReadLeaves()) this.reloadLeaves();
    if (this.canReadProjects()) this.reloadProjects();
    if (this.canReadTickets()) this.reloadTickets();
    if (this.canReadExpenses()) this.reloadExpenses();
    if (this.canReadUsers()) this.reloadUsers();
    if (this.canReadTimesheets()) this.reloadTimesheets();
    if (this.canReadSummary()) this.reloadSummary();
    // To-dos always load: every user has at least their OWN (visa/timesheet) to act on;
    // the backend widens the sources per-permission.
    this.reloadTodos();
    if (this.canReadProjects()) this.reloadRecentProjects();
    if (this.canReadTickets()) this.reloadRecentTickets();
  }

  private loadMe(): void {
    this.meLoading.set(true);
    this.api.me().subscribe({
      next: (data) => {
        this.me.set(data);
        this.meLoading.set(false);
      },
      error: () => this.meLoading.set(false),
    });
  }

  // Each chart reload is a thin wrapper so the template's Retry can re-trigger it.
  protected reloadLeaves(): void {
    this.load(this.leaves, () => this.api.leaveChart());
  }
  protected reloadTickets(): void {
    this.load(this.tickets, () => this.api.ticketChart());
  }
  protected reloadExpenses(): void {
    this.load(this.expenses, () => this.api.expenseChart());
  }
  protected reloadProjects(): void {
    this.load(this.projects, () => this.api.projectChart());
  }
  protected reloadUsers(): void {
    this.load(this.users, () => this.api.userChart());
  }
  protected reloadOrganizations(): void {
    this.load(this.organizations, () => this.api.organizationChart());
  }
  protected reloadTimesheets(): void {
    this.load(this.timesheets, () => this.api.timesheetChart());
  }
  protected reloadSummary(): void {
    this.load(this.summary, () => this.api.summary());
  }
  protected reloadTodos(): void {
    this.load(this.todos, () => this.api.todos());
  }
  protected reloadRecentProjects(): void {
    this.load(this.recentProjects, () => this.api.recentProjects());
  }
  protected reloadRecentTickets(): void {
    this.load(this.recentTickets, () => this.api.recentTickets());
  }

  /** Shared loader: flip to loading, then set data or error when the call settles. */
  private load<T>(widget: Widget<T>, request: () => import('rxjs').Observable<T>): void {
    widget.loading.set(true);
    widget.error.set(false);
    request().subscribe({
      next: (data) => {
        widget.data.set(data);
        widget.loading.set(false);
      },
      error: () => {
        widget.error.set(true);
        widget.loading.set(false);
      },
    });
  }

  /** Navigate to a module's main page (from a chart or card). */
  protected goTo(path: string): void {
    void this.router.navigate([path]);
  }

  // ---- Small view helpers ----
  protected fullName(user: { first_name: string; last_name: string } | null): string {
    return user ? `${user.first_name} ${user.last_name}` : '—';
  }

  protected initials(): string {
    const u = this.me();
    if (!u) return '';
    return `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.toUpperCase();
  }
}
