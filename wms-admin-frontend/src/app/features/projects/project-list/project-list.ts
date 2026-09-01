import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ModalService } from '../../../core/services/modal.service';
import { CardComponent } from '../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { ModalComponent } from '../../../shared/components/modal/modal.component';
import {
  DataTableComponent,
  type BadgeVariant,
  type DataTableAction,
  type DataTableColumn,
  type DataTableDateRangeFilter,
  type DataTableFilter,
} from '../../../shared/components/data-table/data-table.component';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { markAllAsTouched } from '../../../shared/utils/form.utils';
import { createListState } from '../../../shared/list/list-state';
import { ProjectsService } from '../services/projects';
import {
  MEMBER_ROLE_LABELS,
  PRIORITY_LABELS,
  PROJECT_CURRENCIES,
  PROJECT_MEMBER_ROLES,
  PROJECT_PERMISSIONS,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  STATUS_LABELS,
  type Project,
  type ProjectMember,
  type ProjectMemberRole,
  type ProjectPriority,
  type ProjectStatus,
  type ProjectUser,
} from '../models/project.model';

/** Which content modal is currently open on this page. */
type OpenModal = 'create' | 'edit' | 'members' | null;

/**
 * Projects list page.
 *
 * Visibility is scoped server-side (org managers see all org projects; normal members
 * see only projects they're assigned to). This page makes the AVAILABLE ACTIONS
 * role-aware (UX only — the backend re-enforces everything). Actions open reusable
 * modals:
 *   - create/edit  -> declarative <app-modal> hosting a small form
 *   - members      -> manage the project's members (add via typeahead, change role, remove)
 *   - delete       -> ModalService.confirm() (shared confirmation)
 */
