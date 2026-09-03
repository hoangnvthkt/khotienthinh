-- Secure database access helpers for the AI assistant.
-- These helpers are intended to be called by the ai-assistant Edge Function
-- with SUPABASE_SERVICE_ROLE_KEY, not directly from the browser.

create or replace function public.ai_database_catalog()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'table', table_name,
        'columns', columns
      )
      order by table_name
    ),
    '[]'::jsonb
  )
  from (
    select
      c.table_name,
      jsonb_agg(
        jsonb_build_object(
          'name', c.column_name,
          'type', c.data_type,
          'nullable', c.is_nullable = 'YES'
        )
        order by c.ordinal_position
      ) as columns
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name not like 'pg_%'
      and c.table_name not in ('app_code_counters')
    group by c.table_name
  ) s;
$$;

create or replace function public.execute_ai_readonly_query(p_query text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sql text := trim(coalesce(p_query, ''));
  v_lower text;
  v_rows jsonb;
  v_row_count integer;
begin
  v_sql := regexp_replace(v_sql, ';\s*$', '');
  v_lower := lower(v_sql);

  if v_sql = '' or v_lower !~ '^\s*(select|with)\s' then
    raise exception 'AI query must be SELECT-only';
  end if;

  if v_sql like '%;%' then
    raise exception 'AI query must contain a single statement';
  end if;

  if v_sql ~ '(--|/\*)' then
    raise exception 'AI query comments are not allowed';
  end if;

  if v_lower ~ '(^|[^a-z_])(insert|update|delete|drop|alter|truncate|grant|revoke|create|replace|merge|call|copy|do|execute|notify|listen|vacuum|analyze|set|reset|refresh)([^a-z_]|$)' then
    raise exception 'AI query contains a blocked keyword';
  end if;

  if v_lower ~ '(^|[^a-z_])(auth|storage|vault|net|extensions|pg_catalog|information_schema)\s*\.' then
    raise exception 'AI query references a blocked schema';
  end if;

  perform set_config('statement_timeout', '5000', true);

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(ai_limited)), ''[]''::jsonb)
       from (select * from (%s) ai_source limit 500) ai_limited',
    v_sql
  )
  into v_rows;

  v_row_count := coalesce(jsonb_array_length(v_rows), 0);
  return jsonb_build_object(
    'rows', v_rows,
    'rowCount', v_row_count,
    'limited', v_row_count >= 500
  );
end;
$$;

create or replace function public.ai_search_knowledge(p_query text, p_limit integer default 8)
returns table (
  document_id text,
  title text,
  file_name text,
  content text,
  rank real
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_content_column text;
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 20);
begin
  if to_regclass('public.rag_chunks') is null or to_regclass('public.rag_documents') is null then
    return;
  end if;

  select column_name
    into v_content_column
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'rag_chunks'
    and column_name in ('content', 'chunk_text', 'text')
  order by case column_name when 'content' then 1 when 'chunk_text' then 2 else 3 end
  limit 1;

  if v_content_column is null then
    return;
  end if;

  return query execute format(
    'select
       c.document_id::text,
       d.title::text,
       d.file_name::text,
       left(c.%1$I::text, 1800) as content,
       ts_rank_cd(to_tsvector(''simple'', coalesce(c.%1$I::text, '''')), plainto_tsquery(''simple'', $1))::real as rank
     from public.rag_chunks c
     join public.rag_documents d on d.id = c.document_id
     where coalesce(d.status, ''ready'') = ''ready''
       and to_tsvector(''simple'', coalesce(c.%1$I::text, '''')) @@ plainto_tsquery(''simple'', $1)
     order by rank desc
     limit $2',
    v_content_column
  )
  using p_query, v_limit;
end;
$$;

revoke all on function public.ai_database_catalog() from public;
revoke all on function public.execute_ai_readonly_query(text) from public;
revoke all on function public.ai_search_knowledge(text, integer) from public;

revoke execute on function public.ai_database_catalog() from anon, authenticated;
revoke execute on function public.execute_ai_readonly_query(text) from anon, authenticated;
revoke execute on function public.ai_search_knowledge(text, integer) from anon, authenticated;

grant execute on function public.ai_database_catalog() to service_role;
grant execute on function public.execute_ai_readonly_query(text) to service_role;
grant execute on function public.ai_search_knowledge(text, integer) to service_role;

notify pgrst, 'reload schema';
