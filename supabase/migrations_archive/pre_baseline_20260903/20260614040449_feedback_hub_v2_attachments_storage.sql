-- Feedback Hub V2: private attachment storage.
-- Files live in Storage; metadata lives in public.feedback_attachments.

insert into storage.buckets (id, name, public, file_size_limit)
values ('feedback-attachments', 'feedback-attachments', false, 26214400)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create index if not exists idx_feedback_attachments_bucket_path
  on public.feedback_attachments(storage_bucket, storage_path);

drop trigger if exists trg_feedback_attachments_touch_item on public.feedback_attachments;
create trigger trg_feedback_attachments_touch_item
after insert or delete on public.feedback_attachments
for each row execute function app_private.touch_feedback_item_activity();

drop policy if exists "feedback_attachments_storage_select" on storage.objects;
create policy "feedback_attachments_storage_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'feedback-attachments'
  and split_part(name, '/', 1) = 'feedback'
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and app_private.feedback_item_can_select(split_part(name, '/', 2)::uuid)
);

drop policy if exists "feedback_attachments_storage_insert" on storage.objects;
create policy "feedback_attachments_storage_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'feedback-attachments'
  and split_part(name, '/', 1) = 'feedback'
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and app_private.feedback_item_can_select(split_part(name, '/', 2)::uuid)
);

drop policy if exists "feedback_attachments_storage_delete" on storage.objects;
create policy "feedback_attachments_storage_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'feedback-attachments'
  and split_part(name, '/', 1) = 'feedback'
  and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (
    exists (
      select 1
      from public.feedback_attachments fa
      where fa.storage_bucket = 'feedback-attachments'
        and fa.storage_path = storage.objects.name
        and (
          fa.uploaded_by = public.current_app_user_id()
          or app_private.feedback_can_manage()
        )
    )
    or owner_id = (select auth.uid()::text)
  )
);

notify pgrst, 'reload schema';
