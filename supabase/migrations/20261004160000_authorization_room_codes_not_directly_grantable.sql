-- Two project permissions added on 28/09 belong to Rooms (Daily log "Công bố tiến độ ngày",
-- Payment "Xem bằng chứng nguồn lực") but were marked directly grantable, against the rule that
-- project permissions are given through Rooms. Nobody holds them as a personal grant.
update public.permission_actions
set direct_grant_allowed = false, updated_at = now()
where permission_code in ('project.daily_log.publish_progress', 'project.payment.view_resource_evidence')
  and direct_grant_allowed;
