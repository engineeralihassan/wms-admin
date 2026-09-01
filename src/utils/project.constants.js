/**
 * Project domain constants — single source of truth shared by the model,
 * validation, and query layers (mirrors ticket.constants / expense.constants).
 */

/** Lifecycle of a project. */
const PROJECT_STATUSES = Object.freeze({
  PLANNED: 'planned',
  ACTIVE: 'active',
  ON_HOLD: 'on_hold',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  ARCHIVED: 'archived',
});

/** Business priority of a project. */
const PROJECT_PRIORITIES = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});

/**
 * A member's role WITHIN a project (distinct from their org-level RBAC role).
 *  - manager: can be treated as the project lead (e.g. approve timesheets later).
 *  - member:  a regular contributor assigned to the project.
 */
const PROJECT_MEMBER_ROLES = Object.freeze({
  MANAGER: 'manager',
  MEMBER: 'member',
});

/**
 * Currencies a project budget can be denominated in. Kept aligned with the expense
 * module so cost roll-ups (timesheets) stay consistent across the platform.
 */
const PROJECT_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD']);

const PROJECT_SORT_FIELDS = Object.freeze([
  'created_at',
  'updated_at',
  'project_code',
  'name',
  'status',
  'priority',
  'start_date',
  'end_date',
]);

module.exports = {
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  PROJECT_MEMBER_ROLES,
  PROJECT_CURRENCIES,
  PROJECT_SORT_FIELDS,
};
