import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * Reusable pagination control. Presentational: it receives the current page/total
 * and emits page-change requests. Renders a compact window of page numbers with
 * first/prev/next/last controls, plus a "X–Y of Z" summary.
 */
@Component({
  selector: 'app-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalPages() > 1 || total() > 0) {
      <div class="pager">
        <span class="pager__summary">{{ rangeStart() }}–{{ rangeEnd() }} of {{ total() }}</span>
        <div class="pager__controls">
          <button class="pager__btn" [disabled]="page() <= 1" (click)="go(1)" aria-label="First">«</button>
          <button class="pager__btn" [disabled]="page() <= 1" (click)="go(page() - 1)" aria-label="Previous">‹</button>
          @for (p of pages(); track p) {
            <button
              class="pager__btn"
              [class.pager__btn--active]="p === page()"
              (click)="go(p)"
            >{{ p }}</button>
          }
          <button class="pager__btn" [disabled]="page() >= totalPages()" (click)="go(page() + 1)" aria-label="Next">›</button>
          <button class="pager__btn" [disabled]="page() >= totalPages()" (click)="go(totalPages())" aria-label="Last">»</button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .pager {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding-top: 1rem;
        flex-wrap: wrap;
      }
      .pager__summary { font-size: 0.8rem; color: var(--color-text-muted, #64748b); }
      .pager__controls { display: flex; gap: 0.25rem; }
      .pager__btn {
        min-width: 34px;
        height: 34px;
        padding: 0 0.5rem;
        border: 1px solid var(--color-border, #e2e8f0);
        background: #fff;
        border-radius: 8px;
        font-size: 0.85rem;
        cursor: pointer;
        color: var(--color-text, #0f172a);
      }
      .pager__btn:hover:not(:disabled) { background: var(--color-hover, #f1f5f9); }
      .pager__btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .pager__btn--active {
        background: var(--color-primary, #2563eb);
        color: #fff;
        border-color: var(--color-primary, #2563eb);
      }
    `,
  ],
})
export class PaginationComponent {
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly total = input.required<number>();
  readonly limit = input(20);
  readonly pageChange = output<number>();

  /** Windowed page list (up to 5 around the current page). */
  protected readonly pages = computed(() => {
    const tp = this.totalPages();
    const current = this.page();
    const windowSize = 5;
    let start = Math.max(1, current - Math.floor(windowSize / 2));
    const end = Math.min(tp, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);
    const result: number[] = [];
    for (let p = start; p <= end; p++) result.push(p);
    return result;
  });

  protected readonly rangeStart = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.limit() + 1,
  );
  protected readonly rangeEnd = computed(() =>
    Math.min(this.page() * this.limit(), this.total()),
  );

  protected go(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.pageChange.emit(p);
  }
}
