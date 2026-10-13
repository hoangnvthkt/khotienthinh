-- Skill tab Trợ lý: có đủ 2 dòng, bậc nền, đang bật. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261013170000_ai_skills_center.sql --smoke supabase/tests/ai_skills_center_smoke.sql
do $$
begin
  if (select count(*) from public.ai_skills where code in ('center_question', 'morning_brief') and tier = 'base' and mode = 'read' and enabled) <> 2 then
    raise exception 'FAIL thiếu skill tab Trợ lý';
  end if;
  if (select daily_limit from public.ai_skills where code = 'center_question') <> 40 then raise exception 'FAIL hạn mức center_question'; end if;
  raise notice 'ai_skills_center_smoke OK';
end $$;
