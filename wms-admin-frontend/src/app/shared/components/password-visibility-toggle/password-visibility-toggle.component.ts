import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Accessible, reusable visibility control for password inputs. */
@Component({
  selector: 'app-password-visibility-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      class="password-toggle"
      type="button"
      [attr.aria-label]="visible() ? 'Hide password' : 'Show password'"
      [attr.aria-pressed]="visible()"
      (click)="toggled.emit()"
    >
      @if (visible()) {
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 5.1A10.8 10.8 0 0 1 12 5c5.1 0 8.7 4.4 9.7 7-0.4 1.1-1.3 2.5-2.7 3.7M6.2 6.2C4.2 7.6 2.9 10 2.3 12c1 2.6 4.6 7 9.7 7 1.6 0 3-.4 4.2-1" /></svg>
      } @else {
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M2.3 12S5.9 5 12 5s9.7 7 9.7 7-3.6 7-9.7 7S2.3 12 2.3 12Z" /><circle cx="12" cy="12" r="3" /></svg>
      }
      <span class="visually-hidden">{{ visible() ? 'Hide password' : 'Show password' }}</span>
    </button>
  `,
  styleUrl: './password-visibility-toggle.component.scss',
})
export class PasswordVisibilityToggleComponent {
  readonly visible = input(false);
  readonly toggled = output<void>();
}
