-- Trợ lý · "tình hình hôm nay của một nhóm" (chủ SP 24/10).
--   Đo trên 82 câu hỏi thật: Trợ lý tìm được 20 loại hồ sơ, đọc chi tiết được 5 loại, nhưng gần như KHÔNG trả lời được
--   dạng "nhóm người / hôm nay" — dạng người dùng hỏi hằng ngày ("hôm nay phòng HCNS ai chưa chấm công").
--   Một RPC, 4 loại. Quyền dùng lại helper sẵn có, KHÔNG tự nới:
--     cham_cong / nghi_phep → app_private.current_actor_hrm_visible_employee_ids(<mã quyền>)
--                              (tự xử lý phạm vi global / của mình / cấp dưới trực tiếp — nên trưởng phòng
--                               hỏi được về người của mình mà không cần quyền HR toàn công ty)
--     nhat_ky              → app_private.project_scope_has_any_grant_v2(project_id, construction_site_id)
--     phieu_dung           → app_private.workflow_visible_instance_ids()

-- Khớp chữ tiếng Việt theo TỪNG TỪ, không theo nguyên chuỗi: người dùng gõ "hành chính nhân sự" phải khớp
-- "Phòng Hành chính - Nhân sự" (có gạch ngang), gõ không dấu cũng phải ra.
create or replace function app_private.vi_match(p_text text, p_query text)
returns boolean language sql stable set search_path = '' as $$
  select case
    when coalesce(btrim(p_query), '') = '' then true
    else coalesce((
      select bool_and(position(t in regexp_replace(lower(public.unaccent(coalesce(p_text, ''))), '[^a-z0-9]+', ' ', 'g')) > 0)
      from unnest(string_to_array(regexp_replace(lower(public.unaccent(p_query)), '[^a-z0-9]+', ' ', 'g'), ' ')) t
      where t <> ''), true)
  end;
$$;

