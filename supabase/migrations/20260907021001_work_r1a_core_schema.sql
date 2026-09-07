-- Vioo Work R1A core schema. Public task data is read-only to browser roles;
-- state changes are introduced later through guarded command RPCs.

create table public.work_task_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  scope_type text not null,
  department_id uuid references public.org_units(id) on delete restrict,
  project_id text references public.projects(id) on delete restrict,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_task_groups_name_check check (char_length(btrim(name)) between 2 and 160),
  constraint work_task_groups_scope_shape_check check (
    (scope_type = 'department' and department_id is not null and project_id is null)
    or (scope_type = 'project' and project_id is not null and department_id is null)
  )
);

create unique index work_task_groups_department_name_idx
  on public.work_task_groups (department_id, lower(btrim(name)))
  where scope_type = 'department' and is_active;
create unique index work_task_groups_project_name_idx
  on public.work_task_groups (project_id, lower(btrim(name)))
  where scope_type = 'project' and is_active;
create index work_task_groups_created_by_idx on public.work_task_groups(created_by);
create index work_task_groups_department_fk_idx on public.work_task_groups(department_id);
create index work_task_groups_project_fk_idx on public.work_task_groups(project_id);

create table public.work_tasks (
  id uuid primary key default gen_random_uuid(),
  task_code text not null unique,
  title text not null,
  description_document jsonb not null default '{"version":1,"type":"doc","content":[]}'::jsonb,
  description_text text not null default '',
  scope_type text not null,
  department_id uuid references public.org_units(id) on delete restrict,
  project_id text references public.projects(id) on delete restrict,
  task_group_id uuid references public.work_task_groups(id) on delete restrict,
  recipient_snapshot_fingerprint text,
  status text not null default 'pending_acknowledgement',
  priority text not null default 'normal',
  privacy text not null default 'standard',
  labels text[] not null default '{}'::text[],
  deadline_at timestamptz,
  review_policy text not null default 'creator_review',
  reviewer_user_id uuid references public.users(id) on delete restrict,
  created_by uuid not null references public.users(id) on delete restrict,
  cloned_from_task_id uuid references public.work_tasks(id) on delete set null,
  lock_version bigint not null default 1,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_tasks_code_check check (task_code ~ '^VW-[0-9]{4}-[0-9]{6,}$'),
  constraint work_tasks_title_check check (char_length(btrim(title)) between 2 and 300),
  constraint work_tasks_description_document_check check (
    jsonb_typeof(description_document) = 'object'
    and description_document ? 'version'
  ),
  constraint work_tasks_scope_shape_check check (
    (scope_type = 'direct' and department_id is null and project_id is null)
    or (scope_type = 'department' and department_id is not null and project_id is null)
    or (scope_type = 'project' and project_id is not null and department_id is null)
  ),
  constraint work_tasks_status_check check (status in (
    'draft', 'pending_acknowledgement', 'clarification_requested', 'not_started',
    'in_progress', 'blocked', 'awaiting_review', 'changes_requested',
    'completed', 'cancelled'
  )),
  constraint work_tasks_priority_check check (priority in ('normal', 'important', 'urgent')),
  constraint work_tasks_privacy_check check (privacy in ('standard', 'restricted')),
  constraint work_tasks_review_policy_check check (review_policy in ('auto_complete', 'creator_review', 'reviewer_review')),
  constraint work_tasks_lock_version_check check (lock_version > 0),
  constraint work_tasks_labels_check check (cardinality(labels) <= 20),
  constraint work_tasks_terminal_time_check check (
    (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
    or (status not in ('completed', 'cancelled') and completed_at is null and cancelled_at is null)
  )
);

create index work_tasks_updated_cursor_idx on public.work_tasks(updated_at desc, id desc);
create index work_tasks_open_deadline_idx on public.work_tasks(deadline_at, id)
  where deadline_at is not null and status not in ('completed', 'cancelled');
create index work_tasks_created_by_idx on public.work_tasks(created_by, updated_at desc, id desc);
create index work_tasks_department_idx on public.work_tasks(department_id, updated_at desc, id desc)
  where department_id is not null;
create index work_tasks_project_idx on public.work_tasks(project_id, updated_at desc, id desc)
  where project_id is not null;
create index work_tasks_group_idx on public.work_tasks(task_group_id, updated_at desc, id desc)
  where task_group_id is not null;
create index work_tasks_reviewer_idx on public.work_tasks(reviewer_user_id, updated_at desc, id desc)
  where reviewer_user_id is not null;
create index work_tasks_clone_source_idx on public.work_tasks(cloned_from_task_id)
  where cloned_from_task_id is not null;
create index work_tasks_labels_gin_idx on public.work_tasks using gin(labels);
create index work_tasks_search_idx on public.work_tasks using gin(
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description_text, ''))
);

