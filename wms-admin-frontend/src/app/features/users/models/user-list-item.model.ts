/**
 * User row as returned by the backend list/detail endpoints.
 */
export interface UserListItem {
  id: number;
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  organization_id: number | null;
  manager_id: number | null;
  created_at?: string;
  role?: { key: string; name: string };
  organization?: { id: number; uuid: string; name: string; slug: string };
  // Lightweight profile summary included on list rows.
  job_title?: string | null;
  department?: string | null;
  employee_type?: string | null;
}
