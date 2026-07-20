-- Phase 4 global seed-only module enforcement.
-- Adapter-first rollout for AI, Storage, KB, and Analytics while legacy fallback
-- remains enabled until Phase 5 hardening flips its flags.

create or replace function app_private.ai_has_action(
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_permission_code like 'ai.%'
    and app_private.global_has_action(p_permission_code, 'AI', p_user_id);
$$;

revoke all on function app_private.ai_has_action(text, uuid) from public, anon;
grant execute on function app_private.ai_has_action(text, uuid) to authenticated;

create or replace function app_private.storage_has_action(
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_permission_code like 'storage.%'
    and app_private.global_has_action(p_permission_code, 'STORAGE', p_user_id);
$$;

revoke all on function app_private.storage_has_action(text, uuid) from public, anon;
grant execute on function app_private.storage_has_action(text, uuid) to authenticated;

create or replace function app_private.kb_has_action(
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_permission_code like 'kb.%'
    and app_private.global_has_action(p_permission_code, 'KB', p_user_id);
$$;

revoke all on function app_private.kb_has_action(text, uuid) from public, anon;
grant execute on function app_private.kb_has_action(text, uuid) to authenticated;

create or replace function app_private.analytics_has_action(
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_permission_code like 'analytics.%'
    and app_private.global_has_action(p_permission_code, 'ANALYTICS', p_user_id);
$$;

revoke all on function app_private.analytics_has_action(text, uuid) from public, anon;
grant execute on function app_private.analytics_has_action(text, uuid) to authenticated;

-- AI assistant and AI learning tables: explicit assistant use for owner paths,
-- existing Settings AI Learning management remains the admin path.
do $$
begin
  if to_regclass('public.ai_conversations') is not null then
    execute 'revoke all privileges on table public.ai_conversations from anon';

    execute 'drop policy if exists ai_conversations_select on public.ai_conversations';
    execute 'drop policy if exists ai_conversations_insert on public.ai_conversations';
    execute 'drop policy if exists ai_conversations_update on public.ai_conversations';
    execute 'drop policy if exists ai_conversations_delete on public.ai_conversations';

    execute $policy$
      create policy ai_conversations_select on public.ai_conversations
        for select to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
    execute $policy$
      create policy ai_conversations_insert on public.ai_conversations
        for insert to authenticated
        with check (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
    execute $policy$
      create policy ai_conversations_update on public.ai_conversations
        for update to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
        with check (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
    execute $policy$
      create policy ai_conversations_delete on public.ai_conversations
        for delete to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
  end if;

  if to_regclass('public.ai_messages') is not null then
    execute 'revoke all privileges on table public.ai_messages from anon';

    execute 'drop policy if exists ai_messages_select on public.ai_messages';
    execute 'drop policy if exists ai_messages_insert on public.ai_messages';
    execute 'drop policy if exists ai_messages_update on public.ai_messages';

    execute $policy$
      create policy ai_messages_select on public.ai_messages
        for select to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and exists (
              select 1
              from public.ai_conversations c
              where c.id = ai_messages.conversation_id
                and c.user_id = public.current_app_user_id()::text
            )
          )
        )
    $policy$;
    execute $policy$
      create policy ai_messages_insert on public.ai_messages
        for insert to authenticated
        with check (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and exists (
              select 1
              from public.ai_conversations c
              where c.id = ai_messages.conversation_id
                and c.user_id = public.current_app_user_id()::text
            )
          )
        )
    $policy$;
    execute $policy$
      create policy ai_messages_update on public.ai_messages
        for update to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and exists (
              select 1
              from public.ai_conversations c
              where c.id = ai_messages.conversation_id
                and c.user_id = public.current_app_user_id()::text
            )
          )
        )
        with check (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and exists (
              select 1
              from public.ai_conversations c
              where c.id = ai_messages.conversation_id
                and c.user_id = public.current_app_user_id()::text
            )
          )
        )
    $policy$;
  end if;

  if to_regclass('public.ai_feedback') is not null then
    execute 'revoke all privileges on table public.ai_feedback from anon';

    execute 'drop policy if exists ai_feedback_select on public.ai_feedback';
    execute 'drop policy if exists ai_feedback_insert on public.ai_feedback';
    execute 'drop policy if exists ai_feedback_update on public.ai_feedback';
    execute 'drop policy if exists ai_feedback_delete on public.ai_feedback';

    execute $policy$
      create policy ai_feedback_select on public.ai_feedback
        for select to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
    execute $policy$
      create policy ai_feedback_insert on public.ai_feedback
        for insert to authenticated
        with check (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
    execute $policy$
      create policy ai_feedback_update on public.ai_feedback
        for update to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
        with check (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
    execute $policy$
      create policy ai_feedback_delete on public.ai_feedback
        for delete to authenticated
        using (public.can_manage_ai_learning())
    $policy$;
  end if;

  if to_regclass('public.ai_chat_runs') is not null then
    execute 'revoke all privileges on table public.ai_chat_runs from anon';

    execute 'drop policy if exists ai_chat_runs_select on public.ai_chat_runs';
    execute 'drop policy if exists ai_chat_runs_insert on public.ai_chat_runs';

    execute $policy$
      create policy ai_chat_runs_select on public.ai_chat_runs
        for select to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
    execute $policy$
      create policy ai_chat_runs_insert on public.ai_chat_runs
        for insert to authenticated
        with check (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
  end if;

  if to_regclass('public.ai_user_preferences') is not null then
    execute 'revoke all privileges on table public.ai_user_preferences from anon';

    execute 'drop policy if exists ai_user_preferences_select on public.ai_user_preferences';
    execute 'drop policy if exists ai_user_preferences_insert on public.ai_user_preferences';
    execute 'drop policy if exists ai_user_preferences_update on public.ai_user_preferences';

    execute $policy$
      create policy ai_user_preferences_select on public.ai_user_preferences
        for select to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
    execute $policy$
      create policy ai_user_preferences_insert on public.ai_user_preferences
        for insert to authenticated
        with check (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
    execute $policy$
      create policy ai_user_preferences_update on public.ai_user_preferences
        for update to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
        with check (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.ai_memory') is not null then
    execute 'revoke all privileges on table public.ai_memory from anon';

    execute 'drop policy if exists ai_memory_select on public.ai_memory';
    execute 'drop policy if exists ai_memory_insert on public.ai_memory';
    execute 'drop policy if exists ai_memory_update on public.ai_memory';
    execute 'drop policy if exists ai_memory_delete on public.ai_memory';

    execute $policy$
      create policy ai_memory_select on public.ai_memory
        for select to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and (
              user_id = public.current_app_user_id()::text
              or (status = 'approved' and scope in ('enterprise', 'domain'))
            )
          )
        )
    $policy$;
    execute $policy$
      create policy ai_memory_insert on public.ai_memory
        for insert to authenticated
        with check (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and scope = 'user'
            and user_id = public.current_app_user_id()::text
          )
        )
    $policy$;
    execute $policy$
      create policy ai_memory_update on public.ai_memory
        for update to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and scope = 'user'
            and user_id = public.current_app_user_id()::text
            and status = 'pending'
          )
        )
        with check (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and scope = 'user'
            and user_id = public.current_app_user_id()::text
            and status = 'pending'
          )
        )
    $policy$;
    execute $policy$
      create policy ai_memory_delete on public.ai_memory
        for delete to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and scope = 'user'
            and user_id = public.current_app_user_id()::text
            and status = 'pending'
          )
        )
    $policy$;
  end if;

  if to_regclass('public.ai_business_rules') is not null then
    execute 'revoke all privileges on table public.ai_business_rules from anon';

    execute 'drop policy if exists ai_business_rules_select on public.ai_business_rules';
    execute 'drop policy if exists ai_business_rules_manage on public.ai_business_rules';

    execute $policy$
      create policy ai_business_rules_select on public.ai_business_rules
        for select to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and status = 'approved'
          )
        )
    $policy$;
    execute $policy$
      create policy ai_business_rules_manage on public.ai_business_rules
        for all to authenticated
        using (public.can_manage_ai_learning())
        with check (public.can_manage_ai_learning())
    $policy$;
  end if;

  if to_regclass('public.ai_business_glossary') is not null then
    execute 'revoke all privileges on table public.ai_business_glossary from anon';

    execute 'drop policy if exists ai_business_glossary_select on public.ai_business_glossary';
    execute 'drop policy if exists ai_business_glossary_manage on public.ai_business_glossary';

    execute $policy$
      create policy ai_business_glossary_select on public.ai_business_glossary
        for select to authenticated
        using (
          public.can_manage_ai_learning()
          or (
            app_private.ai_has_action('ai.assistant.use')
            and status = 'approved'
          )
        )
    $policy$;
    execute $policy$
      create policy ai_business_glossary_manage on public.ai_business_glossary
        for all to authenticated
        using (public.can_manage_ai_learning())
        with check (public.can_manage_ai_learning())
    $policy$;
  end if;

  if to_regclass('public.ai_query_patterns') is not null then
    execute 'revoke all privileges on table public.ai_query_patterns from anon';
  end if;
