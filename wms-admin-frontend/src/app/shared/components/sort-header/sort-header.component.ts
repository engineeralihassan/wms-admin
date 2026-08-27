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
    <button type="button" class="sort" (click)="sort.emit(column())">
      <span>{{ label() }}</span>
      <span class="sort__icon" [class.sort__icon--active]="isActive()">
        {{ isActive() ? (direction() === 'asc' ? '▲' : '▼') : '↕' }}
      </span>
    </button>
  `,
  styles: [
    `
      .sort {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        font: inherit;
        color: inherit;
        text-transform: uppercase;
        font-size: 0.75rem;
        letter-spacing: 0.03em;
        font-weight: 600;
        color: var(--color-text-muted, #64748b);
      }
      .sort__icon { font-size: 0.7rem; opacity: 0.4; }
      .sort__icon--active { opacity: 1; color: var(--color-primary, #2563eb); }
    `,
  ],
})
export class SortHeaderComponent {
  readonly column = input.required<string>();
  readonly label = input.required<string>();
  readonly activeColumn = input<string>('');
  readonly direction = input<'asc' | 'desc'>('desc');
  readonly sort = output<string>();

  protected readonly isActive = computed(() => this.activeColumn() === this.column());
}
