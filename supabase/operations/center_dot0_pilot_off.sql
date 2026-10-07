-- Tắt thí điểm Trung tâm điều hành (mọi người hoặc một số người) — giữ lịch sử: chỉ đặt hết hạn, không xóa.
-- Mặc định ROLLBACK = diễn tập; đổi dòng cuối thành COMMIT để áp dụng.
--   npx supabase db query --linked --agent=no --file supabase/operations/center_dot0_pilot_off.sql
-- Quyền center.* giữ nguyên (không còn tác dụng khi hết hạn bật); bỏ cấp trên màn Phân quyền nếu muốn dọn hẳn.
begin;
select set_config('app.center_rollout_reason', 'Tắt thí điểm Trung tâm điều hành đợt 0', true);

update app_private.center_rollout_actors r
set expires_at = greatest(now(), r.starts_at + interval '1 second'), updated_at = now()
where r.expires_at > now()
  -- Chỉ tắt một số người: bỏ chú thích dòng dưới, điền email.
  -- and r.user_id in (select id from public.users where lower(email) in ('ten1@tienthinhjsc.vn'))
;

select u.name as "Đã tắt", to_char(r.expires_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI') as "Hết hạn lúc"
from app_private.center_rollout_actors r join public.users u on u.id = r.user_id
where r.updated_at >= now() - interval '1 minute'
order by u.name;

rollback; -- Diễn tập. Đúng thì đổi thành: commit;
