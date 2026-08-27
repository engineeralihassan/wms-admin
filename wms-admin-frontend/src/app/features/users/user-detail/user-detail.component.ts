import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UsersService } from '../services/users.service';
import { CardComponent } from '../../../shared/components/card/card.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { APP_ROUTES } from '../../../core/constants/app-routes';
import type { UserListItem } from '../models/user-list-item.model';

/**
 * User detail sub-page. Reads the `uuid` route param via component input binding
 * (Angular's withComponentInputBinding) and loads the record through UsersService.
 */
@Component({
  selector: 'app-user-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, CardComponent, SpinnerComponent],
  templateUrl: './user-detail.component.html',
  styleUrl: './user-detail.component.scss',
})
export class UserDetailComponent {
  private readonly usersService = inject(UsersService);

  /** Bound from the `:uuid` route segment. */
  readonly uuid = input.required<string>();

  protected readonly backLink = APP_ROUTES.users;
  protected readonly loading = signal(true);
  protected readonly user = signal<UserListItem | null>(null);

  constructor() {
    // The input is available synchronously with input binding on route params.
    queueMicrotask(() => this.load());
  }

  private load(): void {
    this.usersService.getByUuid(this.uuid()).subscribe({
      next: (user) => {
        this.user.set(user);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
