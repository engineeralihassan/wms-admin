import { AbstractControl, FormGroup } from '@angular/forms';

/**
 * Small helpers for reactive-form ergonomics used across feature forms.
 */

/** True when a control is invalid AND the user has interacted with it. */
export function isControlInvalid(control: AbstractControl | null): boolean {
  return !!control && control.invalid && (control.dirty || control.touched);
}

/** Marks every control in a group as touched (used to reveal errors on submit). */
export function markAllAsTouched(form: FormGroup): void {
  Object.values(form.controls).forEach((control) => control.markAsTouched());
}

/** Maps a control's first error to a human-readable message. */
export function firstErrorMessage(control: AbstractControl | null, label = 'This field'): string {
  if (!control || !control.errors) return '';
  const errors = control.errors;
  if (errors['required']) return `${label} is required.`;
  if (errors['email']) return 'Enter a valid email address.';
  if (errors['minlength']) {
    return `${label} must be at least ${errors['minlength'].requiredLength} characters.`;
  }
  if (errors['mismatch']) return 'Passwords do not match.';
  return `${label} is invalid.`;
}
