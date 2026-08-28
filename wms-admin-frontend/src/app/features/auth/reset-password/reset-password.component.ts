import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { PasswordVisibilityToggleComponent } from '../../../shared/components/password-visibility-toggle/password-visibility-toggle.component';
import { APP_ROUTES } from '../../../core/constants/app-routes';
import { firstErrorMessage, isControlInvalid, markAllAsTouched } from '../../../shared/utils/form.utils';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  return group.get('password')?.value === group.get('confirm')?.value ? null : { mismatch: true };
}

/**
 * Reset-password page. Reads the `token` from the query string (bound via router
 * component input binding) and submits it with the new password to the backend.
 */
@Component({
  selector: 'app-reset-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, PasswordVisibilityToggleComponent],
  templateUrl: './reset-password.component.html',
  styleUrl: '../login/login.component.scss',
})
export class ResetPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);

  /** Bound from ?token=... via withComponentInputBinding(). */
  readonly token = input<string>('');

  protected readonly loginLink = APP_ROUTES.login;
  protected readonly submitting = signal(false);
  protected readonly passwordVisible = signal(false);
  protected readonly confirmVisible = signal(false);

  protected readonly form = this.fb.nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirm: ['', [Validators.required, Validators.minLength(8)]],
    },
    { validators: passwordsMatch },
  );

  protected isInvalid(name: 'password' | 'confirm'): boolean {
    return isControlInvalid(this.form.get(name));
  }

  protected errorFor(name: 'password' | 'confirm', label: string): string {
    return firstErrorMessage(this.form.get(name), label);
  }

  protected get mismatch(): boolean {
    return this.form.hasError('mismatch') && !!this.form.get('confirm')?.touched;
  }

  protected togglePasswordVisibility(field: 'password' | 'confirm'): void {
    (field === 'password' ? this.passwordVisible : this.confirmVisible).update((visible) => !visible);
  }

  protected submit(): void {
    if (this.form.invalid) {
      markAllAsTouched(this.form);
      return;
    }
    if (!this.token()) {
      this.notify.error('Reset link is invalid or missing a token.');
      return;
    }

    this.submitting.set(true);
    this.auth
      .resetPassword({ token: this.token(), password: this.form.getRawValue().password })
      .subscribe({
        next: () => {
          this.notify.success('Password reset. Please sign in.');
          void this.router.navigate([APP_ROUTES.login]);
        },
        error: () => this.submitting.set(false),
      });
  }
}
