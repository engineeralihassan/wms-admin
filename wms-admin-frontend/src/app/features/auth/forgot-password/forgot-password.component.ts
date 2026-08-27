import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { APP_ROUTES } from '../../../core/constants/app-routes';
import { firstErrorMessage, isControlInvalid, markAllAsTouched } from '../../../shared/utils/form.utils';

/**
 * Forgot-password page. Submits an email; the backend always responds success
 * (no user enumeration) and enqueues a reset email if the account exists.
 */
@Component({
  selector: 'app-forgot-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent],
  templateUrl: './forgot-password.component.html',
  styleUrl: '../login/login.component.scss',
})
export class ForgotPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);

  protected readonly loginLink = APP_ROUTES.login;
  protected readonly submitting = signal(false);
  protected readonly sent = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected isInvalid(): boolean {
    return isControlInvalid(this.form.get('email'));
  }

  protected errorFor(): string {
    return firstErrorMessage(this.form.get('email'), 'Email');
  }

  protected submit(): void {
    if (this.form.invalid) {
      markAllAsTouched(this.form);
      return;
    }
    this.submitting.set(true);
    this.auth.forgotPassword(this.form.getRawValue()).subscribe({
      next: () => {
        this.sent.set(true);
        this.notify.success('If that email exists, a reset link has been sent.');
      },
      error: () => this.submitting.set(false),
    });
  }
}
