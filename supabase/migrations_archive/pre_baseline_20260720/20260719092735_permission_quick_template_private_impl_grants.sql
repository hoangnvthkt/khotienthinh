-- Forward-fix: public quick-template RPC wrappers are SECURITY INVOKER, so
-- authenticated callers also need EXECUTE on the private implementation layer.
grant execute on function app_private.list_permission_quick_templates_impl()
  to authenticated;
grant execute on function app_private.save_permission_quick_template_impl(uuid, text, text, text, jsonb, text)
  to authenticated;
grant execute on function app_private.deactivate_permission_quick_template_impl(uuid, text)
  to authenticated;
