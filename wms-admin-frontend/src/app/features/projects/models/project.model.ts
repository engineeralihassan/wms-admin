/**
 * Project domain types + constants for the projects feature.
 * These mirror the backend contract (name/status/priority, creator/lead, members).
 */

/** Project permission keys (must match backend config/rbac.js). */
export const PROJECT_PERMISSIONS = {
  create: 'project.create',
  read: 'project.read',
  update: 'project.update',
  delete: 'project.delete',
  /** The manager capability: see all org projects + add/remove members + set lead. */
  manage: 'project.manage',
} as const;

export const PROJECT_STATUSES = [
  'planned',
  'active',
  'on_hold',
  'completed',
  'cancelled',
  'archived',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_PRIORITIES = ['low', 'medium', 'high'] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];

/** A member's role WITHIN a project (distinct from their org-level RBAC role). */
export const PROJECT_MEMBER_ROLES = ['manager', 'member'] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export const PROJECT_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'] as const;
export type ProjectCurrency = (typeof PROJECT_CURRENCIES)[number];

/** A lightweight user reference embedded on a project (creator / lead / member). */
export interface ProjectUser {
  uuid: string;
  first_name: string;
  last_name: string;
  email: string;
}

/** Project row as returned by the backend list/detail endpoints. */
export interface Project {
  uuid: string;
  project_code: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  start_date: string | null;
  end_date: string | null;
  budget: string | number | null;
  currency: ProjectCurrency | null;
  /** Number of members on the project (server-computed). */
  member_count?: number;
  created_at?: string;
  updated_at?: string;
  created_by: ProjectUser | null;
  lead: ProjectUser | null;
  organization?: { uuid: string; name: string; slug: string };
}

/** A project membership row (join + its user) as returned by the members endpoint. */
export interface ProjectMember {
  uuid: string;
  member_role: ProjectMemberRole;
  added_at?: string;
  user: ProjectUser | null;
}

/** Payload to create a project. */
export interface CreateProjectRequest {
  name: string;
  description?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  start_date?: string | null;
  end_date?: string | null;
  budget?: number | null;
  currency?: ProjectCurrency | null;
  /** Optional initial members (user uuids). */
  member_user_uuids?: string[];
}

/** Payload to update project fields. */
export interface UpdateProjectRequest {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  start_date?: string | null;
  end_date?: string | null;
  budget?: number | null;
  currency?: ProjectCurrency | null;
  /** Set a member as the project lead, or null to clear. */
  lead_user_uuid?: string | null;
}

/** Payload to add members to a project. */
export interface AddMembersRequest {
  user_uuids: string[];
  member_role?: ProjectMemberRole;
}

/** Human labels for enum values (UI display only). */
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
  archived: 'Archived',
};

export const PRIORITY_LABELS: Record<ProjectPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const MEMBER_ROLE_LABELS: Record<ProjectMemberRole, string> = {
  manager: 'Manager',
  member: 'Member',
};
