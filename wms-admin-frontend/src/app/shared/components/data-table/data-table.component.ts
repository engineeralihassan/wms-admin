import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PaginationComponent } from '../pagination/pagination.component';
import type { SortDirection } from '../../../core/models/pagination.model';
import { iconPath, type IconName } from '../icon/icons';

/** Semantic pill variants a column can render via the `badge` hook. */
export type BadgeVariant =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'primary';

/** A rendered badge/pill: its text and semantic color. */
export interface BadgeCell {
  label: string;
  variant: BadgeVariant;
  /** Optional leading dot indicator (e.g. status). */
  dot?: boolean;
}

/** A column is deliberately data-only; side effects stay in the owning feature. */
export interface DataTableColumn<T> {
  key: string;
  label: string;
  value: (row: T) => string;
  sortable?: boolean;
  tone?: 'default' | 'status' | 'muted' | 'code';
  className?: string;
  /**
   * Optional: render this cell as a colored pill. The feature controls the label
   * and semantic color from the raw row (stable), so pill styling never depends on
   * parsing a display string. When set, it takes precedence over `tone`.
   */
  badge?: (row: T) => BadgeCell;
}

export interface DataTableFilter {
  key: string;
  label: string;
  options: ReadonlyArray<{ label: string; value: string }>;
}

export interface DataTableDateRangeFilter {
  label: string;
  fromKey: string;
  toKey: string;
}

export interface DataTableAction<T> {
  id: string;
  label: string;
  /** A named icon from the shared registry (rendered as a crisp inline SVG). */
  icon?: IconName;
  /** Visual emphasis. 'danger' styles destructive actions (e.g. Delete). */
  variant?: 'default' | 'danger';
  isDisabled?: (row: T) => boolean;
  disabledLabel?: (row: T) => string;
  /** When it returns true, the action is not rendered at all for that row. */
  isHidden?: (row: T) => boolean;
}

export interface DataTableActionEvent<T> {
  actionId: string;
  row: T;
}

/**
 * Presentational, accessible table shell. It never fetches data or navigates:
 * all user intent is emitted to the parent feature, keeping it reusable for any
 * server- or client-backed list.
 */
@Component({
  selector: 'app-data-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PaginationComponent],
  templateUrl: './data-table.component.html',
  styleUrl: './data-table.component.scss',
})
export class DataTableComponent<T> {
  readonly caption = input.required<string>();
  readonly columns = input.required<ReadonlyArray<DataTableColumn<T>>>();
  readonly rows = input.required<ReadonlyArray<T>>();
  readonly rowId = input.required<(row: T) => string | number>();
  readonly loading = input(false);
  readonly emptyMessage = input('No results found.');
  readonly searchLabel = input('Search table');
  readonly searchPlaceholder = input('Search…');
  readonly searchValue = input('');
  readonly filters = input<ReadonlyArray<DataTableFilter>>([]);
  readonly dateRangeFilter = input<DataTableDateRangeFilter | null>(null);
  readonly filterValues = input<Record<string, string>>({});
  readonly actions = input<ReadonlyArray<DataTableAction<T>>>([]);
  /** Render row actions as compact icon-only buttons (labels kept for a11y/tooltip). */
  readonly iconOnlyActions = input(false);
  readonly page = input(1);
  readonly totalPages = input(1);
  readonly total = input(0);
  readonly limit = input(20);
  readonly pageSizeOptions = input<ReadonlyArray<number>>([10, 20, 50, 100]);
  readonly sortBy = input('');
  readonly sortDir = input<SortDirection>('desc');

  readonly searchChange = output<string>();
  readonly filterChange = output<{ key: string; value: string }>();
  readonly sortChange = output<string>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly action = output<DataTableActionEvent<T>>();
  /** Emitted when the user clicks "Clear all" — clears search + every filter. */
  readonly resetFilters = output<void>();

  protected readonly visibleColumns = computed(() => this.columns());
  protected readonly hasActions = computed(() => this.actions().length > 0);

  protected onSearch(event: Event): void {
    this.searchChange.emit((event.target as HTMLInputElement).value);
  }

  protected onFilter(key: string, event: Event): void {
    this.filterChange.emit({ key, value: (event.target as HTMLSelectElement).value });
  }

  protected onPageSize(event: Event): void {
    this.pageSizeChange.emit(Number((event.target as HTMLSelectElement).value));
  }

  protected sort(column: DataTableColumn<T>): void {
    if (column.sortable) this.sortChange.emit(column.key);
  }

  protected sortLabel(column: DataTableColumn<T>): string {
    if (this.sortBy() !== column.key) return `Sort by ${column.label}`;
    const next = this.sortDir() === 'asc' ? 'descending' : 'ascending';
    return `Sort by ${column.label}, currently ${this.sortDir()}ending, activate to sort ${next}`;
  }

  protected sortIcon(column: DataTableColumn<T>): string {
    return this.sortBy() === column.key ? (this.sortDir() === 'asc' ? '↑' : '↓') : '↕';
  }

  protected trackRow = (_: number, row: T): string | number => this.rowId()(row);

  /** Resolve an action's named icon to its SVG path (null if unregistered). */
  protected iconPath(name: string | undefined): string | null {
    return iconPath(name);
  }
}
