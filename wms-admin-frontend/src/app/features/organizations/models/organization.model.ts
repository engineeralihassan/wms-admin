/** Organization row as returned by the backend. */
export interface Organization {
  id: number;
  uuid: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at?: string;
}

/** Payload to create an organization + its first admin. */
export interface CreateOrganizationRequest {
  name: string;
  admin: {
    first_name: string;
    last_name: string;
    email: string;
    password: string;
  };
}
