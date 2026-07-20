-- DELAYED ROLLOUT: DO NOT APPLY until the email-only frontend has been
-- stable in production for 24 hours and every gate in
-- docs/security/permission-audit.md has passed.
revoke execute on function public.lookup_login_email(text) from public, anon, authenticated;
