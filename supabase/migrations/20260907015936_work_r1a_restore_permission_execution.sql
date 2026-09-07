-- Restore the pre-Work execution privilege used by existing RLS policies.
-- This private helper still evaluates canonical Work grants and denies null actors.
grant execute on function app_private.has_permission(uuid, text, text, text)
  to authenticated;
