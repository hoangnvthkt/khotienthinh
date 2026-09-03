insert into storage.buckets (id, name, public)
values ('contract-files', 'contract-files', false)
on conflict (id) do update
set public = false;

drop policy if exists contract_files_select on storage.objects;
create policy contract_files_select
on storage.objects
for select
to authenticated
using (bucket_id = 'contract-files');

drop policy if exists contract_files_insert on storage.objects;
create policy contract_files_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'contract-files'
  and public.is_module_admin('HD')
);

drop policy if exists contract_files_update on storage.objects;
create policy contract_files_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'contract-files'
  and public.is_module_admin('HD')
)
with check (
  bucket_id = 'contract-files'
  and public.is_module_admin('HD')
);

drop policy if exists contract_files_delete on storage.objects;
create policy contract_files_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'contract-files'
  and public.is_module_admin('HD')
);
