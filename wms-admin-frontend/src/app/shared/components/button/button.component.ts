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
      [class]="'btn btn--' + variant()"
      [disabled]="disabled() || loading()"
      (click)="clicked.emit()"
    >
      @if (loading()) {
        <app-spinner [size]="16" [borderWidth]="2" />
      }
      <ng-content />
    </button>
  `,
  styles: [
    `
      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.6rem 1.1rem;
        font-size: 0.9rem;
        font-weight: 600;
        border-radius: 8px;
        border: 1px solid transparent;
        cursor: pointer;
        transition: background 0.15s ease, opacity 0.15s ease;
      }
      .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .btn--primary {
        background: var(--color-primary, #2563eb);
        color: #fff;
      }
      .btn--primary:hover:not(:disabled) {
        background: var(--color-primary-dark, #1d4ed8);
      }
      .btn--secondary {
        background: var(--color-surface, #fff);
        color: var(--color-text, #0f172a);
        border-color: var(--color-border, #e2e8f0);
      }
      .btn--danger {
        background: var(--color-danger, #dc2626);
        color: #fff;
      }
      .btn--ghost {
        background: transparent;
        color: var(--color-text-muted, #64748b);
      }
      .btn--ghost:hover:not(:disabled) {
        background: var(--color-hover, #f1f5f9);
      }
    `,
  ],
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly type = input<ButtonType>('button');
  readonly disabled = input(false);
  readonly loading = input(false);
  readonly clicked = output<void>();
}
