import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { APP_ROUTES } from '../../../core/constants/app-routes';
import { firstErrorMessage, isControlInvalid, markAllAsTouched } from '../../../shared/utils/form.utils';

/**
 * Login page. Reactive form -> AuthService.signIn -> redirect to returnUrl or dashboard.
 * Registration is removed (accounts are created by admins), so only a
 * "forgot password" link is offered.
 */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly notify = inject(NotificationService);

  protected readonly forgotLink = APP_ROUTES.forgotPassword;
  protected readonly submitting = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  protected isInvalid(name: 'email' | 'password'): boolean {
    return isControlInvalid(this.form.get(name));
  }

  protected errorFor(name: 'email' | 'password', label: string): string {
    return firstErrorMessage(this.form.get(name), label);
  }

  protected submit(): void {
    if (this.form.invalid) {
      markAllAsTouched(this.form);
      return;
    }

    this.submitting.set(true);
    this.auth.signIn(this.form.getRawValue()).subscribe({
      next: () => {
        this.notify.success('Welcome back!');
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? APP_ROUTES.dashboard;
        void this.router.navigateByUrl(returnUrl);
      },
      error: () => this.submitting.set(false),
    });
  }
}
