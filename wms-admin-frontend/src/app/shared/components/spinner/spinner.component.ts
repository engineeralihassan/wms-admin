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
  styleUrl: './spinner.component.scss',
})
export class SpinnerComponent {
  readonly size = input(24);
  readonly borderWidth = input(3);
}
