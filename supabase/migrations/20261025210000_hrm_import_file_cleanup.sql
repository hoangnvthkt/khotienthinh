-- Dọn tệp nhập nhân sự hết hạn (follow-up audit 20/10/2026, H4): bucket hrm-private-imports.
--
-- #280 sửa job cleanup-expired-hrm-imports (lỗi 7/7 ngày vì xóa storage.objects bằng SQL — storage.protect_delete chặn)
-- thành chỉ xóa dòng batch. Tệp Excel chứa dữ liệu nhân sự (CCCD, lương…) vì vậy bị bỏ lại. Nay:
--   * app_private.claim_expired_hrm_import_files(limit): tên tệp cần xóa = tệp của batch đã hết hạn (expires_at, mặc định
--     30 ngày) ∪ tệp mồ côi (không batch nào trỏ tới) cũ hơn 31 ngày (quá TTL tối đa nên không đụng tệp đang tải dở).
--   * Edge Function hrm-checkin-photo-retention (cron 20:20 UTC, đã có secret) xóa các tệp đó qua Storage API.
--   * cleanup_expired_hrm_import_batches (cron 02:17 UTC) chỉ xóa dòng batch hết hạn khi tệp đã được xóa → không còn mồ côi.

create or replace function app_private.claim_expired_hrm_import_files(p_limit integer default 200)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select object_row.name
  from storage.objects object_row
  where object_row.bucket_id = 'hrm-private-imports'
    and (
      exists (
        select 1 from public.hrm_import_batches batch
        where batch.source_file_path = object_row.name and batch.expires_at < now()
      )
      or (
        object_row.created_at < now() - interval '31 days'
        and not exists (
          select 1 from public.hrm_import_batches batch
          where batch.source_file_path = object_row.name
        )
      )
    )
  order by object_row.created_at
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

create or replace function public.claim_expired_hrm_import_files(p_limit integer default 200)
returns setof text
language sql
stable
set search_path = ''
as $$
  select app_private.claim_expired_hrm_import_files(p_limit);
$$;

revoke all on function app_private.claim_expired_hrm_import_files(integer) from public, anon, authenticated;
revoke all on function public.claim_expired_hrm_import_files(integer) from public, anon, authenticated;
grant execute on function app_private.claim_expired_hrm_import_files(integer) to service_role;
grant execute on function public.claim_expired_hrm_import_files(integer) to service_role;

-- Batch hết hạn chỉ xóa khi tệp đã đi (Edge Function chạy trước 6 giờ).
create or replace function app_private.cleanup_expired_hrm_import_batches()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  delete from public.hrm_import_batches batch
  where batch.expires_at < now()
    and not exists (
      select 1 from storage.objects object_row
      where object_row.bucket_id = 'hrm-private-imports' and object_row.name = batch.source_file_path
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Tick hằng ngày: gọi worker khi có ảnh chấm công quá 60 ngày HOẶC có tệp nhập nhân sự cần xóa.
create or replace function app_private.checkin_photo_retention_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_secret text; v_request bigint;
begin
  if not exists (
      select 1 from storage.objects
      where bucket_id = 'checkin-photos' and created_at < now() - interval '60 days'
    )
    and not exists (select 1 from app_private.claim_expired_hrm_import_files(1))
  then
    return null;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'send_web_push_secret' limit 1;
  if nullif(v_secret, '') is null then raise exception 'CHECKIN_PHOTO_RETENTION_SECRET_MISSING'; end if;
  select net.http_post(
    url := 'https://ftciqmqhmfvjtwoycswe.supabase.co/functions/v1/hrm-checkin-photo-retention',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-web-push-secret', v_secret),
    body := '{"action":"cleanup"}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_request;
  return v_request;
end;
$$;
