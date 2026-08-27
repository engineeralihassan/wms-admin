import { Injectable, signal } from '@angular/core';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface Notification {
  id: number;
  type: NotificationType;
  message: string;
}

/**
 * App-wide toast/notification store.
 *
 * Components (e.g. a toast container in the layout) render `notifications()`.
 * Any service can push a message via success()/error()/etc. Auto-dismisses.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly _notifications = signal<Notification[]>([]);
  /** Read-only signal for templates to consume. */
  readonly notifications = this._notifications.asReadonly();

  private nextId = 0;
  private readonly autoDismissMs = 4000;

  success(message: string): void {
    this.push('success', message);
  }

  error(message: string): void {
    this.push('error', message);
  }

  info(message: string): void {
    this.push('info', message);
  }

  warning(message: string): void {
    this.push('warning', message);
  }

  dismiss(id: number): void {
    this._notifications.update((list) => list.filter((n) => n.id !== id));
  }

  private push(type: NotificationType, message: string): void {
    const id = ++this.nextId;
    this._notifications.update((list) => [...list, { id, type, message }]);
    setTimeout(() => this.dismiss(id), this.autoDismissMs);
  }
}