create table public.work_task_recipient_specs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  source_type text not null,
  source_id text not null,
  source_name_snapshot text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint work_task_recipient_specs_source_type_check check (source_type in ('user', 'work_group')),
  constraint work_task_recipient_specs_source_id_check check (char_length(btrim(source_id)) > 0),
  constraint work_task_recipient_specs_task_id_id_key unique(task_id, id),
  constraint work_task_recipient_specs_source_key unique(task_id, source_type, source_id)
);
create index work_task_recipient_specs_task_idx on public.work_task_recipient_specs(task_id, sort_order, id);

create table public.work_task_recipient_members (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  resolved_at timestamptz not null default now(),
  constraint work_task_recipient_members_task_id_id_key unique(task_id, id),
  constraint work_task_recipient_members_user_key unique(task_id, user_id)
);
create index work_task_recipient_members_user_idx on public.work_task_recipient_members(user_id, task_id);

create table public.work_task_recipient_member_sources (
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  recipient_member_id uuid not null,
  recipient_spec_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(recipient_member_id, recipient_spec_id),
  constraint work_task_recipient_member_sources_member_fkey
    foreign key(task_id, recipient_member_id)
    references public.work_task_recipient_members(task_id, id) on delete restrict,
  constraint work_task_recipient_member_sources_spec_fkey
    foreign key(task_id, recipient_spec_id)
    references public.work_task_recipient_specs(task_id, id) on delete restrict
);
create index work_task_recipient_member_sources_task_idx
  on public.work_task_recipient_member_sources(task_id, recipient_member_id);
create index work_task_recipient_member_sources_spec_idx
  on public.work_task_recipient_member_sources(recipient_spec_id);

create table public.work_task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  state text not null default 'pending_acknowledgement',
  assigned_by uuid not null references public.users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  acknowledgement_due_at timestamptz,
  acknowledged_at timestamptz,
  clarification_requested_at timestamptz,
  clarification_note text,
  started_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text,
  completed_at timestamptz,
  ended_at timestamptz,
  transfer_from_assignment_id uuid,
  transfer_to_assignment_id uuid,
  transfer_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_task_assignments_task_id_key unique(task_id, id),
  constraint work_task_assignments_transfer_from_fkey foreign key(task_id, transfer_from_assignment_id)
    references public.work_task_assignments(task_id, id) on delete restrict,
  constraint work_task_assignments_transfer_to_fkey foreign key(task_id, transfer_to_assignment_id)
    references public.work_task_assignments(task_id, id) on delete restrict,
  constraint work_task_assignments_transfer_not_self check (
    transfer_from_assignment_id is distinct from id and transfer_to_assignment_id is distinct from id
  ),
  constraint work_task_assignments_state_check check (state in (
    'pending_acknowledgement', 'clarification_requested', 'not_started',
    'in_progress', 'blocked', 'awaiting_review', 'changes_requested',
    'completed', 'transferred', 'cancelled'
  )),
  constraint work_task_assignments_terminal_check check (
    (state in ('transferred', 'cancelled') and ended_at is not null)
    or (state not in ('transferred', 'cancelled') and ended_at is null)
  )
);
create unique index work_task_assignments_one_active_user_idx
  on public.work_task_assignments(task_id, user_id) where ended_at is null;
create index work_task_assignments_active_user_idx
  on public.work_task_assignments(user_id, updated_at desc, task_id) where ended_at is null;
create index work_task_assignments_task_state_idx
  on public.work_task_assignments(task_id, state, id);
create index work_task_assignments_assigned_by_idx on public.work_task_assignments(assigned_by);
create index work_task_assignments_user_history_idx on public.work_task_assignments(user_id, task_id);
create index work_task_assignments_transfer_from_idx on public.work_task_assignments(transfer_from_assignment_id)
  where transfer_from_assignment_id is not null;
create index work_task_assignments_transfer_to_idx on public.work_task_assignments(transfer_to_assignment_id)
  where transfer_to_assignment_id is not null;

