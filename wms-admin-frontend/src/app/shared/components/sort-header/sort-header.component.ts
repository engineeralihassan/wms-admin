import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * Clickable sortable table header cell. Shows an asc/desc indicator when this column
 * is the active sort. Emits the column key on click; the parent's ListState decides
 * how to toggle direction.
 *
 * Usage:
 *   <th><app-sort-header column="email" label="Email"
 *        [activeColumn]="list.sortBy()" [direction]="list.sortDir()"
 *        (sort)="list.toggleSort($event)" /></th>
 */
@Component({
  selector: 'app-sort-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="sort"
      [attr.aria-label]="ariaLabel()"
      (click)="sort.emit(column())"
    >
      <span>{{ label() }}</span>
      <span class="sort__icon" [class.sort__icon--active]="isActive()" aria-hidden="true">
        {{ isActive() ? (direction() === 'asc' ? '▲' : '▼') : '↕' }}
      </span>
    </button>
  `,
  styleUrl: './sort-header.component.scss',
})
export class SortHeaderComponent {
  readonly column = input.required<string>();
  readonly label = input.required<string>();
  readonly activeColumn = input<string>('');
  readonly direction = input<'asc' | 'desc'>('desc');
  readonly sort = output<string>();

  protected readonly isActive = computed(() => this.activeColumn() === this.column());

  /** Describes the action for screen readers, e.g. "Sort by Email ascending". */
  protected readonly ariaLabel = computed(() => {
    if (!this.isActive()) return `Sort by ${this.label()}`;
    const next = this.direction() === 'asc' ? 'descending' : 'ascending';
    return `Sort by ${this.label()}, currently ${this.direction()}ending, activate to sort ${next}`;
  });
}
