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
        <div class="toast toast--{{ n.type }}" role="alert">
          <span class="toast__message">{{ n.message }}</span>
          <button class="toast__close" type="button" (click)="notify.dismiss(n.id)" aria-label="Dismiss">
            &times;
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toast-stack {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 360px;
      }
      .toast {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        color: #fff;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: slide-in 0.2s ease;
      }
      .toast--success { background: #16a34a; }
      .toast--error { background: #dc2626; }
      .toast--info { background: #2563eb; }
      .toast--warning { background: #d97706; }
      .toast__message { font-size: 0.875rem; }
      .toast__close {
        background: none;
        border: none;
        color: inherit;
        font-size: 1.25rem;
        line-height: 1;
        cursor: pointer;
      }
      @keyframes slide-in {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `,
  ],
})
export class ToastComponent {
  protected readonly notify = inject(NotificationService);
}