create table public.work_task_participants (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  participant_role text not null,
  added_by uuid not null references public.users(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint work_task_participants_role_check check (participant_role in ('watcher', 'reviewer'))
);
create unique index work_task_participants_one_active_role_idx
  on public.work_task_participants(task_id, user_id, participant_role) where ended_at is null;
create index work_task_participants_active_user_idx
  on public.work_task_participants(user_id, participant_role, task_id) where ended_at is null;
create index work_task_participants_task_idx on public.work_task_participants(task_id, participant_role, id);
create index work_task_participants_added_by_idx on public.work_task_participants(added_by);
create index work_task_participants_user_history_idx on public.work_task_participants(user_id, task_id);

create table public.work_task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  iteration integer not null,
  submitted_by uuid not null references public.users(id) on delete restrict,
  result_document jsonb not null default '{"version":1,"type":"doc","content":[]}'::jsonb,
  result_text text not null default '',
  status text not null default 'pending_review',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  constraint work_task_submissions_iteration_check check (iteration > 0),
  constraint work_task_submissions_status_check check (status in ('pending_review', 'approved', 'changes_requested')),
  constraint work_task_submissions_result_document_check check (jsonb_typeof(result_document) = 'object'),
  constraint work_task_submissions_task_iteration_key unique(task_id, iteration)
);
create unique index work_task_submissions_one_pending_idx
  on public.work_task_submissions(task_id) where status = 'pending_review';
create index work_task_submissions_task_idx on public.work_task_submissions(task_id, iteration desc);
create index work_task_submissions_submitted_by_idx on public.work_task_submissions(submitted_by);
create index work_task_submissions_reviewed_by_idx on public.work_task_submissions(reviewed_by)
  where reviewed_by is not null;

create table public.work_task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  title text not null,
  assignee_user_id uuid references public.users(id) on delete restrict,
  sort_order integer not null default 0,
  completed_by uuid references public.users(id) on delete restrict,
  completed_at timestamptz,
  lock_version bigint not null default 1,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_task_checklist_title_check check (char_length(btrim(title)) between 1 and 300),
  constraint work_task_checklist_completion_check check ((completed_at is null) = (completed_by is null)),
  constraint work_task_checklist_lock_version_check check (lock_version > 0)
);
create index work_task_checklist_task_idx on public.work_task_checklist_items(task_id, sort_order, id);
create index work_task_checklist_assignee_idx on public.work_task_checklist_items(assignee_user_id, task_id)
  where assignee_user_id is not null;
create index work_task_checklist_created_by_idx on public.work_task_checklist_items(created_by);
create index work_task_checklist_completed_by_idx on public.work_task_checklist_items(completed_by)
  where completed_by is not null;

create table public.work_task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  author_user_id uuid not null references public.users(id) on delete restrict,
  parent_comment_id uuid,
  content_document jsonb not null,
  content_text text not null,
  edited_at timestamptz,
  lock_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_task_comments_content_document_check check (jsonb_typeof(content_document) = 'object'),
  constraint work_task_comments_content_text_check check (char_length(btrim(content_text)) between 1 and 10000),
  constraint work_task_comments_lock_version_check check (lock_version > 0),
  constraint work_task_comments_task_id_key unique(task_id, id),
  constraint work_task_comments_parent_fkey foreign key(task_id, parent_comment_id)
    references public.work_task_comments(task_id, id) on delete restrict,
  constraint work_task_comments_not_own_parent check (parent_comment_id is distinct from id)
);
create index work_task_comments_cursor_idx on public.work_task_comments(task_id, created_at desc, id desc);
create index work_task_comments_author_idx on public.work_task_comments(author_user_id, created_at desc);
create index work_task_comments_parent_idx on public.work_task_comments(parent_comment_id)
  where parent_comment_id is not null;

create table public.work_task_mentions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  comment_id uuid not null,
  mentioned_user_id uuid not null references public.users(id) on delete restrict,
  mentioned_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint work_task_mentions_comment_user_key unique(comment_id, mentioned_user_id),
  constraint work_task_mentions_comment_fkey foreign key(task_id, comment_id)
    references public.work_task_comments(task_id, id) on delete restrict
);
create index work_task_mentions_user_idx on public.work_task_mentions(mentioned_user_id, created_at desc);
create index work_task_mentions_task_idx on public.work_task_mentions(task_id, comment_id);
create index work_task_mentions_mentioned_by_idx on public.work_task_mentions(mentioned_by);