@Component({
  selector: 'app-project-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    CardComponent,
    ButtonComponent,
    ModalComponent,
    DataTableComponent,
  ],
  templateUrl: './project-list.html',
  styleUrl: './project-list.scss',
})
export class ProjectList {
  private readonly fb = inject(FormBuilder);
  private readonly projects = inject(ProjectsService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly modal = inject(ModalService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly priorityOptions = PROJECT_PRIORITIES;
  protected readonly statusOptions = PROJECT_STATUSES;
  protected readonly currencyOptions = PROJECT_CURRENCIES;
  protected readonly memberRoleOptions = PROJECT_MEMBER_ROLES;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly memberRoleLabels = MEMBER_ROLE_LABELS;

  // ---- Role capabilities (UX gating) ----
  protected readonly canCreate = computed(() =>
    this.auth.hasPermission(PROJECT_PERMISSIONS.create),
  );
  /** Org manager = project.manage; unlocks member management + org-wide edit/delete UX. */
  protected readonly isManager = computed(() =>
    this.auth.hasPermission(PROJECT_PERMISSIONS.manage),
  );
  protected readonly canDelete = computed(() =>
    this.auth.hasPermission(PROJECT_PERMISSIONS.delete),
  );
  private readonly currentUserUuid = computed(() => this.auth.currentUser()?.uuid ?? null);

  protected readonly submitting = signal(false);
  protected readonly searchValue = signal('');

  // ---- Modal state ----
  protected readonly openModal = signal<OpenModal>(null);
  /** The project a row action is operating on (null for create). */
  protected readonly activeProject = signal<Project | null>(null);

  // ---- Members management state ----
  protected readonly members = signal<ProjectMember[]>([]);
  protected readonly membersLoading = signal(false);

  // ---- Add-member typeahead (scoped to the active project's organization) ----
  protected readonly assignableUsers = signal<ProjectUser[]>([]);
  protected readonly memberSearch = signal('');
  protected readonly memberSearchLoading = signal(false);
  protected readonly memberSearchHasMore = signal(false);
  private readonly memberSearch$ = new Subject<string>();

  protected readonly list = createListState<Project>(
    (query) => this.projects.list(query),
    { sortBy: 'created_at', sortDir: 'desc', limit: 10 },
  );

  protected readonly columns: ReadonlyArray<DataTableColumn<Project>> = [
    {
      key: 'project_code',
      label: 'Code',
      sortable: true,
      value: (p) => p.project_code,
      tone: 'code',
    },
    { key: 'name', label: 'Name', sortable: true, value: (p) => p.name },
    { key: 'lead', label: 'Lead', value: (p) => this.userName(p.lead) },
    {
      key: 'member_count',
      label: 'Members',
      value: (p) => String(p.member_count ?? 0),
    },
    {
      key: 'priority',
      label: 'Priority',
      sortable: true,
      value: (p) => this.priorityLabels[p.priority],
      badge: (p) => ({
        label: this.priorityLabels[p.priority],
        variant: this.priorityVariant(p.priority),
      }),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      value: (p) => this.statusLabels[p.status],
      badge: (p) => ({
        label: this.statusLabels[p.status],
        variant: this.statusVariant(p.status),
        dot: true,
      }),
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      value: (p) => this.formatDate(p.created_at),
      tone: 'muted',
    },
  ];

  /** Map a priority to a semantic pill color. */
  private priorityVariant(priority: ProjectPriority): BadgeVariant {
    switch (priority) {
      case 'high':
        return 'danger';
      case 'medium':
        return 'warning';
      case 'low':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  /** Map a status to a semantic pill color. */
  private statusVariant(status: ProjectStatus): BadgeVariant {
    switch (status) {
      case 'planned':
        return 'info';
      case 'active':
        return 'success';
      case 'on_hold':
        return 'warning';
      case 'completed':
        return 'neutral';
      case 'cancelled':
        return 'danger';
      case 'archived':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  protected readonly filters: ReadonlyArray<DataTableFilter> = [
    {
      key: 'status',
      label: 'Status',
      options: [
        { label: 'All statuses', value: '' },
        ...PROJECT_STATUSES.map((s) => ({ label: STATUS_LABELS[s], value: s })),
      ],
    },
    {
      key: 'priority',
      label: 'Priority',
      options: [
        { label: 'All priorities', value: '' },
        ...PROJECT_PRIORITIES.map((p) => ({ label: PRIORITY_LABELS[p], value: p })),
      ],
    },
  ];

  protected readonly dateRangeFilter: DataTableDateRangeFilter = {
    label: 'Created date',
    fromKey: 'created_at_from',
    toKey: 'created_at_to',
  };

  /** Row actions, filtered by capability + per-row policy. */
  protected readonly actions = computed<ReadonlyArray<DataTableAction<Project>>>(() => {
    const acts: DataTableAction<Project>[] = [
      {
        id: 'edit',
        label: 'Edit',
        icon: '✎',
        isDisabled: (p) => !this.canEdit(p),
        disabledLabel: () => 'You can only edit projects you created',
      },
    ];
    if (this.isManager()) {
      acts.push({ id: 'members', label: 'Manage members', icon: '👥' });
    }
    if (this.canDelete()) {
      acts.push({ id: 'delete', label: 'Delete', icon: '🗑', variant: 'danger' });
    }
    return acts;
  });

  // ---- Forms ----
  protected readonly createForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(255)]],
    description: ['', [Validators.maxLength(10000)]],
    status: ['planned' as ProjectStatus, [Validators.required]],
    priority: ['medium' as ProjectPriority, [Validators.required]],
    start_date: [''],
    end_date: [''],
    budget: [null as number | null],
    currency: ['' as '' | (typeof PROJECT_CURRENCIES)[number]],
  });

  protected readonly editForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(255)]],
    description: ['', [Validators.maxLength(10000)]],
    status: ['planned' as ProjectStatus, [Validators.required]],
    priority: ['medium' as ProjectPriority, [Validators.required]],
    start_date: [''],
    end_date: [''],
    budget: [null as number | null],
    currency: ['' as '' | (typeof PROJECT_CURRENCIES)[number]],
  });

  constructor() {
    this.list.init();

    // Debounced, switch-mapped add-member search: only the latest query's results win,
    // and we never fetch the whole directory — just a small page of matches within the
    // project's organization, excluding users already on the project.
    this.memberSearch$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          const project = this.activeProject();
          this.memberSearchLoading.set(true);
          return this.projects.assignableUsers(project!.uuid, {
            search: term || undefined,
            limit: 20,
            sortBy: 'first_name',
            sortDir: 'asc',
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          this.assignableUsers.set(res.data ?? []);
          this.memberSearchHasMore.set(
            res.meta?.strategy === 'offset' ? res.meta.total > res.data.length : false,
          );
          this.memberSearchLoading.set(false);
        },
        error: () => {
          this.memberSearchLoading.set(false);
          this.notify.error('Could not load assignable users.');
        },
      });
  }

  // ---- Per-row policy (mirrors backend) ----
  private canEdit(project: Project): boolean {
    if (this.isManager()) return true;
    return !!project.created_by && project.created_by.uuid === this.currentUserUuid();
  }

  protected userName(user: ProjectUser | null): string {
    return user ? `${user.first_name} ${user.last_name}` : '—';
  }

  protected formatDate(value?: string | null): string {
    return value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
      : '—';
  }

  protected onSearch(value: string): void {
    this.searchValue.set(value);
    this.list.onSearch(value);
  }

  // ---- Open modals ----
  protected openCreate(): void {
    this.createForm.reset({ status: 'planned', priority: 'medium', budget: null, currency: '' });
    this.openModal.set('create');
  }

  protected onAction(event: { actionId: string; row: Project }): void {
    switch (event.actionId) {
      case 'edit':
        this.openEdit(event.row);
        break;
      case 'members':
        this.openMembers(event.row);
        break;
      case 'delete':
        void this.confirmDelete(event.row);
        break;
    }
  }

  private openEdit(project: Project): void {
    this.activeProject.set(project);
    this.editForm.reset({
      name: project.name,
      description: project.description ?? '',
      status: project.status,
      priority: project.priority,
      start_date: project.start_date ?? '',
      end_date: project.end_date ?? '',
      budget: project.budget != null ? Number(project.budget) : null,
      currency: project.currency ?? '',
    });
    this.openModal.set('edit');
  }

  private openMembers(project: Project): void {
    this.activeProject.set(project);
    this.assignableUsers.set([]);
    this.memberSearch.set('');
    this.memberSearchHasMore.set(false);
    this.openModal.set('members');
    this.loadMembers(project.uuid);
    // Prime the assignable-users list with the first page.
    this.memberSearch$.next('');
  }

  private loadMembers(uuid: string): void {
    this.membersLoading.set(true);
    this.projects.members(uuid).subscribe({
      next: (rows) => {
        this.members.set(rows ?? []);
        this.membersLoading.set(false);
      },
      error: () => {
        this.membersLoading.set(false);
        this.notify.error('Could not load project members.');
      },
    });
  }

  /** Typeahead input handler — server searches within the project's organization. */
  protected onMemberSearch(term: string): void {
    this.memberSearch.set(term);
    this.memberSearch$.next(term.trim());
  }

  protected closeModal(): void {
    this.openModal.set(null);
    this.activeProject.set(null);
    this.members.set([]);
    this.assignableUsers.set([]);
  }

  // ---- Submit handlers ----
  protected submitCreate(): void {
    if (this.createForm.invalid) {
      markAllAsTouched(this.createForm);
      return;
    }
    const v = this.createForm.getRawValue();
    this.submitting.set(true);
    this.projects
      .create({
        name: v.name.trim(),
        description: v.description?.trim() || null,
        status: v.status,
        priority: v.priority,
        start_date: v.start_date || null,
        end_date: v.end_date || null,
        budget: v.budget ?? null,
        currency: v.currency || null,
      })
      .subscribe({
        next: () => {
          this.notify.success('Project created.');
          this.submitting.set(false);
          this.closeModal();
          this.list.reload();
        },
        error: () => this.submitting.set(false),
      });
  }

  protected submitEdit(): void {
    const project = this.activeProject();
    if (!project) return;
    if (this.editForm.invalid) {
      markAllAsTouched(this.editForm);
      return;
    }
    const v = this.editForm.getRawValue();
    this.submitting.set(true);
    this.projects
      .update(project.uuid, {
        name: v.name.trim(),
        description: v.description?.trim() || null,
        status: v.status,
        priority: v.priority,
        start_date: v.start_date || null,
        end_date: v.end_date || null,
        budget: v.budget ?? null,
        currency: v.currency || null,
      })
      .subscribe({
        next: () => {
          this.notify.success(`Project ${project.project_code} updated.`);
          this.submitting.set(false);
          this.closeModal();
          this.list.reload();
        },
        error: () => this.submitting.set(false),
      });
  }

  // ---- Member management (inside the members modal) ----
  protected addMember(user: ProjectUser): void {
    const project = this.activeProject();
    if (!project) return;
    this.projects
      .addMembers(project.uuid, { user_uuids: [user.uuid] })
      .subscribe({
        next: (rows) => {
          this.members.set(rows ?? []);
          this.notify.success(`${user.first_name} ${user.last_name} added.`);
          // Refresh the picker so the just-added user drops off the list.
          this.memberSearch$.next(this.memberSearch().trim());
          this.list.reload();
        },
      });
  }

  protected changeMemberRole(member: ProjectMember, role: ProjectMemberRole): void {
    const project = this.activeProject();
    if (!project || !member.user) return;
    if (member.member_role === role) return;
    this.projects.updateMember(project.uuid, member.user.uuid, role).subscribe({
      next: (rows) => {
        this.members.set(rows ?? []);
        this.notify.success('Member role updated.');
      },
    });
  }

  protected async removeMember(member: ProjectMember): Promise<void> {
    const project = this.activeProject();
    if (!project || !member.user) return;
    const name = `${member.user.first_name} ${member.user.last_name}`;
    const confirmed = await this.modal.confirm({
      title: 'Remove member',
      message: `Remove ${name} from ${project.project_code}?`,
      confirmText: 'Remove',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.projects.removeMember(project.uuid, member.user.uuid).subscribe({
      next: () => {
        this.notify.success(`${name} removed.`);
        this.loadMembers(project.uuid);
        this.memberSearch$.next(this.memberSearch().trim());
        this.list.reload();
      },
    });
  }

  /** Delete uses the shared confirmation modal; the action runs here on confirm. */
  private async confirmDelete(project: Project): Promise<void> {
    const confirmed = await this.modal.confirm({
      title: 'Delete project',
      message: `Delete project ${project.project_code}? This also removes all its member assignments and cannot be undone.`,
      confirmText: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.projects.remove(project.uuid).subscribe({
      next: () => {
        this.notify.success(`Project ${project.project_code} deleted.`);
        this.list.reload();
      },
    });
  }
}
