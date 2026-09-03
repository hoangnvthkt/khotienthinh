grant execute on function app_private.record_request_export_audit(uuid, text, text, text, uuid)
  to authenticated;

notify pgrst, 'reload schema';
