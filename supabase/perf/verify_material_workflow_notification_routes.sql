with notification_refs as (
  select
    n.id,
    n.source_type,
    n.link,
    n.metadata,
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
),
workflow_refs as (
  select
    nr.*,
    wi.id as workflow_id,
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
    ) as form_request_id
  from notification_refs nr
  join public.workflow_instances wi
    on wi.id = nr.workflow_instance_id
),
candidate_requests as (
  select
    wr.id,
    wr.source_type,
    wr.link,
    wr.metadata,
    wr.subject_type,
    r.id as request_id,
    r.request_origin,
    r.created_date
  from workflow_refs wr
  join public.requests r
    on r.id = wr.form_request_id
  where wr.form_request_id is not null

  union all

  select
    wr.id,
    wr.source_type,
    wr.link,
    wr.metadata,
    wr.subject_type,
    r.id as request_id,
    r.request_origin,
    r.created_date
  from workflow_refs wr
  join public.requests r
    on r.id = wr.notification_request_id
  where wr.notification_request_id is not null

  union all

  select
    wr.id,
    wr.source_type,
    wr.link,
    wr.metadata,
    wr.subject_type,
    r.id as request_id,
    r.request_origin,
    r.created_date
  from workflow_refs wr
  join public.requests r
    on r.workflow_instance_id = wr.workflow_id
),
material_workflow_notifications as (
  select distinct on (wr.id)
    wr.id,
    wr.source_type,
    wr.link,
    wr.metadata,
    wr.request_id
  from candidate_requests wr
  where wr.subject_type = 'material_request'
    or wr.request_origin = 'project'
  order by wr.id, wr.created_date desc nulls last, wr.request_id
)
select
  count(*) filter (
    where source_type like 'workflow%'
      or coalesce(link, '') like '/wf%'
  ) as material_workflow_notifications_still_point_to_workflow,
  count(*) filter (
    where source_type = 'material_request'
      and coalesce(link, '') like '/da%'
      and metadata ? 'requestId'
  ) as material_workflow_notifications_routed_to_project_request,
  count(*) as total_material_workflow_notifications
from material_workflow_notifications;
