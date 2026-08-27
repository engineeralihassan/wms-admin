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
  role?: { key: string; name: string };
}
