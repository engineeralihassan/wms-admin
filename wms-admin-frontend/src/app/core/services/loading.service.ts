import { Injectable, computed, signal } from '@angular/core';

/**
 * Global loading indicator state.
 *
 * Uses a reference-count so concurrent requests don't prematurely hide the spinner.
 * The loading interceptor calls show()/hide() around HTTP calls; the layout renders
 * a bar/overlay based on `isLoading()`.
 */
@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly pending = signal(0);
  readonly isLoading = computed(() => this.pending() > 0);

  show(): void {
    this.pending.update((n) => n + 1);
  }

  hide(): void {
    this.pending.update((n) => Math.max(0, n - 1));
  }
}
