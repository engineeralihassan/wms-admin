/**
 * Authenticated user, mirroring the backend's sanitized user shape.
 * The backend now returns role + permissions + organization_id on login and /auth/me.
 */
export interface User {
  id: number;
  uuid: string;
  email: string;
  first_name: string;
  last_name: string;
  /** Organization the user belongs to; null for the platform super admin. */
  organization_id: number | null;
  /** Role key, e.g. 'super_admin', 'org_admin', 'vendor', 'consultant_1099'. */
  role: string;
  /** Flat list of permission keys granted to this user, e.g. 'user.create'. */
  permissions: string[];
}
