/**
 * Pagination contracts mirroring the backend query layer.
 * The backend responds with { data, meta }; these types describe both strategies.
 */

export type SortDirection = 'asc' | 'desc';

/** Metadata for offset (page-based) pagination. */
export interface OffsetMeta {
  strategy: 'offset';
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  sortBy: string;
  sortDir: SortDirection;
  search?: string;
}

/** Metadata for keyset (cursor) pagination. */
export interface KeysetMeta {
  strategy: 'keyset';
  limit: number;
  hasNext: boolean;
  nextCursor: string | null;
  sortBy: string;
  sortDir: SortDirection;
  search?: string;
}

export type PageMeta = OffsetMeta | KeysetMeta;

/** A page of results plus its metadata. */
export interface PaginatedResult<T> {
  data: T[];
  meta: PageMeta;
}

/** Query params the client sends for a list request. */
export interface ListQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: SortDirection;
  search?: string;
  cursor?: string;
  filters?: Record<string, string | number | boolean>;
}
