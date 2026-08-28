import { computed, signal } from '@angular/core';
import { Observable, Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef, inject } from '@angular/core';
import type { ListQuery, PaginatedResult, SortDirection } from '../../core/models/pagination.model';

export interface ListStateOptions {
  /** Initial page size. */
  limit?: number;
  /** Initial sort column. */
  sortBy?: string;
  /** Initial sort direction. */
  sortDir?: SortDirection;
  /** Debounce (ms) applied to search input before hitting the API. */
  searchDebounceMs?: number;
}

/**
 * Reusable, signals-based list controller for search + sort + pagination.
 *
 * A feature component creates one of these, passing a `fetcher` that maps a ListQuery
 * to the API call. The state exposes signals (items, meta, loading, page, sort, search)
 * and imperative methods (setPage, setSearch, toggleSort, reload). Search is debounced
 * and requests are switch-mapped so stale responses can't overwrite newer ones.
 *
 * This keeps every list screen thin: no component re-implements paging logic.
 *
 * Usage:
 *   readonly list = createListState<UserDto>(
 *     (q) => this.usersService.list(q),
 *     { sortBy: 'created_at', sortDir: 'desc' },
 *   );
 */
export function createListState<T>(
  fetcher: (query: ListQuery) => Observable<PaginatedResult<T>>,
  options: ListStateOptions = {},
) {
  const destroyRef = inject(DestroyRef);

  const items = signal<T[]>([]);
  const total = signal(0);
  const totalPages = signal(1);
  const loading = signal(false);

  const page = signal(1);
  const limit = signal(options.limit ?? 20);
  const sortBy = signal(options.sortBy ?? 'created_at');
  const sortDir = signal<SortDirection>(options.sortDir ?? 'desc');
  const search = signal('');
  const filters = signal<Record<string, string>>({});

  const hasNext = computed(() => page() < totalPages());
  const hasPrev = computed(() => page() > 1);
  const isEmpty = computed(() => !loading() && items().length === 0);

  // A trigger stream: every state change pushes the current query; switchMap ensures
  // only the latest in-flight request wins (no race between fast successive changes).
  const trigger$ = new Subject<ListQuery>();

  trigger$
    .pipe(
      debounceTime(0), // microtask coalesce; search adds its own debounce below
      switchMap((query) => {
        loading.set(true);
        return fetcher(query).pipe(
          catchError(() => of({ data: [], meta: null } as unknown as PaginatedResult<T>)),
        );
      }),
      takeUntilDestroyed(destroyRef),
    )
    .subscribe((result) => {
      items.set(result.data ?? []);
      const meta = result.meta;
      if (meta && meta.strategy === 'offset') {
        total.set(meta.total);
        totalPages.set(meta.totalPages);
      }
      loading.set(false);
    });

  // Search debouncing: feed a separate subject so typing doesn't spam the API.
  const searchInput$ = new Subject<string>();
  searchInput$
    .pipe(
      debounceTime(options.searchDebounceMs ?? 350),
      distinctUntilChanged(),
      takeUntilDestroyed(destroyRef),
    )
    .subscribe((value) => {
      search.set(value);
      page.set(1); // new search resets to first page
      emit();
    });

  function currentQuery(): ListQuery {
    return {
      page: page(),
      limit: limit(),
      sortBy: sortBy(),
      sortDir: sortDir(),
      search: search() || undefined,
      filters: Object.keys(filters()).length ? filters() : undefined,
    };
  }

  function emit(): void {
    trigger$.next(currentQuery());
  }

  return {
    // signals
    items,
    total,
    totalPages,
    loading,
    page,
    limit,
    sortBy,
    sortDir,
    search,
    filters,
    hasNext,
    hasPrev,
    isEmpty,

    /** Load the first page (call once from the component). */
    init(): void {
      emit();
    },

    setPage(next: number): void {
      if (next < 1) return;
      page.set(next);
      emit();
    },

    nextPage(): void {
      if (page() < totalPages()) this.setPage(page() + 1);
    },

    prevPage(): void {
      if (page() > 1) this.setPage(page() - 1);
    },

    setLimit(next: number): void {
      limit.set(next);
      page.set(1);
      emit();
    },

    /** Toggle sort on a column: same column flips direction, new column starts desc. */
    toggleSort(column: string): void {
      if (sortBy() === column) {
        sortDir.set(sortDir() === 'asc' ? 'desc' : 'asc');
      } else {
        sortBy.set(column);
        sortDir.set('asc');
      }
      page.set(1);
      emit();
    },

    /** Pipe raw search input here (debounced internally). */
    onSearch(value: string): void {
      searchInput$.next(value);
    },


    setFilter(key: string, value: string): void {
      filters.update((current) => {
        const next = { ...current };
        if (value === '') delete next[key];
        else next[key] = value;
        return next;
      });
      page.set(1);
      emit();
    },

    reload(): void {
      emit();
    },
  };
}

export type ListState<T> = ReturnType<typeof createListState<T>>;