create or replace function public.assistant_today_status_v1(
  p_kind text,
  p_scope text default null,     -- tên đơn vị / công trường / dự án, lọc thêm (không dấu cũng được)
  p_date date default null,      -- mặc định hôm nay theo giờ VN
  p_days integer default null,   -- riêng phieu_dung: đứng im bao nhiêu ngày (mặc định 7)
  p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_scope text := nullif(btrim(coalesce(p_scope, '')), '');
  v_day date := coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_day_text text := to_char(v_day, 'YYYY-MM-DD');
begin
  if public.current_app_user_id() is null then raise exception 'ASSISTANT_LOGIN_REQUIRED' using errcode = '42501'; end if;
  if v_kind not in ('cham_cong', 'nghi_phep', 'nhat_ky', 'phieu_dung') then
    raise exception 'ASSISTANT_BAD_KIND' using errcode = '22023'; end if;
  if coalesce(length(v_scope), 0) > 80 then raise exception 'ASSISTANT_BAD_SCOPE' using errcode = '22023'; end if;
  if v_day > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'ASSISTANT_FUTURE_DATE' using errcode = '22023'; end if;

  -- ── Ai chưa chấm công ──────────────────────────────────────────────────────────────────────────────────────────
  if v_kind = 'cham_cong' then
    return (
      with thay as (select employee_id from app_private.current_actor_hrm_visible_employee_ids('hrm.attendance.view')),
      nguoi as (
        select e.id, e.employee_code, e.full_name, coalesce(o.name, 'Chưa gán đơn vị') don_vi, s.name cong_truong
        from public.employees e
        join thay t on t.employee_id = e.id
        left join public.org_units o on o.id = e.org_unit_id
        left join public.hrm_construction_sites s on s.id = e.construction_site_id
        where e.status = 'Đang làm việc'
          and (v_scope is null
            or app_private.vi_match(o.name, v_scope)
            or app_private.vi_match(s.name, v_scope))
      ),
      chua as (
        select n.*,
          -- Nghỉ phép đã duyệt thì KHÔNG tính là chưa chấm công — nếu không sẽ báo nhầm người đang nghỉ đúng phép.
          exists (select 1 from public.hrm_leave_requests r
            where r."employeeId" = n.id and r.status = 'approved' and v_day_text between r."startDate" and r."endDate") dang_nghi
        from nguoi n
        where not exists (select 1 from public.hrm_attendance a where a."employeeId" = n.id and a.date = v_day_text)
      ),
      loc as (select * from chua where not dang_nghi)
      select jsonb_build_object('loai', 'cham_cong', 'ngay', v_day,
        'tong_nguoi_xem_duoc', (select count(*) from nguoi),
        'da_cham', (select count(*) from nguoi n where exists (select 1 from public.hrm_attendance a where a."employeeId" = n.id and a.date = v_day_text)),
        'dang_nghi_phep', (select count(*) from chua where dang_nghi),
        'tong_so', (select count(*) from loc),
        'tom_tat', coalesce((select jsonb_agg(jsonb_build_object('don_vi', don_vi, 'so_nguoi', n) order by n desc)
          from (select don_vi, count(*) n from loc group by 1) g), '[]'::jsonb),
        'ket_qua', coalesce((select jsonb_agg(jsonb_build_object('ma', employee_code, 'ten', full_name, 'don_vi', don_vi,
            'cong_truong', cong_truong, 'link', '/hrm/attendance?tab=timesheet&q=' || coalesce(employee_code, ''))
          order by don_vi, full_name) from (select * from loc order by don_vi, full_name limit v_limit) x), '[]'::jsonb))
    );
  end if;

  -- ── Ai đang nghỉ hôm nay ───────────────────────────────────────────────────────────────────────────────────────
  if v_kind = 'nghi_phep' then
    return (
      with thay as (select employee_id from app_private.current_actor_hrm_visible_employee_ids('hrm.leave.view')),
      nghi as (
        select e.employee_code, e.full_name, coalesce(o.name, 'Chưa gán đơn vị') don_vi,
          r.id, r.code, r.type, r."startDate" tu, r."endDate" den, r."totalDays" so_ngay, r."isPaid" co_luong, r.reason
        from public.hrm_leave_requests r
        join thay t on t.employee_id = r."employeeId"
        join public.employees e on e.id = r."employeeId"
        left join public.org_units o on o.id = e.org_unit_id
        where r.status = 'approved' and v_day_text between r."startDate" and r."endDate"
          and (v_scope is null or app_private.vi_match(o.name, v_scope)
            or app_private.vi_match(e.full_name, v_scope))
      )
      select jsonb_build_object('loai', 'nghi_phep', 'ngay', v_day, 'tong_so', (select count(*) from nghi),
        'tom_tat', coalesce((select jsonb_agg(jsonb_build_object('don_vi', don_vi, 'so_nguoi', n) order by n desc)
          from (select don_vi, count(*) n from nghi group by 1) g), '[]'::jsonb),
        'ket_qua', coalesce((select jsonb_agg(jsonb_build_object('ma', employee_code, 'ten', full_name, 'don_vi', don_vi,
            'loai_phep', type, 'tu_ngay', tu, 'den_ngay', den, 'so_ngay', so_ngay, 'co_luong', co_luong,
            'ly_do', left(coalesce(reason, ''), 120), 'link', '/hrm/leave?request=' || id::text)
          order by don_vi, full_name) from (select * from nghi order by don_vi, full_name limit v_limit) x), '[]'::jsonb))
    );
  end if;

  -- ── Công trường chưa gửi nhật ký ───────────────────────────────────────────────────────────────────────────────
  --   Chỉ tính công trường ĐANG dùng nhật ký (có phiếu trong 30 ngày). 7 công trường nhưng chỉ 2 dùng thật —
  --   tính cả 7 sẽ báo nhầm 5 cái không ai ghi bao giờ.
  if v_kind = 'nhat_ky' then
    return (
      with dang_dung as (
        select l.construction_site_id site_id, max(l.project_id) project_id, max(l.date::date) gan_nhat
        from public.daily_logs l
        where l.date::date between v_day - 30 and v_day
        group by l.construction_site_id
      ),
      thay as (
        select d.*, s.name ten_cong_truong, p.code ma_du_an, coalesce(nullif(p.code, ''), p.name) ten_du_an
        from dang_dung d
        left join public.hrm_construction_sites s on s.id::text = d.site_id
        left join public.projects p on p.id = d.project_id
        where app_private.project_scope_has_any_grant_v2(d.project_id, d.site_id)
          and (v_scope is null or app_private.vi_match(s.name, v_scope)
            or app_private.vi_match(p.name, v_scope)
            or app_private.vi_match(p.code, v_scope))
      ),
      thieu as (
        select t.* from thay t
        where not exists (select 1 from public.daily_logs l where l.construction_site_id = t.site_id and l.date::date = v_day)
      )
      select jsonb_build_object('loai', 'nhat_ky', 'ngay', v_day,
        'cong_truong_dang_dung', (select count(*) from thay),
        'da_gui', (select count(*) from thay) - (select count(*) from thieu),
        'tong_so', (select count(*) from thieu),
        'tom_tat', '[]'::jsonb,
        'ket_qua', coalesce((select jsonb_agg(jsonb_build_object('ma', ma_du_an, 'ten', ten_cong_truong, 'du_an', ten_du_an,
            'nhat_ky_gan_nhat', gan_nhat, 'so_ngay_chua_ghi', v_day - gan_nhat, 'link', '/daily-log')
          order by gan_nhat) from (select * from thieu order by gan_nhat limit v_limit) x), '[]'::jsonb))
    );
  end if;

  -- ── Phiếu quy trình đứng im ────────────────────────────────────────────────────────────────────────────────────
  return (
    with thay as (
      select w.id, w.code, w.title, w.status, w.updated_at, w.created_at, t.name ten_mau
      from public.workflow_instances w
      left join public.workflow_templates t on t.id = w.template_id
      where w.status = 'RUNNING'
        and w.id = any(app_private.workflow_visible_instance_ids())
        and w.updated_at < now() - make_interval(days => v_days)
        and (v_scope is null or app_private.vi_match(t.name, v_scope)
          or app_private.vi_match(w.title, v_scope))
    )
    select jsonb_build_object('loai', 'phieu_dung', 'ngay', v_day, 'dung_qua_ngay', v_days,
      'tong_so', (select count(*) from thay),
      'tom_tat', coalesce((select jsonb_agg(jsonb_build_object('mau', ten_mau, 'so_phieu', n) order by n desc)
        from (select coalesce(ten_mau, 'Không rõ mẫu') ten_mau, count(*) n from thay group by 1) g), '[]'::jsonb),
      'ket_qua', coalesce((select jsonb_agg(jsonb_build_object('ma', code, 'ten', left(coalesce(title, ''), 120), 'mau', ten_mau,
          'dung_tu', updated_at::date, 'so_ngay_dung', (current_date - updated_at::date), 'link', '/wf?phieu=' || id::text)
        order by updated_at) from (select * from thay order by updated_at limit v_limit) x), '[]'::jsonb))
  );
end $$;

revoke all on function public.assistant_today_status_v1(text, text, date, integer, integer) from public, anon;
grant execute on function public.assistant_today_status_v1(text, text, date, integer, integer) to authenticated;

comment on function public.assistant_today_status_v1(text, text, date, integer, integer) is
  'Trợ lý · tình hình hôm nay của một nhóm: ai chưa chấm công, ai đang nghỉ, công trường chưa gửi nhật ký, phiếu quy trình đứng im. Quyền theo helper sẵn có của từng phân hệ.';
