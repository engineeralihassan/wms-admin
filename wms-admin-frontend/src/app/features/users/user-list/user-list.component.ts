import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UsersService } from '../services/users.service';
import { CardComponent } from '../../../shared/components/card/card.component';
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
    DataTableComponent,
  ],
  templateUrl: './user-list.component.html',
  styleUrl: './user-list.component.scss',
})
export class UserListComponent {
  private readonly usersService = inject(UsersService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly list = createListState<UserListItem>(
    (query) => this.usersService.list(query),
    { sortBy: 'created_at', sortDir: 'desc', limit: 10 },
  );

  protected readonly columns: ReadonlyArray<DataTableColumn<UserListItem>> = [
    { key: 'first_name', label: 'User', sortable: true, value: (u) => `${u.first_name} ${u.last_name}` },
    { key: 'email', label: 'Email', sortable: true, value: (u) => u.email },
    { key: 'organization', label: 'Organization', value: (u) => u.organization?.name ?? 'Platform' },
    { key: 'role', label: 'Role', value: (u) => u.role?.name ?? '—', tone: 'muted' },
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
  ];
  protected readonly searchValue = signal('');

  constructor() {
    this.list.init();
  }

  protected onAction(event: { actionId: string; row: UserListItem }): void {
    if (event.actionId === 'view') this.router.navigate([event.row.uuid], { relativeTo: this.route });
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
}
