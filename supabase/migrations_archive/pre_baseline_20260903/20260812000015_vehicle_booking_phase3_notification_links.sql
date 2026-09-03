-- Vehicle Booking Phase 3E: canonical notification links and issue resolution title.

begin;

create or replace function app_private.canonicalize_vehicle_booking_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_id text;
  v_path text;
begin
  if new.source_type = 'vehicle_booking'
     or new.category = 'vehicle_booking'
     or new.entity_type = 'vehicle_booking' then
    v_booking_id := coalesce(
      nullif(new.source_id, ''),
      nullif(new.entity_id::text, ''),
      nullif(new.metadata ->> 'booking_id', ''),
      nullif(new.metadata ->> 'bookingId', '')
    );

    if v_booking_id is not null then
      v_path := '/booking/vehicle/my?booking=' || v_booking_id;
      new.link := v_path;
      new.action_url := v_path;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app_private.canonicalize_vehicle_booking_notification()
from public, anon, authenticated;

drop trigger if exists canonicalize_vehicle_booking_notification
on public.notifications;

create trigger canonicalize_vehicle_booking_notification
before insert or update of
  source_type, source_id, category, entity_type, entity_id, metadata, link, action_url
on public.notifications
for each row
execute function app_private.canonicalize_vehicle_booking_notification();

update public.notifications
set link = '/booking/vehicle/my?booking=' || coalesce(
      nullif(source_id, ''),
      nullif(entity_id::text, ''),
      nullif(metadata ->> 'booking_id', ''),
      nullif(metadata ->> 'bookingId', '')
    ),
    action_url = '/booking/vehicle/my?booking=' || coalesce(
      nullif(source_id, ''),
      nullif(entity_id::text, ''),
      nullif(metadata ->> 'booking_id', ''),
      nullif(metadata ->> 'bookingId', '')
    )
where (
    source_type = 'vehicle_booking'
    or category = 'vehicle_booking'
    or entity_type = 'vehicle_booking'
  )
  and coalesce(
    nullif(source_id, ''),
    nullif(entity_id::text, ''),
    nullif(metadata ->> 'booking_id', ''),
    nullif(metadata ->> 'bookingId', '')
  ) is not null;

create or replace function app_private.vehicle_notification_title(p_event_type text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_event_type
    when 'BOOKING_SUBMITTED' then 'Yêu cầu đặt xe cần duyệt'
    when 'BOOKING_REJECTED' then 'Yêu cầu đặt xe bị từ chối'
    when 'BOOKING_ASSIGNED' then 'Đã xếp phương án chuyến xe'
    when 'HANDOVER_ASSIGNED' then 'Bạn được giao bàn giao xe'
    when 'BOOKING_REASSIGNED' then 'Phương án chuyến xe đã thay đổi'
    when 'BOOKING_REASSIGNED_OLD_OPERATOR' then 'Bạn đã được gỡ khỏi chuyến xe'
    when 'BOOKING_REASSIGNED_NEW_OPERATOR' then 'Bạn được phân công chuyến xe'
    when 'ASSIGNMENT_DECLINED' then 'Người lái từ chối chuyến xe'
    when 'TRIP_COMPLETED' then 'Chuyến xe đã hoàn thành'
    when 'VEHICLE_RETURN_REQUIRED' then 'Cần nhận lại xe và chìa khóa'
    when 'BOOKING_CANCELLED' then 'Booking xe đã bị hủy'
    when 'BOOKING_NO_SHOW' then 'Booking xe được ghi nhận no-show'
    when 'FEEDBACK_AUTO_CLOSED' then 'Xác nhận sau chuyến đã tự đóng'
    when 'ISSUE_RESOLVED' then 'Phản ánh chuyến xe đã được xử lý'
    else 'Cập nhật booking xe'
  end;
$$;

commit;
