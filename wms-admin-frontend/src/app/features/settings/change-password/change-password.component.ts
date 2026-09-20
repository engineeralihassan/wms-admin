import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { CardComponent } from '../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { PasswordVisibilityToggleComponent } from '../../../shared/components/password-visibility-toggle/password-visibility-toggle.component';
import { NotificationService } from '../../../core/services/notification.service';
import {
  firstErrorMessage,
  isControlInvalid,
  markAllAsTouched,
} from '../../../shared/utils/form.utils';
import { SettingsService } from '../services/settings.service';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  return group.get('new_password')?.value === group.get('confirm')?.value
    ? null
    : { mismatch: true };
}

function newIsDifferent(group: AbstractControl): ValidationErrors | null {
  const current = group.get('current_password')?.value;
  const next = group.get('new_password')?.value;
  return current && next && current === next ? { sameAsCurrent: true } : null;
}

type PasswordField = 'current_password' | 'new_password' | 'confirm';

@Component({
  selector: 'app-change-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    PasswordVisibilityToggleComponent,
  ],
  templateUrl: './change-password.component.html',
  styleUrl: './change-password.component.scss',
})
export class ChangePasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly settings = inject(SettingsService);
  private readonly notify = inject(NotificationService);

  protected readonly submitting = signal(false);
  protected readonly visible = signal<Record<PasswordField, boolean>>({
    current_password: false,
    new_password: false,
    confirm: false,
  });

  protected readonly form = this.fb.nonNullable.group(
    {
      current_password: ['', [Validators.required]],
      new_password: [
        '',
        [Validators.required, Validators.minLength(8), Validators.pattern(/^(?=.*[A-Za-z])(?=.*\d).+$/)],
      ],
      confirm: ['', [Validators.required]],
    },
    { validators: [passwordsMatch, newIsDifferent] },
  );

  protected isInvalid(name: PasswordField): boolean {
    return isControlInvalid(this.form.get(name));
  }

  protected errorFor(name: PasswordField, label: string): string {
    const control = this.form.get(name);
    if (name === 'new_password' && control?.hasError('pattern')) {
      return 'Password must contain at least 1 letter and 1 number.';
    }
    return firstErrorMessage(control, label);
  }

  protected get mismatch(): boolean {
    return this.form.hasError('mismatch') && !!this.form.get('confirm')?.touched;
  }

  protected get sameAsCurrent(): boolean {
    return this.form.hasError('sameAsCurrent') && !!this.form.get('new_password')?.touched;
  }

  protected toggleVisibility(field: PasswordField): void {
    this.visible.update((state) => ({ ...state, [field]: !state[field] }));
  }

  protected submit(): void {
    if (this.form.invalid) {
      markAllAsTouched(this.form);
      return;
    }

    const { current_password, new_password } = this.form.getRawValue();
    this.submitting.set(true);
    this.settings.changePassword({ current_password, new_password }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.notify.success('Your password has been changed.');
        this.form.reset({ current_password: '', new_password: '', confirm: '' });
      },
      error: (err) => {
        this.submitting.set(false);
        const message =
          err?.status === 400
            ? err?.error?.message || 'Your current password is incorrect.'
            : 'Could not change your password. Please try again.';
        this.notify.error(message);
      },
    });
  }
}
