-- Gợi ý in mờ — bảng đo. Chạy rollback trên Cloud (không ghi sổ):
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261013080000_ui_suggestion_events.sql --smoke supabase/tests/ui_suggestion_events_smoke.sql
do $$
begin
  if to_regclass('public.ui_suggestion_events') is null then raise exception 'FAIL 1 thiếu bảng ui_suggestion_events'; end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ui_suggestion_events') <> 2 then
    raise exception 'FAIL 2 thiếu policy ghi / đọc'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.ui_suggestion_events'::regclass) then raise exception 'FAIL 3 chưa bật RLS'; end if;
  -- 4. Không có người dùng: không ghi được (user_id mặc định rỗng).
  begin
    insert into public.ui_suggestion_events (screen, field, outcome) values ('smoke', 'labor', 'accepted');
    raise exception 'FAIL 4 không có người dùng vẫn ghi được';
  exception when not_null_violation or check_violation then null; end;
  -- 5. Kết quả ngoài 3 giá trị bị từ chối.
  begin
    insert into public.ui_suggestion_events (user_id, screen, field, outcome) values ((select id from public.users limit 1), 'smoke', 'labor', 'maybe');
    raise exception 'FAIL 5 outcome lạ vẫn ghi được';
  exception when check_violation then null; end;
  raise notice 'ui_suggestion_events_smoke OK';
end $$;
