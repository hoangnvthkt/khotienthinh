-- Đính kèm Vioo Work: ảnh không lưu được kể từ PR #311 (22/10/2026).
-- PR #311 bỏ việc tạo biến thể fallback.png trong supabase/functions/work-attachments/processor.ts
-- (mã hóa PNG chiếm ~70% CPU, đẩy ảnh vượt giới hạn 2 s của Edge Function), nhưng hợp đồng phía
-- máy chủ thì không đổi: app_private.work_finish_attachment VẪN bắt ảnh phải có đủ ba biến thể
-- thumbnail + display + fallback. Hậu quả với mọi ảnh đính kèm ở Vioo Work:
--   finish_work_attachment → WORK_INVALID_VARIANTS (22023 → HTTP 400)
--   → worker ném WORK_FINALIZATION_FAILED → Edge Function trả 500
--   → phiếu đính kèm kẹt ở 'processing' hết 3 phút thuê
--   → bấm lại trong lúc đó → WORK_ATTACHMENT_BUSY → màn báo "Tệp đang được xử lý. Vui lòng thử lại sau ít phút."
-- (ca thật 24/10: Untitled.png 65 KB, hai lần, cùng kết thúc 'rejected').
--
-- Sửa: ảnh chỉ cần thumbnail + display. 'fallback' vẫn nằm trong danh sách khóa được phép và giữ
-- nguyên ràng buộc đường dẫn / kiểu tệp, nên nếu sau này bộ xử lý tạo lại fallback.png thì không
-- cần migration khác. Phần còn lại của hàm giữ nguyên định nghĩa đang chạy trên Cloud ngày 24/10.

create or replace function app_private.work_finish_attachment(p_id uuid,p_token uuid,p_variants jsonb,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_a public.work_task_attachments%rowtype; v_task uuid; v_prefix text; v_x record;
begin
 perform app_private.work_require_notification_worker();
 select task_id into v_task from public.work_task_attachments where id=p_id;
 perform 1 from public.work_tasks where id=v_task for update;
 select * into v_a from public.work_task_attachments where id=p_id for update;
 if v_a.id is null or v_a.status<>'processing' or p_token is null or v_a.processing_token is distinct from p_token or v_a.processing_expires_at<=now() then return false; end if;
 if not app_private.work_attachment_can_mutate(v_a.task_id,v_a.uploader_user_id,v_a.attachment_kind) then p_error:='access_revoked'; end if;
 if p_error is not null then
  update public.work_task_attachments set status='rejected',rejection_code=case when p_error in ('invalid_file','access_revoked','processing_failed') then p_error else 'processing_failed' end,processing_token=null,processing_expires_at=null where id=p_id;
  return false;
 end if;
 v_prefix:=v_a.task_id::text||'/'||v_a.id::text||'/'||p_token::text||'/';
 -- Ảnh: bắt buộc thumbnail + display (fallback.png không còn được tạo, xem đầu tệp).
 if jsonb_typeof(p_variants) is distinct from 'object' or p_variants-array['thumbnail','display','fallback','original']<>'{}'
  or (v_a.mime_type like 'image/%' and not(p_variants ?& array['thumbnail','display']))
  or (v_a.keep_original and not(p_variants ? 'original')) or (not v_a.keep_original and p_variants ? 'original')
  or (v_a.mime_type not like 'image/%' and p_variants-array['original']<>'{}') then raise exception 'WORK_INVALID_VARIANTS' using errcode='22023'; end if;
 for v_x in select key,value from jsonb_each(p_variants) loop
  if jsonb_typeof(v_x.value) is distinct from 'object' or v_x.value-array['path','mimeType','sizeBytes','width','height']<>'{}'
   or v_x.value->>'path' is distinct from v_prefix||(case v_x.key when 'thumbnail' then 'thumbnail.webp' when 'display' then 'display.webp' when 'fallback' then 'fallback.png' else 'original' end)
   or v_x.value->>'mimeType' is distinct from (case v_x.key when 'thumbnail' then 'image/webp' when 'display' then 'image/webp' when 'fallback' then 'image/png' else v_a.mime_type end)
   or jsonb_typeof(v_x.value->'sizeBytes') is distinct from 'number' or (v_x.value->>'sizeBytes')::bigint not between 1 and 26214400 then raise exception 'WORK_INVALID_VARIANTS' using errcode='22023'; end if;
 end loop;
 -- Every retained object was registered for cleanup before the worker wrote it.
 delete from app_private.work_attachment_cleanup q where q.path in(select value->>'path' from jsonb_each(p_variants));
 update public.work_task_attachments set status='ready',variants=p_variants,finalized_at=now(),processing_token=null,processing_expires_at=null where id=p_id;
 perform app_private.work_attachment_event(p_id,v_a.uploader_user_id,'attachment.added');
 return true;
end $$;