end $$;

-- Executive AI and scheduled AI report data.
do $$
begin
  if to_regclass('public.ai_project_insights') is not null then
    execute 'revoke all privileges on table public.ai_project_insights from anon';

    execute 'drop policy if exists "Allow all for ai_project_insights" on public.ai_project_insights';
    execute 'drop policy if exists ai_project_insights_select_phase4 on public.ai_project_insights';
    execute 'drop policy if exists ai_project_insights_admin_write_phase4 on public.ai_project_insights';

    execute $policy$
      create policy ai_project_insights_select_phase4 on public.ai_project_insights
        for select to authenticated
        using (app_private.ai_has_action('ai.executive.view'))
    $policy$;
    execute $policy$
      create policy ai_project_insights_admin_write_phase4 on public.ai_project_insights
        for all to authenticated
        using (public.is_admin())
        with check (public.is_admin())
    $policy$;
  end if;

  if to_regclass('public.ai_smart_alerts') is not null then
    execute 'revoke all privileges on table public.ai_smart_alerts from anon';

    execute 'drop policy if exists "Allow all for ai_smart_alerts" on public.ai_smart_alerts';
    execute 'drop policy if exists ai_smart_alerts_select_phase4 on public.ai_smart_alerts';
    execute 'drop policy if exists ai_smart_alerts_admin_write_phase4 on public.ai_smart_alerts';

    execute $policy$
      create policy ai_smart_alerts_select_phase4 on public.ai_smart_alerts
        for select to authenticated
        using (app_private.ai_has_action('ai.executive.view'))
    $policy$;
    execute $policy$
      create policy ai_smart_alerts_admin_write_phase4 on public.ai_smart_alerts
        for all to authenticated
        using (public.is_admin())
        with check (public.is_admin())
    $policy$;
  end if;

  if to_regclass('public.ai_query_cache') is not null then
    execute 'revoke all privileges on table public.ai_query_cache from anon, authenticated';
    execute 'grant select, insert, update, delete on table public.ai_query_cache to service_role';

    execute 'drop policy if exists ai_query_cache_all on public.ai_query_cache';
    execute 'drop policy if exists ai_query_cache_service_role_phase4 on public.ai_query_cache';
    execute $policy$
      create policy ai_query_cache_service_role_phase4 on public.ai_query_cache
        for all to service_role
        using (auth.role() = 'service_role')
        with check (auth.role() = 'service_role')
    $policy$;
  end if;

  if to_regclass('public.ai_scheduled_reports') is not null then
    execute 'revoke all privileges on table public.ai_scheduled_reports from anon';

    execute 'drop policy if exists "Authenticated users can read reports" on public.ai_scheduled_reports';
    execute 'drop policy if exists "Authenticated users can manage reports" on public.ai_scheduled_reports';
    execute 'drop policy if exists ai_scheduled_reports_select_phase4 on public.ai_scheduled_reports';
    execute 'drop policy if exists ai_scheduled_reports_generate_phase4 on public.ai_scheduled_reports';

    execute $policy$
      create policy ai_scheduled_reports_select_phase4 on public.ai_scheduled_reports
        for select to authenticated
        using (
          app_private.ai_has_action('ai.report.view')
          or app_private.ai_has_action('ai.report.generate')
        )
    $policy$;
    execute $policy$
      create policy ai_scheduled_reports_generate_phase4 on public.ai_scheduled_reports
        for all to authenticated
        using (app_private.ai_has_action('ai.report.generate'))
        with check (app_private.ai_has_action('ai.report.generate'))
    $policy$;
  end if;

  if to_regclass('public.ai_report_results') is not null then
    execute 'revoke all privileges on table public.ai_report_results from anon';

    execute 'drop policy if exists "Authenticated users can read results" on public.ai_report_results';
    execute 'drop policy if exists "Authenticated users can manage results" on public.ai_report_results';
    execute 'drop policy if exists ai_report_results_select_phase4 on public.ai_report_results';
    execute 'drop policy if exists ai_report_results_generate_phase4 on public.ai_report_results';

    execute $policy$
      create policy ai_report_results_select_phase4 on public.ai_report_results
        for select to authenticated
        using (
          app_private.ai_has_action('ai.report.view')
          or app_private.ai_has_action('ai.report.generate')
        )
    $policy$;
    execute $policy$
      create policy ai_report_results_generate_phase4 on public.ai_report_results
        for all to authenticated
        using (app_private.ai_has_action('ai.report.generate'))
        with check (app_private.ai_has_action('ai.report.generate'))
    $policy$;
  end if;
