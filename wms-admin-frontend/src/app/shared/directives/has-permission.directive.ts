import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Structural directive that renders its element only if the current user has the
 * required permission(s). Use it to hide buttons/menu items a user can't use:
 *
 *   <button *appHasPermission="'user.create'">Add user</button>
 *   <a *appHasPermission="['user.read','user.update']">Manage</a>   (ANY of)
 *
 * Reactive: it re-evaluates when the user's permissions change (login/logout),
 * because it reads the AuthService signals inside an effect().
 *
 * NOTE: this is a UX affordance only. Never rely on it for security — the backend
 * authorizes every request regardless of what the UI shows.
 */
@Directive({
  selector: '[appHasPermission]',
})
export class HasPermissionDirective {
  private readonly auth = inject(AuthService);
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);

  /** A single permission string or an array (ANY-of semantics). */
  readonly appHasPermission = input.required<string | string[]>();

  private hasView = false;

  constructor() {
    effect(() => {
      const required = this.appHasPermission();
      const perms = Array.isArray(required) ? required : [required];
      const allowed = this.auth.hasAnyPermission(perms);

      if (allowed && !this.hasView) {
        this.viewContainer.createEmbeddedView(this.templateRef);
        this.hasView = true;
      } else if (!allowed && this.hasView) {
        this.viewContainer.clear();
        this.hasView = false;
      }
    });
  }
}
