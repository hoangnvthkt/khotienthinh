-- The request attachment Edge Function uses the service-role client through
-- the Data API. Keep the privileged implementations private and expose only
-- invoker wrappers that are executable by service_role.
create function public.finalize_request_attachment(
  p_attachment_id uuid,
  p_success boolean,
  p_variants jsonb default '{}',
  p_failure_code text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.finalize_request_attachment(
    p_attachment_id,
    p_success,
    p_variants,
    p_failure_code
  );
$$;
revoke all on function public.finalize_request_attachment(uuid, boolean, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.finalize_request_attachment(uuid, boolean, jsonb, text)
  to service_role;

create function public.claim_request_attachment_cleanup(p_limit integer default 30)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.claim_request_attachment_cleanup(p_limit);
$$;
revoke all on function public.claim_request_attachment_cleanup(integer)
  from public, anon, authenticated;
grant execute on function public.claim_request_attachment_cleanup(integer)
  to service_role;

create function public.finish_request_attachment_cleanup(
  p_id uuid,
  p_token uuid,
  p_success boolean
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select app_private.finish_request_attachment_cleanup(p_id, p_token, p_success);
$$;
revoke all on function public.finish_request_attachment_cleanup(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.finish_request_attachment_cleanup(uuid, uuid, boolean)
  to service_role;