end $$;

-- KB RLS and storage policies.
do $$
begin
  if to_regclass('public.rag_documents') is not null then
    execute 'revoke all privileges on table public.rag_documents from anon';
    execute 'grant select, insert, update, delete on table public.rag_documents to authenticated';

    execute 'drop policy if exists "Allow service_role full access rag_documents" on public.rag_documents';
    execute 'drop policy if exists rag_documents_select on public.rag_documents';
    execute 'drop policy if exists rag_documents_insert on public.rag_documents';
    execute 'drop policy if exists rag_documents_update on public.rag_documents';
    execute 'drop policy if exists rag_documents_delete on public.rag_documents';

    execute $policy$
      create policy rag_documents_select on public.rag_documents
        for select to authenticated
        using (
          app_private.kb_has_action('kb.view')
          or app_private.kb_has_action('kb.manage')
        )
    $policy$;
    execute $policy$
      create policy rag_documents_insert on public.rag_documents
        for insert to authenticated
        with check (app_private.kb_has_action('kb.manage'))
    $policy$;
    execute $policy$
      create policy rag_documents_update on public.rag_documents
        for update to authenticated
        using (app_private.kb_has_action('kb.manage'))
        with check (app_private.kb_has_action('kb.manage'))
    $policy$;
    execute $policy$
      create policy rag_documents_delete on public.rag_documents
        for delete to authenticated
        using (app_private.kb_has_action('kb.manage'))
    $policy$;
  end if;

  if to_regclass('public.rag_chunks') is not null then
    execute 'revoke all privileges on table public.rag_chunks from anon';
    execute 'grant select, insert, update, delete on table public.rag_chunks to authenticated';

    execute 'drop policy if exists "Allow service_role full access rag_chunks" on public.rag_chunks';
    execute 'drop policy if exists rag_chunks_select on public.rag_chunks';
    execute 'drop policy if exists rag_chunks_insert on public.rag_chunks';
    execute 'drop policy if exists rag_chunks_update on public.rag_chunks';
    execute 'drop policy if exists rag_chunks_delete on public.rag_chunks';

    execute $policy$
      create policy rag_chunks_select on public.rag_chunks
        for select to authenticated
        using (
          app_private.kb_has_action('kb.view')
          or app_private.kb_has_action('kb.manage')
        )
    $policy$;
    execute $policy$
      create policy rag_chunks_insert on public.rag_chunks
        for insert to authenticated
        with check (app_private.kb_has_action('kb.manage'))
    $policy$;
    execute $policy$
      create policy rag_chunks_update on public.rag_chunks
        for update to authenticated
        using (app_private.kb_has_action('kb.manage'))
        with check (app_private.kb_has_action('kb.manage'))
    $policy$;
    execute $policy$
      create policy rag_chunks_delete on public.rag_chunks
        for delete to authenticated
        using (app_private.kb_has_action('kb.manage'))
    $policy$;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "Allow all reads from knowledge-base" on storage.objects';
    execute 'drop policy if exists "Allow all uploads to knowledge-base" on storage.objects';
    execute 'drop policy if exists "Allow all updates to knowledge-base" on storage.objects';
    execute 'drop policy if exists "Allow all deletes from knowledge-base" on storage.objects';
    execute 'drop policy if exists knowledge_base_select_phase4 on storage.objects';
    execute 'drop policy if exists knowledge_base_insert_phase4 on storage.objects';
    execute 'drop policy if exists knowledge_base_update_phase4 on storage.objects';
    execute 'drop policy if exists knowledge_base_delete_phase4 on storage.objects';

    execute $policy$
      create policy knowledge_base_select_phase4 on storage.objects
        for select to authenticated
        using (
          bucket_id = 'knowledge-base'
          and (
            app_private.kb_has_action('kb.view')
            or app_private.kb_has_action('kb.manage')
          )
        )
    $policy$;
    execute $policy$
      create policy knowledge_base_insert_phase4 on storage.objects
        for insert to authenticated
        with check (
          bucket_id = 'knowledge-base'
          and app_private.kb_has_action('kb.manage')
        )
    $policy$;
    execute $policy$
      create policy knowledge_base_update_phase4 on storage.objects
        for update to authenticated
        using (
          bucket_id = 'knowledge-base'
          and app_private.kb_has_action('kb.manage')
        )
        with check (
          bucket_id = 'knowledge-base'
          and app_private.kb_has_action('kb.manage')
        )
    $policy$;
    execute $policy$
      create policy knowledge_base_delete_phase4 on storage.objects
        for delete to authenticated
        using (
          bucket_id = 'knowledge-base'
          and app_private.kb_has_action('kb.manage')
        )
    $policy$;
  end if;
end $$;

notify pgrst, 'reload schema';
