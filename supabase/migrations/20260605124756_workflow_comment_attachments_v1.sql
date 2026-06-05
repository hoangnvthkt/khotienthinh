-- Add secure attachments for project workflow subject comments.
-- Files are stored in a private bucket and authorized by workflow subject visibility.

insert into storage.buckets (id, name, public, file_size_limit)
values ('workflow-comment-attachments', 'workflow-comment-attachments', false, 26214400)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

alter table public.workflow_subject_comments
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.workflow_subject_comments
  alter column body set default '',
  alter column body set not null;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.workflow_subject_comments'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%body%'
        or pg_get_constraintdef(oid) ilike '%attachments%'
      )
  loop
    execute format('alter table public.workflow_subject_comments drop constraint if exists %I', v_constraint.conname);
  end loop;
end $$;

alter table public.workflow_subject_comments
  add constraint workflow_subject_comments_content_check
  check (
    jsonb_typeof(attachments) = 'array'
    and length(body) <= 4000
    and (
      length(trim(body)) > 0
      or jsonb_array_length(attachments) > 0
    )
  );

drop policy if exists "workflow_comment_attachments_select" on storage.objects;
create policy "workflow_comment_attachments_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'workflow-comment-attachments'
  and split_part(name, '/', 1) = 'workflow-subjects'
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and app_private.project_workflow_actor_can_select(split_part(name, '/', 2)::uuid)
);

drop policy if exists "workflow_comment_attachments_insert" on storage.objects;
create policy "workflow_comment_attachments_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'workflow-comment-attachments'
  and split_part(name, '/', 1) = 'workflow-subjects'
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and app_private.project_workflow_actor_can_select(split_part(name, '/', 2)::uuid)
);

drop policy if exists "workflow_comment_attachments_delete" on storage.objects;
create policy "workflow_comment_attachments_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'workflow-comment-attachments'
  and split_part(name, '/', 1) = 'workflow-subjects'
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and app_private.project_workflow_actor_can_select(split_part(name, '/', 2)::uuid)
);
