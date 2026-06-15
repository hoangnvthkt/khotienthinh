with notification_refs as (
  select
    n.id as notification_id,
    n.metadata,
    n.source_type,
    case
      when coalesce(
        n.metadata ->> 'instanceId',
        n.metadata ->> 'workflowInstanceId',
        n.metadata ->> 'workflow_instance_id'
      ) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then coalesce(
        n.metadata ->> 'instanceId',
        n.metadata ->> 'workflowInstanceId',
        n.metadata ->> 'workflow_instance_id'
      )::uuid
      else null
    end as workflow_instance_id,
    nullif(
      coalesce(
        n.metadata ->> 'requestId',
        n.metadata ->> 'request_id',
        n.metadata ->> 'materialRequestId',
        n.metadata ->> 'material_request_id'
      ),
      ''
    ) as notification_request_id
  from public.notifications n
  where n.source_type like 'workflow%'
),
workflow_refs as (
  select
    nr.*,
    wi.form_data,
    coalesce(wi.form_data ->> 'subjectType', wi.form_data ->> 'subject_type') as subject_type,
    nullif(
      coalesce(
        wi.form_data ->> 'subjectId',
        wi.form_data ->> 'subject_id',
        wi.form_data ->> 'requestId',
        wi.form_data ->> 'request_id',
        wi.form_data ->> 'materialRequestId',
        wi.form_data ->> 'material_request_id'
      ),
      ''
    ) as form_request_id,
    wi.id as workflow_id
  from notification_refs nr
  join public.workflow_instances wi
    on wi.id = nr.workflow_instance_id
),
candidate_requests as (
  select
    wr.notification_id,
    wr.subject_type,
    r.id as request_id,
    r.project_id,
    r.construction_site_id,
    r.request_origin,
    r.created_date
  from workflow_refs wr
  join public.requests r
    on r.id = wr.form_request_id
  where wr.form_request_id is not null

  union all

  select
    wr.notification_id,
    wr.subject_type,
    r.id as request_id,
    r.project_id,
    r.construction_site_id,
    r.request_origin,
    r.created_date
  from workflow_refs wr
  join public.requests r
    on r.id = wr.notification_request_id
  where wr.notification_request_id is not null

  union all

  select
    wr.notification_id,
    wr.subject_type,
    r.id as request_id,
    r.project_id,
    r.construction_site_id,
    r.request_origin,
    r.created_date
  from workflow_refs wr
  join public.requests r
    on r.workflow_instance_id = wr.workflow_id
),
material_workflow_notifications as (
  select distinct on (wr.notification_id)
    wr.notification_id,
    wr.request_id,
    wr.project_id,
    wr.construction_site_id
  from candidate_requests wr
  where wr.subject_type = 'material_request'
    or wr.request_origin = 'project'
  order by wr.notification_id, wr.created_date desc nulls last, wr.request_id
)
update public.notifications n
set
  category = 'material',
  source_type = 'material_request',
  source_id = m.request_id,
  icon = coalesce(n.icon, '📦'),
  link = '/da?projectId=' || coalesce(m.project_id::text, '')
    || '&siteId=' || coalesce(m.construction_site_id::text, '')
    || '&tab=material&materialTab=request&requestId=' || m.request_id::text,
  metadata = coalesce(n.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'subjectType', 'material_request',
      'requestId', m.request_id,
      'materialRequestId', m.request_id,
      'projectId', m.project_id,
      'constructionSiteId', m.construction_site_id,
      'materialTab', 'request'
    )
from material_workflow_notifications m
where n.id = m.notification_id;
