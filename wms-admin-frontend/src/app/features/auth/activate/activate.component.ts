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
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { PasswordVisibilityToggleComponent } from '../../../shared/components/password-visibility-toggle/password-visibility-toggle.component';
import { APP_ROUTES } from '../../../core/constants/app-routes';
import { firstErrorMessage, isControlInvalid, markAllAsTouched } from '../../../shared/utils/form.utils';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  return group.get('password')?.value === group.get('confirm')?.value ? null : { mismatch: true };
}

type Phase = 'verifying' | 'ready' | 'invalid';

/**
 * Account activation page (invite flow). Reads ?token, verifies it, and either
 * shows the set-password form (valid) or a friendly "link invalid/expired" state.
 * On success the account is activated and the user is sent to sign in.
 */
@Component({
  selector: 'app-activate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, SpinnerComponent, PasswordVisibilityToggleComponent],
  templateUrl: './activate.component.html',
  styleUrl: '../login/login.component.scss',
})
export class ActivateComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);

  /** Bound from ?token=... via withComponentInputBinding(). */
  readonly token = input<string>('');

  protected readonly loginLink = APP_ROUTES.login;
  protected readonly phase = signal<Phase>('verifying');
  protected readonly submitting = signal(false);
  protected readonly firstName = signal('');
  protected readonly passwordVisible = signal(false);
  protected readonly confirmVisible = signal(false);

  protected readonly form = this.fb.nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirm: ['', [Validators.required, Validators.minLength(8)]],
    },
    { validators: passwordsMatch },
  );

  constructor() {
    queueMicrotask(() => this.verify());
  }

  private verify(): void {
    if (!this.token()) {
      this.phase.set('invalid');
      return;
    }
    this.auth.verifyActivation(this.token()).subscribe({
      next: (info) => {
        this.firstName.set(info.firstName);
        this.phase.set('ready');
      },
      error: () => this.phase.set('invalid'),
    });
  }

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
    this.submitting.set(true);
    this.auth.activate({ token: this.token(), password: this.form.getRawValue().password }).subscribe({
      next: () => {
        this.notify.success('Account activated. Please sign in.');
        void this.router.navigate([APP_ROUTES.login]);
      },
      error: () => this.submitting.set(false),
    });
  }
}
