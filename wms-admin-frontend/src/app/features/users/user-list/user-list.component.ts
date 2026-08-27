import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UsersService } from '../services/users.service';
import { CardComponent } from '../../../shared/components/card/card.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { PaginationComponent } from '../../../shared/components/pagination/pagination.component';
import { SortHeaderComponent } from '../../../shared/components/sort-header/sort-header.component';
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
    RouterLink,
    CardComponent,
    SpinnerComponent,
    PaginationComponent,
    SortHeaderComponent,
  ],
  templateUrl: './user-list.component.html',
  styleUrl: './user-list.component.scss',
})
export class UserListComponent {
  private readonly usersService = inject(UsersService);

  protected readonly list = createListState<UserListItem>(
    (query) => this.usersService.list(query),
    { sortBy: 'created_at', sortDir: 'desc', limit: 10 },
  );

  constructor() {
    this.list.init();
  }

  protected onSearchInput(event: Event): void {
    this.list.onSearch((event.target as HTMLInputElement).value);
  }
}
