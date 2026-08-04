-- The helper accepts an explicit actor only for trusted SECURITY DEFINER
-- callers. Client-facing checks use current-actor RPCs/wrappers instead.
revoke all on function app_private.daily_log_has_action(text, text, text, uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
