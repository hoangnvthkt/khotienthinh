-- The original remote migration left this public RPC with the full PL/pgSQL
-- command body. Restore the intended invoker boundary around the private,
-- security-definer command that performs its own actor authorization.
create or replace function public.publish_request_template_version(
  p_request_template_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.publish_request_template_version(
    p_request_template_id,
    p_expected_updated_at
  );
$$;

revoke all on function public.publish_request_template_version(uuid, timestamptz)
  from public, anon;
grant execute on function public.publish_request_template_version(uuid, timestamptz)
  to authenticated;