create table public.work_task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  uploader_user_id uuid not null references public.users(id) on delete restrict,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_path text not null unique,
  status text not null default 'pending',
  variants jsonb not null default '{}'::jsonb,
  keep_original boolean not null default false,
  evidence_type text,
  finalized_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint work_task_attachments_name_check check (char_length(btrim(file_name)) between 1 and 255),
  constraint work_task_attachments_size_check check (size_bytes > 0 and size_bytes <= 26214400),
  constraint work_task_attachments_status_check check (status in ('pending', 'processing', 'ready', 'rejected', 'deleted')),
  constraint work_task_attachments_variants_check check (jsonb_typeof(variants) = 'object')
);
create index work_task_attachments_task_idx on public.work_task_attachments(task_id, created_at, id);
create index work_task_attachments_pending_idx on public.work_task_attachments(created_at, id)
  where status in ('pending', 'processing');
create index work_task_attachments_uploader_idx on public.work_task_attachments(uploader_user_id, created_at desc);
create index work_task_attachments_deleted_by_idx on public.work_task_attachments(deleted_by)
  where deleted_by is not null;

create table public.work_task_versions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  version bigint not null,
  snapshot jsonb not null,
  actor_user_id uuid references public.users(id) on delete restrict,
  source text not null default 'human',
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  constraint work_task_versions_version_check check (version > 0),
  constraint work_task_versions_snapshot_check check (jsonb_typeof(snapshot) = 'object'),
  constraint work_task_versions_source_check check (source in ('human', 'ai_chatbot', 'automation', 'system')),
  constraint work_task_versions_task_version_key unique(task_id, version)
);
create index work_task_versions_cursor_idx on public.work_task_versions(task_id, version desc, id);
create index work_task_versions_actor_idx on public.work_task_versions(actor_user_id, created_at desc)
  where actor_user_id is not null;

create table public.work_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  actor_user_id uuid references public.users(id) on delete restrict,
  event_type text not null,
  source text not null default 'human',
  payload jsonb not null default '{}'::jsonb,
  correlation_id uuid,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  constraint work_task_events_type_check check (char_length(btrim(event_type)) between 3 and 100),
  constraint work_task_events_source_check check (source in ('human', 'ai_chatbot', 'automation', 'system')),
  constraint work_task_events_payload_check check (jsonb_typeof(payload) = 'object')
);
create index work_task_events_cursor_idx on public.work_task_events(task_id, created_at desc, id desc);
create index work_task_events_actor_idx on public.work_task_events(actor_user_id, created_at desc)
  where actor_user_id is not null;
create index work_task_events_correlation_idx on public.work_task_events(correlation_id)
  where correlation_id is not null;

create table public.work_task_pins (
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  pinned_at timestamptz not null default now(),
  primary key(task_id, user_id)
);
create index work_task_pins_user_idx on public.work_task_pins(user_id, pinned_at desc, task_id);

create table public.work_task_notification_preferences (
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  notifications_enabled boolean not null default true,
  muted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(task_id, user_id),
  constraint work_task_notification_preferences_mute_check check (
    notifications_enabled or muted_at is not null
  )
);
create index work_task_notification_preferences_user_idx
  on public.work_task_notification_preferences(user_id, updated_at desc);

create table public.work_sla_calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  working_weekdays smallint[] not null default array[1,2,3,4,5]::smallint[],
  workday_start time not null,
  workday_end time not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_sla_calendars_name_check check (char_length(btrim(name)) between 2 and 160),
  constraint work_sla_calendars_weekdays_check check (
    cardinality(working_weekdays) between 1 and 7
    and working_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint work_sla_calendars_hours_check check (workday_end > workday_start)
);
create unique index work_sla_calendars_one_default_idx on public.work_sla_calendars(is_default)
  where is_default and is_active;
create index work_sla_calendars_created_by_idx on public.work_sla_calendars(created_by);

create table public.work_sla_calendar_exceptions (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.work_sla_calendars(id) on delete restrict,
  exception_date date not null,
  is_working_day boolean not null default false,
  workday_start time,
  workday_end time,
  label text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_sla_calendar_exceptions_date_key unique(calendar_id, exception_date),
  constraint work_sla_calendar_exceptions_hours_check check (
    (not is_working_day and workday_start is null and workday_end is null)
    or (is_working_day and workday_start is not null and workday_end is not null and workday_end > workday_start)
  )
);
create index work_sla_calendar_exceptions_created_by_idx
  on public.work_sla_calendar_exceptions(created_by);

