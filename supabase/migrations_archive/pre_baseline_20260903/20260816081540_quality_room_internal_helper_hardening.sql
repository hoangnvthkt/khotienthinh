-- Internal Quality helpers execute only inside security-definer command implementations.
revoke all on function app_private.assert_quality_action(text, text, text)
  from public, anon, authenticated;
revoke all on function app_private.begin_quality_command(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function app_private.finish_quality_command(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.assert_quality_recipient(uuid, text, text)
  from public, anon, authenticated;
