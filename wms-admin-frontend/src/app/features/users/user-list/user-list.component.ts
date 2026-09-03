import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UsersService } from '../services/users.service';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CardComponent } from '../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { DataTableComponent, type DataTableAction, type DataTableColumn, type DataTableDateRangeFilter, type DataTableFilter } from '../../../shared/components/data-table/data-table.component';
import { createListState } from '../../../shared/list/list-state';
import type { UserListItem } from '../models/user-list-item.model';

/**
 * Users list page. All search/sort/pagination is delegated to the reusable
 * createListState + shared UI components — the component itself stays thin.
 */
@Component({
  selector: 'app-user-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CardComponent,
    ButtonComponent,
    DataTableComponent,
  ],
  templateUrl: './user-list.component.html',
  styleUrl: './user-list.component.scss',
})
export class UserListComponent {
  private readonly usersService = inject(UsersService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** UX gate only; backend still enforces user.create. */
  protected readonly canCreate = this.auth.hasPermission('user.create');

  protected readonly list = createListState<UserListItem>(
    (query) => this.usersService.list(query),
    { sortBy: 'created_at', sortDir: 'desc', limit: 10 },
  );

  protected readonly columns: ReadonlyArray<DataTableColumn<UserListItem>> = [
    { key: 'first_name', label: 'User', sortable: true, value: (u) => `${u.first_name} ${u.last_name}` },
    { key: 'email', label: 'Email', sortable: true, value: (u) => u.email },
    { key: 'organization', label: 'Organization', value: (u) => u.organization?.name ?? 'Platform' },
    { key: 'role', label: 'Role', value: (u) => u.role?.name ?? '—', tone: 'muted' },
    { key: 'type', label: 'Type', value: (u) => this.typeLabel(u.employee_type), tone: 'muted' },
    { key: 'status', label: 'Status', sortable: true, value: (u) => u.status, tone: 'status' },
    { key: 'created_at', label: 'Created', sortable: true, value: (u) => this.formatDate(u.created_at), tone: 'muted' },
  ];
  protected readonly filters: ReadonlyArray<DataTableFilter> = [
    { key: 'status', label: 'Status', options: [
      { label: 'All statuses', value: '' }, { label: 'Active', value: 'active' },
      { label: 'Invited', value: 'invited' }, { label: 'Disabled', value: 'disabled' },
    ] },
  ];
  protected readonly dateRangeFilter: DataTableDateRangeFilter = {
    label: 'Created date', fromKey: 'created_at_from', toKey: 'created_at_to',
  };
  protected readonly actions: ReadonlyArray<DataTableAction<UserListItem>> = [
    { id: 'view', label: 'View', icon: 'view' },
    { id: 'edit', label: 'Edit', icon: 'edit' },
    // Only meaningful for users who haven't activated yet — hidden otherwise.
    { id: 'resend-invite', label: 'Resend invite', icon: 'submit', isHidden: (u) => u.status !== 'invited' },
  ];
  protected readonly searchValue = signal('');

  constructor() {
    this.list.init();
  }

  /** Navigate to the create form. */
  protected onCreate(): void {
    this.router.navigate(['new'], { relativeTo: this.route });
  }

  protected onAction(event: { actionId: string; row: UserListItem }): void {
    switch (event.actionId) {
      case 'view':
        this.router.navigate([event.row.uuid], { relativeTo: this.route });
        break;
      case 'edit':
        this.router.navigate([event.row.uuid, 'edit'], { relativeTo: this.route });
        break;
      case 'resend-invite':
        this.resendInvite(event.row);
        break;
    }
  }

  private resendInvite(row: UserListItem): void {
    // The action is hidden for non-invited users, but guard anyway (defense in depth).
    if (row.status !== 'invited') return;
    this.usersService.resendInvite(row.uuid).subscribe({
      next: () => this.notify.success(`Invitation resent to ${row.email}.`),
    });
  }

  protected onSearch(value: string): void {
    this.searchValue.set(value);
    this.list.onSearch(value);
  }

  /** "Clear all": wipe the search box + every filter. */
  protected onClearFilters(): void {
    this.searchValue.set('');
    this.list.clearFilters();
  }

  protected formatDate(value?: string): string {
    return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—';
  }

  protected typeLabel(type?: string | null): string {
    switch (type) {
      case 'w2': return 'W2';
      case '1099': return '1099';
      case 'c2c': return 'C2C';
      case 'vendor': return 'Vendor';
      case 'employee': return 'Employee';
      default: return '—';
    }
  }
}
