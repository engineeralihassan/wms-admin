import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { OrganizationsService } from '../services/organizations.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CardComponent } from '../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { DataTableComponent, type DataTableAction, type DataTableColumn, type DataTableDateRangeFilter, type DataTableFilter } from '../../../shared/components/data-table/data-table.component';
import { markAllAsTouched } from '../../../shared/utils/form.utils';
import { createListState } from '../../../shared/list/list-state';
import type { Organization } from '../models/organization.model';

/**
 * Super-admin page to list organizations (search/sort/paginate) and create a new
 * org + its first admin.
 */
@Component({
  selector: 'app-organization-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    DataTableComponent,
  ],
  templateUrl: './organization-list.component.html',
  styleUrl: './organization-list.component.scss',
})
export class OrganizationListComponent {
  private readonly fb = inject(FormBuilder);
  private readonly orgs = inject(OrganizationsService);
  private readonly notify = inject(NotificationService);

  protected readonly submitting = signal(false);
  protected readonly showForm = signal(false);

  protected readonly list = createListState<Organization>(
    (query) => this.orgs.list(query),
    { sortBy: 'created_at', sortDir: 'desc', limit: 10 },
  );

  protected readonly columns: ReadonlyArray<DataTableColumn<Organization>> = [
    { key: 'name', label: 'Organization', sortable: true, value: (o) => o.name },
    { key: 'slug', label: 'Slug', sortable: true, value: (o) => o.slug, tone: 'code' },
    { key: 'is_active', label: 'Status', sortable: true, value: (o) => o.is_active ? 'Active' : 'Inactive', tone: 'status' },
    { key: 'created_at', label: 'Created', sortable: true, value: (o) => this.formatDate(o.created_at), tone: 'muted' },
  ];
  protected readonly filters: ReadonlyArray<DataTableFilter> = [
    { key: 'is_active', label: 'Status', options: [
      { label: 'All statuses', value: '' }, { label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' },
    ] },
  ];
  protected readonly dateRangeFilter: DataTableDateRangeFilter = {
    label: 'Created date', fromKey: 'created_at_from', toKey: 'created_at_to',
  };
  protected readonly actions: ReadonlyArray<DataTableAction<Organization>> = [
    {
      id: 'toggle-status', label: 'Change status', icon: 'status',
    },
  ];
  protected readonly searchValue = signal('');

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    first_name: ['', [Validators.required]],
    last_name: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
  });

  constructor() {
    this.list.init();
  }

  protected toggleForm(): void {
    this.showForm.update((v) => !v);
  }

  protected formatDate(value?: string): string {
    return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—';
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

  protected onAction(event: { actionId: string; row: Organization }): void {
    if (event.actionId !== 'toggle-status') return;

    const nextStatus = !event.row.is_active;
    const action = nextStatus ? 'activate' : 'deactivate';
    if (!globalThis.confirm(`Are you sure you want to ${action} ${event.row.name}?`)) return;

    this.orgs.updateStatus(event.row.uuid, nextStatus).subscribe({
      next: () => {
        this.notify.success(`${event.row.name} ${nextStatus ? 'activated' : 'deactivated'}.`);
        this.list.reload();
      },
    });
  }

  protected submit(): void {
    if (this.form.invalid) {
      markAllAsTouched(this.form);
      return;
    }
    const v = this.form.getRawValue();
    this.submitting.set(true);
    this.orgs
      .create({
        name: v.name,
        admin: {
          first_name: v.first_name,
          last_name: v.last_name,
          email: v.email,
        },
      })
      .subscribe({
        next: () => {
          this.notify.success('Organization created.');
          this.form.reset();
          this.showForm.set(false);
          this.submitting.set(false);
          this.list.reload();
        },
        error: () => this.submitting.set(false),
      });
  }
}
