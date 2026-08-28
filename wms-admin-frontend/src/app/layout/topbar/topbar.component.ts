import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { User } from '../../core/models';

type DropdownPanel = 'none' | 'notifications' | 'messages' | 'user';

/**
 * Application top bar for the authenticated shell.
 *
 * Right section shows three actions: messages, notifications, and an avatar-only
 * user menu. Each opens an accessible dropdown; a shared backdrop closes them on
 * outside click. Presentational: it takes the current user as input and emits
 * `toggleSidebar` / `logout` for the parent shell to handle.
 */
@Component({
  selector: 'app-topbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.scss',
})
export class TopbarComponent {
  /** Current authenticated user (null while loading). */
  readonly user = input<User | null>(null);
  /** Whether the sidebar is currently expanded (drives aria-expanded). */
  readonly sidebarOpen = input(true);

  readonly toggleSidebar = output<void>();
  readonly logout = output<void>();

  protected readonly openPanel = signal<DropdownPanel>('none');

  protected readonly userInitials = computed(() => {
    const u = this.user();
    if (!u) return '?';
    return `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.toUpperCase();
  });

  protected readonly roleLabel = computed(() => (this.user()?.role ?? '').replace(/_/g, ' '));

  protected togglePanel(panel: DropdownPanel): void {
    this.openPanel.update((current) => (current === panel ? 'none' : panel));
  }

  protected closePanel(): void {
    this.openPanel.set('none');
  }

  protected onLogout(): void {
    this.closePanel();
    this.logout.emit();
  }
}
