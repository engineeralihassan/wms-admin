import { DestroyRef, Injectable, inject, signal, type Signal } from '@angular/core';

/**
 * App layout breakpoints (px). Mirrors the SCSS `$breakpoints` map so the TS-side
 * responsive logic and the stylesheet stay in agreement.
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

/**
 * Reactive viewport-size helper.
 *
 * Wraps `window.matchMedia` behind a signal so components can react to breakpoint
 * changes declaratively (in templates or `computed`/`effect`) instead of wiring up
 * listeners themselves. A single `matchMedia` query per breakpoint is the source of
 * truth — no duplicated `innerWidth` comparisons — and the listener is torn down with
 * the injecting context via `DestroyRef`.
 *
 * SSR-safe: when `window` is unavailable it reports `false` and never touches the DOM.
 */
@Injectable({ providedIn: 'root' })
export class BreakpointService {
  private readonly destroyRef = inject(DestroyRef);

  // Declared BEFORE any field that calls below() — fields initialize top-to-bottom, and
  // below() reads this map, so it must exist first (else `this.queries` is undefined).
  private readonly queries = new Map<BreakpointKey, Signal<boolean>>();

  /**
   * True while the sidebar should act as an overlay drawer. Uses the `lg` breakpoint
   * (1024px): between md and lg the 240px sidebar + content grid is too tight and the
   * page overflows sideways, so tablets get the drawer treatment too.
   */
  readonly isMobile = this.below('lg');

  /**
   * A signal that is true while the viewport width is below `key`.
   * Cached per breakpoint so repeated calls share one media-query listener.
   */
  below(key: BreakpointKey): Signal<boolean> {
    const cached = this.queries.get(key);
    if (cached) return cached;

    const state = signal(false);
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      // `max-width` is inclusive-exclusive; subtract a hair so it flips exactly AT the
      // breakpoint, matching the SCSS `respond-below` mixin.
      const mql = window.matchMedia(`(max-width: ${BREAKPOINTS[key] - 0.02}px)`);
      state.set(mql.matches);
      const onChange = (e: MediaQueryListEvent) => state.set(e.matches);
      mql.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => mql.removeEventListener('change', onChange));
    }

    const readonlySignal = state.asReadonly();
    this.queries.set(key, readonlySignal);
    return readonlySignal;
  }
}
