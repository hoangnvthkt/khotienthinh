with schemas as (select oid,nspname from pg_namespace where nspname in ('public','app_private','private','supabase_migrations')),
objects as (
select 'schema' kind,n.nspname::text key,jsonb_build_array(pg_get_userbyid(n.nspowner),(select array_agg(a::text order by a::text) from unnest(n.nspacl) a)) value from pg_namespace n where n.oid in(select oid from schemas)
union all
select 'relation' kind,n.nspname::text||'.'||c.relname key,jsonb_build_array(c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relreplident,c.reloptions,pg_get_userbyid(c.relowner),(select array_agg(x::text order by x::text) from unnest(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) x)) value from pg_class c join schemas n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m','S') and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
union all
select 'column',n.nspname::text||'.'||c.relname||'.'||a.attname,jsonb_build_array(row_number() over (partition by c.oid order by a.attnum),format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),(select array_agg(x::text order by x::text) from unnest(a.attacl) x)) from pg_attribute a join pg_class c on c.oid=a.attrelid join schemas n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v','m')
union all
select 'constraint',n.nspname::text||'.'||c.relname||'.'||x.conname,jsonb_build_array(pg_get_constraintdef(x.oid,true),x.convalidated,x.condeferrable,x.condeferred) from pg_constraint x join pg_class c on c.oid=x.conrelid join schemas n on n.oid=c.relnamespace
union all
select 'index',n.nspname::text||'.'||c.relname,jsonb_build_array(pg_get_indexdef(c.oid),i.indisvalid,i.indisready) from pg_index i join pg_class c on c.oid=i.indexrelid join schemas n on n.oid=c.relnamespace
union all
select 'function',n.nspname::text||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),(select array_agg(x::text order by x::text) from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) x)) from pg_proc p join schemas n on n.oid=p.pronamespace where p.prokind in ('f','p') and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
union all
select 'trigger',n.nspname::text||'.'||c.relname||'.'||t.tgname,jsonb_build_array(pg_get_triggerdef(t.oid,true),t.tgenabled) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and (n.oid in(select oid from schemas) or (n.nspname in ('auth','storage') and t.tgfoid in(select p.oid from pg_proc p where p.pronamespace in(select oid from schemas))))
union all
select 'policy',schemaname::text||'.'||tablename||'.'||policyname,jsonb_build_array(permissive,roles,cmd,qual,with_check) from pg_policies where schemaname in ('public','app_private','private','auth','storage')
union all
select 'view',n.nspname::text||'.'||c.relname,to_jsonb(pg_get_viewdef(c.oid,true)) from pg_class c join schemas n on n.oid=c.relnamespace where c.relkind in ('v','m')
union all
select 'enum',n.nspname::text||'.'||t.typname,to_jsonb(array_agg(e.enumlabel order by e.enumsortorder)) from pg_type t join schemas n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid group by 1,2
union all
select 'sequence',schemaname::text||'.'||sequencename,jsonb_build_array(sequenceowner,data_type::text,start_value,min_value,max_value,increment_by,cycle,cache_size) from pg_sequences where schemaname in ('public','app_private','private')
union all
select 'default_acl',n.nspname::text||'.'||pg_get_userbyid(d.defaclrole)||'.'||d.defaclobjtype::text,to_jsonb((select array_agg(x::text order by x::text) from unnest(d.defaclacl) x)) from pg_default_acl d join schemas n on n.oid=d.defaclnamespace
)
select kind,key,md5(value::text) hash from objects order by kind,key;
