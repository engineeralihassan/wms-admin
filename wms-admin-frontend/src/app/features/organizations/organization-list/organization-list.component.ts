import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { OrganizationsService } from '../services/organizations.service';
import { NotificationService } from '../../../core/services/notification.service';
import { CardComponent } from '../../../shared/components/card/card.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { PaginationComponent } from '../../../shared/components/pagination/pagination.component';
import { SortHeaderComponent } from '../../../shared/components/sort-header/sort-header.component';
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
    SpinnerComponent,
    ButtonComponent,
    PaginationComponent,
    SortHeaderComponent,
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

  protected onSearchInput(event: Event): void {
    this.list.onSearch((event.target as HTMLInputElement).value);
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
