-- The key itself is provisioned separately into Supabase Vault so it never
-- enters migration history or the frontend bundle.
do $schedule_guard$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'request_notification_worker_service_key'
  ) then
    raise exception 'Missing Vault secret request_notification_worker_service_key';
  end if;
end;
$schedule_guard$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'process-request-notifications-every-minute';

select cron.schedule(
  'process-request-notifications-every-minute',
  '* * * * *',
  $worker$
    select net.http_post(
      url := 'https://ftciqmqhmfvjtwoycswe.supabase.co/functions/v1/process-request-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'request_notification_worker_service_key'
        )
      ),
      body := jsonb_build_object('limit', 50),
      timeout_milliseconds := 10000
    ) as request_id;
  $worker$
);
