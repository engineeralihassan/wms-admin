import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NotificationService } from '../../../core/services/notification.service';

/**
 * Renders the app-wide toast notifications from NotificationService.
 * Place once in the root shell so toasts appear over any screen.
 */
@Component({
  selector: 'app-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toast-stack" aria-live="polite" aria-atomic="true">
      @for (n of notify.notifications(); track n.id) {
        <div
          class="toast toast--{{ n.type }}"
          [attr.role]="n.type === 'error' ? 'alert' : 'status'"
        >
          <span class="toast__message">{{ n.message }}</span>
          <button
            class="toast__close"
            type="button"
            (click)="notify.dismiss(n.id)"
            aria-label="Dismiss notification"
          >
            &times;
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './toast.component.scss',
})
export class ToastComponent {
  protected readonly notify = inject(NotificationService);
}
