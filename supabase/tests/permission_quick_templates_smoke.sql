begin;

select jsonb_typeof(public.list_permission_quick_templates()) = 'array' as templates_are_listed_as_json_array;

rollback;
