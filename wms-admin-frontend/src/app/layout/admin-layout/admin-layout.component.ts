import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { LoadingService } from '../../core/services/loading.service';
import { BreakpointService } from '../../core/layout/breakpoint';
import { APP_ROUTES } from '../../core/constants/app-routes';
import { environment } from '../../../environments/environment';
import { NAV_ITEMS, type NavItem } from './nav-items';
import { TopbarComponent } from '../topbar/topbar.component';

@Component({
  selector: 'app-admin-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TopbarComponent],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss',
})
export class AdminLayoutComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breakpoints = inject(BreakpointService);
  protected readonly loading = inject(LoadingService);

  protected readonly appName = environment.appName;
  protected readonly user = this.auth.currentUser;
  protected readonly isMobile = this.breakpoints.isMobile;
  protected readonly sidebarOpen = signal(!this.isMobile());

  /** Nav items the current user is allowed to see (permission/role filtered). */
  protected readonly navItems = computed<NavItem[]>(() =>
    NAV_ITEMS.filter((item) => {
      if (item.roles && !this.auth.hasRole(...item.roles)) return false;
      if (item.permissions && !this.auth.hasAnyPermission(item.permissions)) return false;
      return true;
    }),
  );

  constructor() {
    effect(() => this.sidebarOpen.set(!this.isMobile()));
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (this.isMobile()) this.sidebarOpen.set(false);
      });
  }

  protected toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  protected closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  protected logout(): void {
    this.auth.logout().subscribe({
      next: () => this.goToLogin(),
      error: () => this.goToLogin(),
    });
  }

  private goToLogin(): void {
    void this.router.navigate([APP_ROUTES.login]);
  }
}
