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
      <nav class="pager" aria-label="Pagination">
        <span class="pager__summary">{{ rangeStart() }}–{{ rangeEnd() }} of {{ total() }}</span>
        <div class="pager__controls">
          <button class="pager__btn" type="button" [disabled]="page() <= 1" (click)="go(1)" aria-label="First page">«</button>
          <button class="pager__btn" type="button" [disabled]="page() <= 1" (click)="go(page() - 1)" aria-label="Previous page">‹</button>
          @for (p of pages(); track p) {
            <button
              class="pager__btn"
              type="button"
              [class.pager__btn--active]="p === page()"
              [attr.aria-current]="p === page() ? 'page' : null"
              [attr.aria-label]="'Page ' + p"
              (click)="go(p)"
            >{{ p }}</button>
          }
          <button class="pager__btn" type="button" [disabled]="page() >= totalPages()" (click)="go(page() + 1)" aria-label="Next page">›</button>
          <button class="pager__btn" type="button" [disabled]="page() >= totalPages()" (click)="go(totalPages())" aria-label="Last page">»</button>
        </div>
      </nav>
    }
  `,
  styleUrl: './pagination.component.scss',
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
