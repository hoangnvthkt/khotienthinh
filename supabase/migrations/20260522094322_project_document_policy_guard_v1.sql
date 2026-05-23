-- Project Permission & Workflow Guard V1.
-- Repo migration only. Apply cloud manually with:
--   supabase db query --linked -f supabase/migrations/20260522094322_project_document_policy_guard_v1.sql

do $$
begin
  if to_regclass('public.project_permission_types') is not null then
    insert into public.project_permission_types (code, name, module, description, sort_order, is_active)
    values (
      'delete',
      'Xóa dữ liệu',
      null,
      'Xóa chứng từ hoặc dữ liệu dự án khi còn ở trạng thái nháp và chưa có liên kết downstream',
      6,
      true
    )
    on conflict (code) do update set
      name = excluded.name,
      module = excluded.module,
      description = excluded.description,
      sort_order = excluded.sort_order,
      is_active = true;
  end if;
end;
$$;

create table if not exists public.project_document_action_logs (
  id text primary key default gen_random_uuid()::text,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  document_type text not null,
  document_id text not null,
  document_label text,
  action text not null,
  from_status text,
  to_status text,
  allowed boolean not null default true,
  reason text,
  blocked_reason text,
  warning_acknowledged boolean not null default false,
  required_rollback_steps jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_document_action_logs_project
  on public.project_document_action_logs(project_id, created_at desc);

create index if not exists idx_project_document_action_logs_site
  on public.project_document_action_logs(construction_site_id, created_at desc);

create index if not exists idx_project_document_action_logs_document
  on public.project_document_action_logs(document_type, document_id, created_at desc);

create index if not exists idx_project_document_action_logs_action
  on public.project_document_action_logs(action, created_at desc);

alter table public.project_document_action_logs enable row level security;

drop policy if exists project_document_action_logs_project_access
  on public.project_document_action_logs;

create policy project_document_action_logs_project_access
  on public.project_document_action_logs
  for all
  to authenticated
  using (project_id is not null or construction_site_id is not null)
  with check (project_id is not null or construction_site_id is not null);

revoke all on table public.project_document_action_logs from anon;
revoke all on table public.project_document_action_logs from public;
revoke all on table public.project_document_action_logs from authenticated;
grant select, insert, update, delete on table public.project_document_action_logs to authenticated;

notify pgrst, 'reload schema';
