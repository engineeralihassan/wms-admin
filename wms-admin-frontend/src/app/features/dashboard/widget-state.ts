import { signal, type WritableSignal } from '@angular/core';

/**
 * An independent dashboard widget's async state: its data, a loading flag, and an
 * error flag. Each widget on the page owns one of these so it can render its own
 * loader / content / error-with-retry without coupling to any other widget's request.
 */
export interface Widget<T> {
  data: WritableSignal<T | null>;
  loading: WritableSignal<boolean>;
  error: WritableSignal<boolean>;
}

/** Create a fresh widget state (starts in the loading state — first fetch is in flight). */
export function createWidget<T>(): Widget<T> {
  return {
    data: signal<T | null>(null),
    loading: signal<boolean>(true),
    error: signal<boolean>(false),
  };
}