create table public.work_sla_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scope_type text not null,
  department_id uuid references public.org_units(id) on delete restrict,
  project_id text references public.projects(id) on delete restrict,
  calendar_id uuid not null references public.work_sla_calendars(id) on delete restrict,
  acknowledgement_minutes integer not null,
  due_soon_minutes integer[] not null default array[1440,240,60],
  overdue_digest_local_time time not null default '08:00',
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_active boolean not null default true,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_sla_policies_name_check check (char_length(btrim(name)) between 2 and 160),
  constraint work_sla_policies_scope_shape_check check (
    (scope_type = 'global' and department_id is null and project_id is null)
    or (scope_type = 'department' and department_id is not null and project_id is null)
    or (scope_type = 'project' and project_id is not null and department_id is null)
  ),
  constraint work_sla_policies_ack_check check (acknowledgement_minutes > 0),
  constraint work_sla_policies_due_soon_check check (
    cardinality(due_soon_minutes) between 1 and 10
    and 0 < all(due_soon_minutes)
  ),
  constraint work_sla_policies_effective_range_check check (effective_to is null or effective_to > effective_from)
);
create unique index work_sla_policies_active_global_idx on public.work_sla_policies(scope_type)
  where scope_type = 'global' and is_active and effective_to is null;
create unique index work_sla_policies_active_department_idx on public.work_sla_policies(department_id)
  where scope_type = 'department' and is_active and effective_to is null;
create unique index work_sla_policies_active_project_idx on public.work_sla_policies(project_id)
  where scope_type = 'project' and is_active and effective_to is null;
create index work_sla_policies_calendar_idx on public.work_sla_policies(calendar_id);
create index work_sla_policies_created_by_idx on public.work_sla_policies(created_by);
create index work_sla_policies_department_fk_idx on public.work_sla_policies(department_id);
create index work_sla_policies_project_fk_idx on public.work_sla_policies(project_id);

create table app_private.work_task_code_counters (
  code_year integer primary key,
  last_sequence bigint not null,
  updated_at timestamptz not null default now(),
  constraint work_task_code_counters_year_check check (code_year between 2020 and 9999),
  constraint work_task_code_counters_sequence_check check (last_sequence > 0)
);

create table app_private.work_command_idempotency (
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  command_name text not null,
  request_hash text not null,
  response_payload jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(actor_user_id, idempotency_key),
  constraint work_command_idempotency_command_check check (char_length(btrim(command_name)) between 3 and 100),
  constraint work_command_idempotency_hash_check check (char_length(request_hash) = 32),
  constraint work_command_idempotency_response_check check (
    response_payload is null or jsonb_typeof(response_payload) = 'object'
  )
);
create index work_command_idempotency_created_idx
  on app_private.work_command_idempotency(created_at, actor_user_id);

create table app_private.work_notification_outbox (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.work_task_events(id) on delete restrict,
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  constraint work_notification_outbox_attempt_check check (attempt_count >= 0),
  constraint work_notification_outbox_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint work_notification_outbox_event_key unique(event_id)
);
create index work_notification_outbox_pending_idx
  on app_private.work_notification_outbox(available_at, id)
  where processed_at is null;
create index work_notification_outbox_task_idx
  on app_private.work_notification_outbox(task_id, id desc);

create table app_private.work_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id bigint not null references app_private.work_notification_outbox(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  channel text not null,
  status text not null default 'pending',
  delivery_key text not null unique,
  attempt_count integer not null default 0,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_notification_deliveries_channel_check check (channel in ('in_app', 'web_push')),
  constraint work_notification_deliveries_status_check check (status in ('pending', 'processing', 'delivered', 'failed', 'suppressed')),
  constraint work_notification_deliveries_attempt_check check (attempt_count >= 0),
  constraint work_notification_deliveries_outbox_user_channel_key unique(outbox_id, user_id, channel)
);
create index work_notification_deliveries_pending_idx
  on app_private.work_notification_deliveries(status, updated_at, id)
  where status in ('pending', 'failed');
create index work_notification_deliveries_user_idx
  on app_private.work_notification_deliveries(user_id, created_at desc);

create or replace function app_private.next_work_task_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from timezone('Asia/Ho_Chi_Minh', now()))::integer;
  v_sequence bigint;
