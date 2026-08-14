select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workflow_instance_comments'
      and column_name = 'mentions'
      and data_type = 'jsonb'
  ) as mentions_column_ready,
  exists (
    select 1
    from information_schema.triggers
    where event_object_schema = 'public'
      and event_object_table = 'workflow_instance_comments'
      and trigger_name = 'trg_normalize_workflow_instance_comment_mentions'
  ) as mention_normalizer_ready,
  exists (
    select 1
    from information_schema.triggers
    where event_object_schema = 'public'
      and event_object_table = 'workflow_instance_comments'
      and trigger_name = 'trg_notify_workflow_instance_comment_mentions'
  ) as mention_notification_ready,
  exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_private'
      and procedure.proname = 'notify_workflow_instance_comment_mentions'
      and procedure.prosecdef
      and exists (
        select 1
        from unnest(procedure.proconfig) config
        where config like 'search_path=%'
      )
  ) as notification_function_hardened,
  exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_private'
      and procedure.proname = 'notify_workflow_instance_comment_mentions'
      and pg_get_functiondef(procedure.oid) like '%''💬''%'
  ) as notification_icon_fixed,
  not exists (
    select 1
    from public.notifications notification
    where notification.source_type = 'workflow_comment_mention'
      and notification.icon is distinct from '💬'
  ) as existing_notification_icons_fixed;
