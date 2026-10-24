begin;
-- Sau khi áp migration: ảnh chỉ cần thumbnail + display; các chốt an toàn khác còn nguyên.
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_private' and p.proname = 'work_finish_attachment';
  if v_src is null then raise exception 'SMOKE: không tìm thấy app_private.work_finish_attachment'; end if;
  if v_src like '%?& array[''thumbnail'',''display'',''fallback'']%' then
    raise exception 'SMOKE: vẫn còn bắt buộc biến thể fallback';
  end if;
  if v_src not like '%?& array[''thumbnail'',''display'']%' then
    raise exception 'SMOKE: thiếu ràng buộc thumbnail + display';
  end if;
  if v_src not like '%work_require_notification_worker%'
     or v_src not like '%work_attachment_can_mutate%'
     or v_src not like '%WORK_INVALID_VARIANTS%' then
    raise exception 'SMOKE: mất chốt an toàn của hàm';
  end if;
  raise notice 'SMOKE OK: work_finish_attachment chấp nhận ảnh không có fallback';
end $$;
rollback;
