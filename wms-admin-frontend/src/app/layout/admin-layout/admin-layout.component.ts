import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { LoadingService } from '../../core/services/loading.service';
import { APP_ROUTES } from '../../core/constants/app-routes';
import { environment } from '../../../environments/environment';
import { NAV_ITEMS, type NavItem } from './nav-items';

/**
 * Main authenticated shell: sidebar + topbar + routed content.
 * The sidebar is filtered by the user's permissions/roles, so users never see
 * links to areas they can't access.
 */
@Component({
  selector: 'app-admin-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss',
})
export class AdminLayoutComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly loading = inject(LoadingService);

  protected readonly appName = environment.appName;
  protected readonly sidebarOpen = signal(true);

  protected readonly user = this.auth.currentUser;
  protected readonly roleLabel = computed(() => this.user()?.role ?? '');

  /** Nav items the current user is allowed to see (permission/role filtered). */
  protected readonly navItems = computed<NavItem[]>(() => {
    // Read currentUser() so this recomputes when auth state changes.
    this.user();
    return NAV_ITEMS.filter((item) => {
      if (item.roles && !this.auth.hasRole(...item.roles)) return false;
      if (item.permissions && !this.auth.hasAnyPermission(item.permissions)) return false;
      return true;
    });
  });

  protected readonly userInitials = computed(() => {
    const u = this.user();
    if (!u) return '?';
    return `${u.first_name?.[0] ?? ''}${u.last_name?.[0] ?? ''}`.toUpperCase();
  });

  protected toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  protected logout(): void {
    // Clear locally and navigate immediately; the API revoke is best-effort.
    this.auth.logout().subscribe({
      next: () => this.goToLogin(),
      error: () => this.goToLogin(),
    });
  }

  private goToLogin(): void {
    void this.router.navigate([APP_ROUTES.login]);
  }
}
