-- Emergency stop for P2.2: unschedule the server alert scan. The browser scan
-- skips these six alerts, so also roll the frontend back (lib/notificationService
-- SERVER_SCHEDULED_ALERT_KEYS) if the server scan must stay off.
begin;
select cron.unschedule(jobid) from cron.job where jobname = 'server-scheduled-alerts';
commit;
