import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Reusable loading spinner. Stateless/presentational.
 * Size is configurable via the `size` input (pixels).
 */
@Component({
  selector: 'app-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="spinner"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.border-width.px]="borderWidth()"
      role="status"
      aria-label="Loading"
    ></span>
  `,
  styles: [
    `
      .spinner {
        display: inline-block;
        border-radius: 50%;
        border-style: solid;
        border-color: var(--color-border, #e2e8f0);
        border-top-color: var(--color-primary, #2563eb);
        animation: spin 0.6s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class SpinnerComponent {
  readonly size = input(24);
  readonly borderWidth = input(3);
}
