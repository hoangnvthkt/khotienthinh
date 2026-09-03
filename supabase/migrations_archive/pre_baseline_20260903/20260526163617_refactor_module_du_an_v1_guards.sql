-- Refactor Module Du-an V1: tighten fulfillment RLS without changing workflow RPCs.
-- Supabase/Postgres RLS requires SELECT policies for UPDATE/DELETE visibility, so
-- batches and lines get explicit per-command policies instead of a broad FOR ALL.

create schema if not exists app_private;

create or replace function app_private.material_request_fulfillment_can_view(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or exists (
      select 1
      from public.requests r
      where r.id = p_request_id
        and (
          r.requester_id::text = public.current_app_user_id()::text
          or r.submitted_to_user_id = public.current_app_user_id()::text
          or app_private.project_doc_can_view(
            r.project_id::text,
            r.construction_site_id::text,
            r.submitted_to_user_id
          )
        )
    );
$$;

create or replace function app_private.material_request_fulfillment_can_mutate(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or exists (
      select 1
      from public.requests r
      where r.id = p_request_id
        and r.submitted_to_user_id is not null
        and r.submitted_to_user_id = public.current_app_user_id()::text
    );
$$;

create or replace function app_private.material_request_fulfillment_line_can_view(
  p_request_id text,
  p_batch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.material_request_fulfillment_can_view(p_request_id)
    and exists (
      select 1
      from public.material_request_fulfillment_batches b
      where b.id = p_batch_id
        and b.material_request_id = p_request_id
    );
$$;

create or replace function app_private.material_request_fulfillment_line_can_mutate(
  p_request_id text,
  p_batch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app_private.material_request_fulfillment_can_mutate(p_request_id)
    and exists (
      select 1
      from public.material_request_fulfillment_batches b
      where b.id = p_batch_id
        and b.material_request_id = p_request_id
    );
$$;

alter table public.material_request_fulfillment_batches enable row level security;
alter table public.material_request_fulfillment_lines enable row level security;

drop policy if exists material_request_fulfillment_batches_project_access
  on public.material_request_fulfillment_batches;
drop policy if exists material_request_fulfillment_batches_select
  on public.material_request_fulfillment_batches;
drop policy if exists material_request_fulfillment_batches_insert
  on public.material_request_fulfillment_batches;
drop policy if exists material_request_fulfillment_batches_update
  on public.material_request_fulfillment_batches;
drop policy if exists material_request_fulfillment_batches_delete
  on public.material_request_fulfillment_batches;

create policy material_request_fulfillment_batches_select
  on public.material_request_fulfillment_batches
  for select
  to authenticated
  using (app_private.material_request_fulfillment_can_view(material_request_id));

create policy material_request_fulfillment_batches_insert
  on public.material_request_fulfillment_batches
  for insert
  to authenticated
  with check (app_private.material_request_fulfillment_can_mutate(material_request_id));

create policy material_request_fulfillment_batches_update
  on public.material_request_fulfillment_batches
  for update
  to authenticated
  using (app_private.material_request_fulfillment_can_mutate(material_request_id))
  with check (app_private.material_request_fulfillment_can_mutate(material_request_id));

create policy material_request_fulfillment_batches_delete
  on public.material_request_fulfillment_batches
  for delete
  to authenticated
  using (app_private.material_request_fulfillment_can_mutate(material_request_id));

drop policy if exists material_request_fulfillment_lines_project_access
  on public.material_request_fulfillment_lines;
drop policy if exists material_request_fulfillment_lines_select
  on public.material_request_fulfillment_lines;
drop policy if exists material_request_fulfillment_lines_insert
  on public.material_request_fulfillment_lines;
drop policy if exists material_request_fulfillment_lines_update
  on public.material_request_fulfillment_lines;
drop policy if exists material_request_fulfillment_lines_delete
  on public.material_request_fulfillment_lines;

create policy material_request_fulfillment_lines_select
  on public.material_request_fulfillment_lines
  for select
  to authenticated
  using (app_private.material_request_fulfillment_line_can_view(material_request_id, batch_id));

create policy material_request_fulfillment_lines_insert
  on public.material_request_fulfillment_lines
  for insert
  to authenticated
  with check (app_private.material_request_fulfillment_line_can_mutate(material_request_id, batch_id));

create policy material_request_fulfillment_lines_update
  on public.material_request_fulfillment_lines
  for update
  to authenticated
  using (app_private.material_request_fulfillment_line_can_mutate(material_request_id, batch_id))
  with check (app_private.material_request_fulfillment_line_can_mutate(material_request_id, batch_id));

create policy material_request_fulfillment_lines_delete
  on public.material_request_fulfillment_lines
  for delete
  to authenticated
  using (app_private.material_request_fulfillment_line_can_mutate(material_request_id, batch_id));

revoke all on table public.material_request_fulfillment_batches from anon;
revoke all on table public.material_request_fulfillment_batches from public;
revoke all on table public.material_request_fulfillment_batches from authenticated;
grant select, insert, update, delete on table public.material_request_fulfillment_batches to authenticated;

revoke all on table public.material_request_fulfillment_lines from anon;
revoke all on table public.material_request_fulfillment_lines from public;
revoke all on table public.material_request_fulfillment_lines from authenticated;
grant select, insert, update, delete on table public.material_request_fulfillment_lines to authenticated;
