-- Public wrappers are security invoker functions. The worker alone must be
-- allowed to resolve their three private outbox operations; no table grant is
-- needed because each operation is SECURITY DEFINER and checks auth.role().
grant execute on function app_private.claim_request_notification_outbox(integer) to service_role;
grant execute on function app_private.deliver_request_notification(uuid) to service_role;
grant execute on function app_private.fail_request_notification_outbox(uuid, text) to service_role;
