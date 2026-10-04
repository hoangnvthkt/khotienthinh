-- Run last, synthetic benchmark only; never commits.
reset role;
insert into public.office_documents(document_group,document_type_id,title,content,created_by,updated_by,creator_name,status,issued_at,document_date)
 select 'ANNOUNCEMENT',(t.value#>>'{}')::uuid,'Office benchmark '||n,'{"version":1,"type":"doc","content":[]}',p.id,p.id,'Office benchmark','ISSUED',now(),current_date
 from generate_series(1,2000) n cross join office_test_data t cross join office_test_people p where t.key='p1-type' and p.name='author';
analyze public.office_documents;
set local role authenticated;
select pg_temp.office_as('author');
create temporary table office_perf_result(operation text,rows int,elapsed_ms numeric);
do $$ declare started timestamptz; r jsonb; begin
 started:=clock_timestamp();r:=public.office_query('list','{"search":"Office benchmark","pageSize":25}');
 insert into office_perf_result values('list_25_of_2000',(r->>'total')::int,extract(epoch from clock_timestamp()-started)*1000);
 perform pg_temp.office_assert((r->>'total')::int=2000 and jsonb_array_length(r->'items')=25,'benchmark list correct');
 started:=clock_timestamp();r:=public.office_query('report','{"search":"Office benchmark"}');
 insert into office_perf_result values('report_2000',(r->>'total')::int,extract(epoch from clock_timestamp()-started)*1000);
 started:=clock_timestamp();r:=public.office_query('export','{"search":"Office benchmark"}');
 insert into office_perf_result values('export_2000',(r->>'total')::int,extract(epoch from clock_timestamp()-started)*1000);
end $$;
select * from office_perf_result;
