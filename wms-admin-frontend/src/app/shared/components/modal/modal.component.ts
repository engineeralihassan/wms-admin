import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

export type ModalSize = 'sm' | 'md' | 'lg';

/**
 * Presentational, accessible modal shell.
 *
 * It owns NO business logic and fetches nothing — it just renders an overlay with
 * a titled dialog and projects arbitrary content. Use it two ways:
 *
 *  1. Declaratively in a feature template, wrapping any content (a form, a detail
 *     panel, a custom component):
 *
 *       <app-modal [open]="showForm()" title="Edit ticket" (closed)="showForm.set(false)">
 *         <form>…</form>
 *         <div modal-footer>
 *           <app-button variant="ghost" (clicked)="showForm.set(false)">Cancel</app-button>
 *           <app-button (clicked)="save()">Save</app-button>
 *         </div>
 *       </app-modal>
 *
 *  2. Indirectly via ModalService/ModalHost for one-off confirmations.
 *
 * Accessibility: role="dialog" + aria-modal, labelled by the title, Escape closes,
 * clicking the backdrop closes (configurable), and focus is moved into the dialog
 * on open and restored to the previously-focused element on close.
 */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.scss',
})
export class ModalComponent {
  /** Whether the modal is visible. */
  readonly open = input(false);
  readonly title = input('');
  readonly size = input<ModalSize>('md');
  /** Show the top-right close (×) button. */
  readonly showClose = input(true);
  /** Close when the backdrop (area outside the dialog) is clicked. */
  readonly closeOnBackdrop = input(true);
  /** Close when Escape is pressed. */
  readonly closeOnEscape = input(true);

  /** Emitted whenever the user requests to close (×, backdrop, or Escape). */
  readonly closed = output<void>();

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private previouslyFocused: HTMLElement | null = null;

  constructor() {
    // Manage focus as the modal opens/closes for keyboard + screen-reader users.
    effect(() => {
      const isOpen = this.open();
      if (isOpen) {
        this.previouslyFocused = document.activeElement as HTMLElement | null;
        // Defer until the dialog is rendered, then focus it.
        queueMicrotask(() => this.focusDialog());
      } else if (this.previouslyFocused) {
        this.previouslyFocused.focus?.();
        this.previouslyFocused = null;
      }
    });
  }

  protected requestClose(): void {
    this.closed.emit();
  }

  protected onBackdropClick(): void {
    if (this.closeOnBackdrop()) this.requestClose();
  }

  protected onEscape(event: Event): void {
    if (this.closeOnEscape() && this.open()) {
      event.stopPropagation();
      this.requestClose();
    }
  }

  /**
   * Minimal focus trap: keep Tab focus within the dialog. Not a full trap library,
   * but covers the common case (buttons/inputs inside the dialog) accessibly.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const focusables = this.focusableElements();
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusDialog(): void {
    const focusables = this.focusableElements();
    (focusables[0] ?? this.dialog()?.nativeElement)?.focus();
  }

  private focusableElements(): HTMLElement[] {
    const root = this.dialog()?.nativeElement;
    if (!root) return [];
    const selector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => el.offsetParent !== null || el === root,
    );
  }
}