begin
  insert into app_private.work_task_code_counters(code_year, last_sequence)
  values (v_year, 1)
  on conflict (code_year) do update set
    last_sequence = app_private.work_task_code_counters.last_sequence + 1,
    updated_at = now()
  returning last_sequence into v_sequence;

  return format('VW-%s-%s', v_year, lpad(v_sequence::text, greatest(6, length(v_sequence::text)), '0'));
end;
$$;

create or replace function app_private.validate_work_task_group_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_group public.work_task_groups%rowtype;
begin
  if new.task_group_id is null then
    return new;
  end if;

  select group_row.* into v_group
  from public.work_task_groups group_row
  where group_row.id = new.task_group_id;

  if v_group.id is null
    or v_group.scope_type <> new.scope_type
    or v_group.department_id is distinct from new.department_id
    or v_group.project_id is distinct from new.project_id then
    raise exception 'WORK_TASK_GROUP_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger work_tasks_validate_group_scope
before insert or update of task_group_id, scope_type, department_id, project_id
on public.work_tasks
for each row execute function app_private.validate_work_task_group_scope();

-- A bucket belongs to one scope for its lifetime. Moving it would invalidate
-- existing task references (including concurrent task creation).
create function app_private.work_guard_group_scope()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.scope_type is distinct from old.scope_type
    or new.department_id is distinct from old.department_id
    or new.project_id is distinct from old.project_id then
    raise exception 'WORK_GROUP_SCOPE_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger work_task_group_scope_immutable before update on public.work_task_groups
for each row execute function app_private.work_guard_group_scope();
revoke all on function app_private.work_guard_group_scope() from public, anon, authenticated;

create function app_private.work_guard_task_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.task_code is distinct from old.task_code
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'WORK_TASK_IDENTITY_IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger work_task_identity_immutable before update on public.work_tasks
for each row execute function app_private.work_guard_task_identity();
revoke all on function app_private.work_guard_task_identity() from public, anon, authenticated;

create function app_private.work_reject_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'WORK_HISTORY_IMMUTABLE' using errcode = '23514';
end;
$$;
create trigger work_task_events_append_only before update or delete on public.work_task_events
for each row execute function app_private.work_reject_history_mutation();
create trigger work_task_versions_append_only before update or delete on public.work_task_versions
for each row execute function app_private.work_reject_history_mutation();
create trigger work_task_assignments_preserve_history before delete on public.work_task_assignments
for each row execute function app_private.work_reject_history_mutation();
create trigger work_task_submissions_preserve_history before delete on public.work_task_submissions
for each row execute function app_private.work_reject_history_mutation();
revoke all on function app_private.work_reject_history_mutation() from public, anon, authenticated;

