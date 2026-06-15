-- Index cleanup candidates for review only.
-- Read-only: this file does not drop indexes.
-- Run with:
--   npx supabase db query --linked -f supabase/perf/index_cleanup_candidates.sql

with index_stats as (
  select
    schemaname,
    relname as table_name,
    indexrelname as index_name,
    s.relid,
    s.indexrelid,
    coalesce(idx_scan, 0) as idx_scan,
    coalesce(idx_tup_read, 0) as idx_tup_read,
    coalesce(idx_tup_fetch, 0) as idx_tup_fetch,
    pg_relation_size(s.indexrelid) as index_size_bytes,
    pg_size_pretty(pg_relation_size(s.indexrelid)) as index_size,
    i.indisprimary,
    i.indisunique,
    i.indisvalid,
    i.indisready,
    i.indpred is not null as is_partial,
    exists (
      select 1
      from pg_constraint c
      where c.conindid = s.indexrelid
    ) as backs_constraint,
    pg_get_indexdef(s.indexrelid) as indexdef,
    (
      select array_agg(att.attname order by ord.n)
      from unnest(i.indkey) with ordinality as ord(attnum, n)
      join pg_attribute att
        on att.attrelid = s.relid
       and att.attnum = ord.attnum
      where ord.attnum > 0
    ) as index_columns
  from pg_stat_user_indexes s
  join pg_index i on i.indexrelid = s.indexrelid
  where schemaname = 'public'
),
candidate_reasons as (
  select
    idx.*,
    case
      when idx.idx_scan = 0 then 'unused_idx_scan_0'
      when exists (
        select 1
        from index_stats wider
        where wider.relid = idx.relid
          and wider.indexrelid <> idx.indexrelid
          and wider.indisvalid
          and wider.indisready
          and not wider.indisprimary
          and wider.index_columns[1:cardinality(idx.index_columns)] = idx.index_columns
          and cardinality(wider.index_columns) > cardinality(idx.index_columns)
      ) then 'prefix_covered_by_wider_index'
      else null
    end as candidate_reason
  from index_stats idx
  where not idx.indisprimary
    and not idx.indisunique
    and not idx.backs_constraint
    and idx.indisvalid
    and idx.indisready
)
select
  candidate_reason,
  schemaname,
  table_name,
  index_name,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  index_size,
  index_size_bytes,
  is_partial,
  index_columns,
  indexdef
from candidate_reasons
where candidate_reason is not null
order by
  case candidate_reason
    when 'unused_idx_scan_0' then 1
    when 'prefix_covered_by_wider_index' then 2
    else 9
  end,
  index_size_bytes desc,
  table_name,
  index_name;
