import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { CardComponent } from '../../shared/components/card/card.component';

interface StatCard {
  label: string;
  value: string;
  hint: string;
}

/**
 * Dashboard landing page shown after login.
 * Currently renders a welcome + placeholder stat cards; real metrics will come
 * from feature APIs as the backend grows.
 */
@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  private readonly auth = inject(AuthService);

  protected readonly greeting = computed(() => {
    const user = this.auth.currentUser();
    return user ? `Welcome back, ${user.first_name}` : 'Welcome';
  });

  // Placeholder metrics — replace with live data once endpoints exist.
  protected readonly stats: readonly StatCard[] = [
    { label: 'Total Users', value: '—', hint: 'Registered admins' },
    { label: 'Active Sessions', value: '—', hint: 'Currently logged in' },
    { label: 'Warehouses', value: '—', hint: 'Coming soon' },
    { label: 'Orders Today', value: '—', hint: 'Coming soon' },
  ];
}