create or replace function app_private.work_task_actor_can_view(p_task_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_task record;
  v_is_creator boolean := false;
  v_is_assignee boolean := false;
  v_is_participant boolean := false;
  v_related_allowed boolean := false;
  v_scope_allowed boolean := false;
  v_restricted_allowed boolean := false;
begin
  if v_actor_id is null
    or not app_private.has_permission(v_actor_id, 'work.module.access', 'global', '*') then
    return false;
  end if;

  select task_row.id, task_row.created_by, task_row.scope_type,
    task_row.department_id, task_row.project_id, task_row.privacy into v_task
  from public.work_tasks task_row
  where task_row.id = p_task_id;

  if v_task.id is null then
    return false;
  end if;

  v_is_creator := v_task.created_by = v_actor_id;
  select exists (
    select 1 from public.work_task_assignments assignment_row
    where assignment_row.task_id = p_task_id
      and assignment_row.user_id = v_actor_id
      and assignment_row.ended_at is null
  ) into v_is_assignee;
  select exists (
    select 1 from public.work_task_participants participant_row
    where participant_row.task_id = p_task_id
      and participant_row.user_id = v_actor_id
      and participant_row.ended_at is null
  ) into v_is_participant;

  v_related_allowed := (
    v_is_creator
    and app_private.has_permission(v_actor_id, 'work.task.view_related', 'own', '*')
  ) or (
    (v_is_assignee or v_is_participant)
    and app_private.has_permission(v_actor_id, 'work.task.view_related', 'assigned', '*')
  ) or (
    (v_is_creator or v_is_assignee or v_is_participant)
    and v_task.scope_type in ('department', 'project')
    and app_private.has_permission(v_actor_id, 'work.task.view_related',
      v_task.scope_type, coalesce(v_task.department_id::text, v_task.project_id))
  );

  v_scope_allowed := app_private.has_permission(
    v_actor_id,
    'work.task.view_scope',
    case when v_task.scope_type = 'direct' then 'global' else v_task.scope_type end,
    case
      when v_task.scope_type = 'department' then v_task.department_id::text
      when v_task.scope_type = 'project' then v_task.project_id
      else '*'
    end
  );

  v_restricted_allowed := v_task.privacy = 'standard'
    or v_is_creator
    or v_is_assignee
    or v_is_participant
    or app_private.has_permission(
      v_actor_id,
      'work.task.view_restricted',
      case when v_task.scope_type = 'direct' then 'global' else v_task.scope_type end,
      case
        when v_task.scope_type = 'department' then v_task.department_id::text
        when v_task.scope_type = 'project' then v_task.project_id
        else '*'
      end
    );

  return (v_related_allowed or v_scope_allowed) and v_restricted_allowed;
end;
$$;

create or replace function app_private.work_task_group_actor_can_view(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.work_task_groups group_row
    where group_row.id = p_group_id
      and app_private.has_permission(public.current_app_user_id(), 'work.module.access', 'global', '*')
      and (
        app_private.has_permission(
          public.current_app_user_id(),
          'work.task.create',
          group_row.scope_type,
          coalesce(group_row.department_id::text, group_row.project_id)
        )
        or app_private.has_permission(
          public.current_app_user_id(),
          'work.task.view_scope',
          group_row.scope_type,
          coalesce(group_row.department_id::text, group_row.project_id)
        )
        or app_private.has_permission(
          public.current_app_user_id(),
          'work.task.configure',
          group_row.scope_type,
          coalesce(group_row.department_id::text, group_row.project_id)
        )
      )
  );
$$;

revoke all on table app_private.work_task_code_counters from public, anon, authenticated;
revoke all on table app_private.work_command_idempotency from public, anon, authenticated;
revoke all on table app_private.work_notification_outbox from public, anon, authenticated;
revoke all on table app_private.work_notification_deliveries from public, anon, authenticated;
alter table app_private.work_task_code_counters enable row level security;
alter table app_private.work_command_idempotency enable row level security;
alter table app_private.work_notification_outbox enable row level security;
alter table app_private.work_notification_deliveries enable row level security;
revoke all on function app_private.next_work_task_code() from public, anon, authenticated;
revoke all on function app_private.validate_work_task_group_scope() from public, anon, authenticated;
revoke all on function app_private.work_task_actor_can_view(uuid) from public, anon, authenticated;
revoke all on function app_private.work_task_group_actor_can_view(uuid) from public, anon, authenticated;

-- RLS invokes these private helpers as the caller. Both resolve the actor from
-- the authenticated session and accept only the resource ID.
grant execute on function app_private.work_task_actor_can_view(uuid) to authenticated;
grant execute on function app_private.work_task_group_actor_can_view(uuid) to authenticated;

revoke all on table
  public.work_task_groups,
  public.work_tasks,
  public.work_task_recipient_specs,
  public.work_task_recipient_members,
  public.work_task_recipient_member_sources,
  public.work_task_assignments,
  public.work_task_participants,
  public.work_task_submissions,
  public.work_task_checklist_items,
  public.work_task_comments,
  public.work_task_mentions,
  public.work_task_attachments,
  public.work_task_versions,
  public.work_task_events,
  public.work_task_pins,
  public.work_task_notification_preferences,
  public.work_sla_calendars,
  public.work_sla_calendar_exceptions,
  public.work_sla_policies
from public, anon, authenticated;

grant select on public.work_tasks to authenticated;
grant select on table
  public.work_task_groups,
  public.work_task_recipient_specs,
  public.work_task_recipient_members,
  public.work_task_recipient_member_sources,
  public.work_task_assignments,
  public.work_task_participants,
  public.work_task_submissions,
  public.work_task_checklist_items,
  public.work_task_comments,
  public.work_task_mentions,
  public.work_task_attachments,
  public.work_task_versions,
  public.work_task_events,
  public.work_task_pins,
  public.work_task_notification_preferences,
  public.work_sla_calendars,
  public.work_sla_calendar_exceptions,
  public.work_sla_policies
to authenticated;

alter table public.work_task_groups enable row level security;
alter table public.work_tasks enable row level security;
alter table public.work_task_recipient_specs enable row level security;
alter table public.work_task_recipient_members enable row level security;
alter table public.work_task_recipient_member_sources enable row level security;
alter table public.work_task_assignments enable row level security;
alter table public.work_task_participants enable row level security;
alter table public.work_task_submissions enable row level security;
alter table public.work_task_checklist_items enable row level security;
alter table public.work_task_comments enable row level security;
alter table public.work_task_mentions enable row level security;
alter table public.work_task_attachments enable row level security;
alter table public.work_task_versions enable row level security;
alter table public.work_task_events enable row level security;
alter table public.work_task_pins enable row level security;
alter table public.work_task_notification_preferences enable row level security;
alter table public.work_sla_calendars enable row level security;
alter table public.work_sla_calendar_exceptions enable row level security;
alter table public.work_sla_policies enable row level security;

create policy work_task_groups_select on public.work_task_groups
for select to authenticated
using (app_private.work_task_group_actor_can_view(id));

create policy work_tasks_select on public.work_tasks
for select to authenticated
using (app_private.work_task_actor_can_view(id));

create policy work_task_recipient_specs_select on public.work_task_recipient_specs
for select to authenticated
using (app_private.work_task_actor_can_view(task_id));
create policy work_task_recipient_members_select on public.work_task_recipient_members
for select to authenticated
using (app_private.work_task_actor_can_view(task_id));
create policy work_task_recipient_member_sources_select on public.work_task_recipient_member_sources
for select to authenticated
using (app_private.work_task_actor_can_view(task_id));
create policy work_task_assignments_select on public.work_task_assignments
for select to authenticated
using (app_private.work_task_actor_can_view(task_id));
create policy work_task_participants_select on public.work_task_participants
for select to authenticated
using (app_private.work_task_actor_can_view(task_id));
create policy work_task_submissions_select on public.work_task_submissions
for select to authenticated
using (app_private.work_task_actor_can_view(task_id));
create policy work_task_checklist_items_select on public.work_task_checklist_items
for select to authenticated
using (app_private.work_task_actor_can_view(task_id));
create policy work_task_comments_select on public.work_task_comments
for select to authenticated
using (app_private.work_task_actor_can_view(task_id));
create policy work_task_mentions_select on public.work_task_mentions
for select to authenticated
using (app_private.work_task_actor_can_view(task_id));
create policy work_task_attachments_select on public.work_task_attachments
for select to authenticated
using (status = 'ready' and deleted_at is null and app_private.work_task_actor_can_view(task_id));
create policy work_task_versions_select on public.work_task_versions
for select to authenticated
using (
  app_private.work_task_actor_can_view(task_id)
  and exists (
    select 1 from public.work_tasks t
    where t.id = work_task_versions.task_id and (
      app_private.has_permission(public.current_app_user_id(), 'work.task.audit_view',
        case when t.scope_type = 'direct' then 'global' else t.scope_type end,
        coalesce(t.department_id::text, t.project_id, '*'))
      or (t.created_by = public.current_app_user_id()
        and app_private.has_permission(public.current_app_user_id(), 'work.task.audit_view', 'own', '*'))
      or (app_private.has_permission(public.current_app_user_id(), 'work.task.audit_view', 'assigned', '*')
        and (
          exists(select 1 from public.work_task_assignments a where a.task_id = t.id
            and a.user_id = public.current_app_user_id() and a.ended_at is null)
          or exists(select 1 from public.work_task_participants p where p.task_id = t.id
            and p.user_id = public.current_app_user_id() and p.ended_at is null)
        ))
    )
  )
);
create policy work_task_events_select on public.work_task_events
for select to authenticated
using (app_private.work_task_actor_can_view(task_id));
create policy work_task_pins_select on public.work_task_pins
for select to authenticated
using (user_id = public.current_app_user_id() and app_private.work_task_actor_can_view(task_id));
create policy work_task_notification_preferences_select on public.work_task_notification_preferences
for select to authenticated
using (user_id = public.current_app_user_id() and app_private.work_task_actor_can_view(task_id));

create policy work_sla_calendars_select on public.work_sla_calendars
for select to authenticated
using (app_private.has_permission(public.current_app_user_id(), 'work.module.access', 'global', '*'));
create policy work_sla_calendar_exceptions_select on public.work_sla_calendar_exceptions
for select to authenticated
using (app_private.has_permission(public.current_app_user_id(), 'work.module.access', 'global', '*'));
create policy work_sla_policies_select on public.work_sla_policies
for select to authenticated
using (app_private.has_permission(public.current_app_user_id(), 'work.module.access', 'global', '*'));
