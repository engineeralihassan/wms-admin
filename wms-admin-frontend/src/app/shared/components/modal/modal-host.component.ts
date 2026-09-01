import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ModalService } from '../../../core/services/modal.service';
import { ModalComponent } from './modal.component';
import { ButtonComponent } from '../button/button.component';

/**
 * Global renderer for ModalService confirmation dialogs.
 *
 * Mount ONCE in the root shell (alongside <app-toast>). It watches
 * ModalService.active() and renders the reusable <app-modal> shell for whatever
 * confirmation is currently requested. Confirm/cancel resolve the promise the
 * caller is awaiting — so the actual action stays in the calling component.
 */
@Component({
  selector: 'app-modal-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ButtonComponent],
  template: `
    @if (modal.active(); as confirm) {
      <app-modal
        [open]="true"
        size="sm"
        [title]="confirm.title"
        (closed)="cancel()"
      >
        <p class="modal-host__message">{{ confirm.message }}</p>
        <div modal-footer>
          <app-button variant="ghost" (clicked)="cancel()">
            {{ confirm.cancelText }}
          </app-button>
          <app-button [variant]="confirm.confirmVariant" (clicked)="accept()">
            {{ confirm.confirmText }}
          </app-button>
        </div>
      </app-modal>
    }
  `,
  styles: [
    `
      .modal-host__message {
        margin: 0;
        color: var(--color-text);
        font-size: 0.875rem;
        line-height: 1.5;
      }
    `,
  ],
})
export class ModalHostComponent {
  protected readonly modal = inject(ModalService);

  protected accept(): void {
    this.modal.resolve(true);
  }

  protected cancel(): void {
    this.modal.resolve(false);
  }
}
