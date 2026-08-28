import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { environment } from '../../../environments/environment';

/**
 * Shell for unauthenticated pages (login, forgot/reset password).
 * A centered card on a branded background; the routed page renders in <router-outlet>.
 */
@Component({
  selector: 'app-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `
    <main class="auth">
      <div class="auth__panel">
        <div class="auth__brand">{{ appName }}</div>
        <router-outlet />
      </div>
    </main>
  `,
  styleUrl: './auth-layout.component.scss',
})
export class AuthLayoutComponent {
  protected readonly appName = environment.appName;
}
