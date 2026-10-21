-- Realtime (audit 20/10/2026, mục H2, PR-1): rút publication supabase_realtime về đúng các bảng client đang nghe.
--
-- Publication có 67 bảng nhưng mã client chỉ đăng ký postgres_changes trên 43 bảng. 24 bảng còn lại vẫn được Realtime
-- giải mã từ WAL và đối chiếu với mọi subscription dù không ai nghe; trong đó user_permission_grants (~2.300 ghi/giờ),
-- employees (~1.100), hrm_employee_compensation_assignments (~500) chiếm ≈22 % số thay đổi được publish.
-- Rà bằng: grep "table: '<bảng>'" + REALTIME_TABLES_BY_MODULE trong pages/components/lib/context/hooks, và
-- realtime.subscription trên Cloud (121 subscription, 10 bảng). hrm_construction_sites còn tham chiếu nên giữ.
-- Không ảnh hưởng chức năng: bảng không có subscription thì không có sự kiện nào bị mất. Thêm lại khi cần:
--   alter publication supabase_realtime add table public.<bảng>;

do $$
declare
  t text;
begin
  foreach t in array array[
    'ai_business_glossary', 'ai_business_rules', 'ai_chat_runs', 'ai_feedback', 'ai_memory',
    'employees',
    'hrm_3p_bands', 'hrm_3p_grade_band_rates', 'hrm_catalog_items', 'hrm_compensation_plans',
    'hrm_competency_groups', 'hrm_competency_levels', 'hrm_employee_compensation_assignments', 'hrm_org_blocks',
    'hrm_payroll_components', 'hrm_payroll_import_batches', 'hrm_payroll_import_rows',
    'hrm_position_groups', 'hrm_position_levels', 'hrm_position_salary_mappings',
    'user_authorization_refresh_events', 'user_permission_grants',
    'workflow_instance_comments'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;
