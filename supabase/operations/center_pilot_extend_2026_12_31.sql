-- Gia hạn thí điểm Trung tâm điều hành tới hết 31/12/2026 (giờ VN) cho mọi người đang trong thí điểm (chủ SP chốt 18/10/2026).
-- Chỉ kéo dài hạn, không thêm / bớt người, không đổi chế độ. Mỗi dòng có audit (trigger) với lý do dưới đây.
begin;
select set_config('app.center_rollout_reason', 'Gia hạn thí điểm Trung tâm tới 31/12/2026 — chủ SP chốt 18/10/2026', true);
update app_private.center_rollout_actors
   set expires_at = timestamptz '2026-12-31 23:59:59+07', updated_at = now()
 where expires_at > now() and expires_at < timestamptz '2026-12-31 23:59:59+07';
select count(*) filter (where expires_at = timestamptz '2026-12-31 23:59:59+07') as den_31_12, count(*) as tong from app_private.center_rollout_actors;
commit;
