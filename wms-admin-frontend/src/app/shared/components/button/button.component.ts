import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SpinnerComponent } from '../spinner/spinner.component';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonType = 'button' | 'submit' | 'reset';

/**
 * Reusable button with variants and a built-in loading state.
 * Presentational: it emits a `clicked` event and lets the parent decide behavior.
 */
@Component({
  selector: 'app-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SpinnerComponent],
  template: `
    <button
      [type]="type()"
      class="btn btn--{{ variant() }}"
      [disabled]="disabled() || loading()"
      [attr.aria-busy]="loading() ? 'true' : null"
      (click)="clicked.emit()"
    >
      @if (loading()) {
        <app-spinner [size]="16" [borderWidth]="2" />
      }
      <ng-content />
    </button>
  `,
  styleUrl: './button.component.scss',
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly type = input<ButtonType>('button');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly clicked = output<void>();
}
