import { Injectable, signal } from '@angular/core';
import type { ButtonVariant } from '../../shared/components/button/button.component';

/** Options for a one-off confirmation dialog. */
export interface ConfirmOptions {
  title: string;
  /** Body text (plain string). For rich content, use the <app-modal> component directly. */
  message: string;
  /** Confirm button label. Default: "Confirm". */
  confirmText?: string;
  /** Cancel button label. Default: "Cancel". */
  cancelText?: string;
  /** Confirm button style — use 'danger' for destructive actions. Default: 'primary'. */
  confirmVariant?: ButtonVariant;
}

/** Internal shape of the active confirm request (adds the resolver). */
interface ActiveConfirm extends Required<ConfirmOptions> {
  resolve: (confirmed: boolean) => void;
}

/**
 * App-wide modal/confirmation service.
 *
 * The single global <app-modal-host> (mounted in the root shell) renders whatever
 * request this service exposes. Features never render the confirm dialog themselves;
 * they just await a boolean:
 *
 *     const ok = await this.modal.confirm({
 *       title: 'Delete ticket',
 *       message: 'This cannot be undone.',
 *       confirmText: 'Delete',
 *       confirmVariant: 'danger',
 *     });
 *     if (!ok) return;
 *     // …run the action in the parent component…
 *
 * This keeps the action logic in the calling component (as requested) while the UI
 * lives in one reusable place. For forms or custom content, use the presentational
 * <app-modal> component directly in the feature template.
 */
@Injectable({ providedIn: 'root' })
export class ModalService {
  private readonly _active = signal<ActiveConfirm | null>(null);
  /** The host component reads this to render the current confirm dialog. */
  readonly active = this._active.asReadonly();

  /** Open a confirmation dialog. Resolves true if confirmed, false otherwise. */
  confirm(options: ConfirmOptions): Promise<boolean> {
    // If a dialog is already open, resolve it as cancelled before replacing it.
    this._active()?.resolve(false);

    return new Promise<boolean>((resolve) => {
      this._active.set({
        title: options.title,
        message: options.message,
        confirmText: options.confirmText ?? 'Confirm',
        cancelText: options.cancelText ?? 'Cancel',
        confirmVariant: options.confirmVariant ?? 'primary',
        resolve,
      });
    });
  }

  /** Called by the host when the user confirms. */
  resolve(confirmed: boolean): void {
    const current = this._active();
    if (!current) return;
    this._active.set(null);
    current.resolve(confirmed);
  }
}
