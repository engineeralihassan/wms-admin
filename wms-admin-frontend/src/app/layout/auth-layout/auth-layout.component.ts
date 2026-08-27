import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { environment } from '../../../environments/environment';

/**
 * Shell for unauthenticated pages (login, register).
 * A centered card on a branded background; the routed page renders in <router-outlet>.
 */
@Component({
  selector: 'app-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `
    <div class="auth">
      <div class="auth__panel">
        <div class="auth__brand">{{ appName }}</div>
        <router-outlet />
      </div>
    </div>
  `,
  styles: [
    `
      .auth {
        min-height: 100dvh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
        background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
      }
      .auth__panel {
        width: 100%;
        max-width: 420px;
        background: #fff;
        border-radius: 16px;
        padding: 2.25rem;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
      }
      .auth__brand {
        font-size: 1.5rem;
        font-weight: 700;
        color: #1e3a8a;
        text-align: center;
        margin-bottom: 1.75rem;
      }
    `,
  ],
})
export class AuthLayoutComponent {
  protected readonly appName = environment.appName;
}
