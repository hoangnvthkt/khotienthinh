grant execute on function app_private.act_on_request(uuid, text, text, jsonb, uuid, text, timestamptz)
  to authenticated;

notify pgrst, 'reload schema';
