import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastComponent } from './shared/components/toast/toast.component';
import { ModalHostComponent } from './shared/components/modal/modal-host.component';

/**
 * Root shell. Hosts the routed views, the global toast container, and the global
 * modal/confirmation host. All real UI lives in the layout shells (admin/auth)
 * selected by the router.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ToastComponent, ModalHostComponent],
  template: `
    <router-outlet />
    <app-toast />
    <app-modal-host />
  `,
})
export class App {}
