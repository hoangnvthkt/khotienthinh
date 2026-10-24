-- Trợ lý đọc được SỔ LỆCH (chủ SP 24/10): hỏi theo luật / theo người / theo phân hệ, không chỉ theo mã chứng từ.
--   Trước: chỉ có `control_findings_for_code_v1(p_code)` — bắt buộc có mã (PO-609, MR-…). Hỏi "3 người đã nghỉ việc
--   mà chưa ghi ngày là ai" thì không có mã nào để đưa vào, nên Trợ lý đành chỉ sang màn /kiem-soat.
--   Nay thêm `control_findings_search_v1`: không truyền gì → bảng tổng hợp theo luật; truyền bộ lọc → danh sách lệch.
--   Quyền giữ nguyên `app_private.control_can_view`: Admin thấy hết; người khác chỉ thấy lệch của mình ở luật đã bật
--   và không thấy dữ liệu cũ. Luật đang chạy thử (shadow) vẫn chỉ Admin đọc được — không rò sang nhân viên.

create or replace function public.control_findings_search_v1(
  p_rule text default null,      -- mã luật ('leave_approved_no_ledger') hoặc chữ trong tên luật ('nghỉ việc')
  p_who text default null,       -- tên / mã người, mã chứng từ, hoặc chữ bất kỳ trong câu mô tả lệch
  p_module text default null,    -- phân hệ: Kho · Nhân sự · Công nợ · Tài chính · Mua hàng · Đề xuất
  p_severity text default null,  -- P0 / P1 / P2
  p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rule text := nullif(btrim(coalesce(p_rule, '')), '');
  v_who text := nullif(btrim(coalesce(p_who, '')), '');
  v_module text := nullif(btrim(coalesce(p_module, '')), '');
  v_sev text := upper(nullif(btrim(coalesce(p_severity, '')), ''));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_loc boolean;
begin
  if public.current_app_user_id() is null then raise exception 'CONTROL_LOGIN_REQUIRED' using errcode = '42501'; end if;
  if v_sev is not null and v_sev not in ('P0', 'P1', 'P2') then raise exception 'CONTROL_BAD_SEVERITY' using errcode = '22023'; end if;
  if coalesce(length(v_rule), 0) > 80 or coalesce(length(v_who), 0) > 80 or coalesce(length(v_module), 0) > 40 then
    raise exception 'CONTROL_BAD_FILTER' using errcode = '22023'; end if;
  -- Không lọc gì thì chỉ trả bảng tổng hợp: danh sách đầy đủ vừa dài vừa không giúp người hỏi.
  v_loc := v_rule is not null or v_who is not null or v_module is not null or v_sev is not null;

  return (
    with hit as (
      select r.code rule_code, r.title rule_title, r.severity, r.module, r.fix_hint, r.owner_hint, r.mode,
        f.object_code, f.title, f.amount, f.status, f.legacy, f.happened_on, f.link, f.first_seen_at
      from public.control_findings f
      join public.control_rules r on r.code = f.rule_code
      where f.status in ('open', 'accepted')
        and (v_rule is null or r.code = lower(v_rule)
          or lower(public.unaccent(r.title)) like '%' || lower(public.unaccent(v_rule)) || '%')
        and (v_module is null or lower(public.unaccent(r.module)) = lower(public.unaccent(v_module)))
        and (v_sev is null or r.severity = v_sev)
        and (v_who is null
          or lower(public.unaccent(coalesce(f.object_code, ''))) like '%' || lower(public.unaccent(v_who)) || '%'
          or lower(public.unaccent(coalesce(f.title, ''))) like '%' || lower(public.unaccent(v_who)) || '%')
        and app_private.control_can_view(f)
    ),
    tom_tat as (
      select coalesce(jsonb_agg(x order by muc, so_lech desc), '[]'::jsonb) j from (
        select h.severity muc, count(*) so_lech,
          jsonb_build_object('ma_luat', h.rule_code, 'luat', h.rule_title, 'muc', h.severity, 'phan_he', h.module,
            'dang_chay_thu', h.mode <> 'live', 'so_lech', count(*), 'so_lech_cu', count(*) filter (where h.legacy),
            'so_tien', nullif(sum(abs(coalesce(h.amount, 0))), 0), 'cach_xu_ly', h.fix_hint, 'ai_xu_ly', h.owner_hint) x
        from hit h group by h.rule_code, h.rule_title, h.severity, h.module, h.mode, h.fix_hint, h.owner_hint) s
    ),
    ket_qua as (
      select coalesce(jsonb_agg(x order by muc, tien desc nulls last, lan_dau), '[]'::jsonb) j from (
        select h.severity muc, abs(coalesce(h.amount, 0)) tien, h.first_seen_at lan_dau,
          jsonb_build_object('ma', h.object_code, 'lech', h.title, 'luat', h.rule_title, 'ma_luat', h.rule_code,
            'muc', h.severity, 'phan_he', h.module, 'chenh', h.amount, 'ngay', h.happened_on,
            'trang_thai', case h.status when 'accepted' then 'đã chấp nhận' else 'đang mở' end,
            'du_lieu_cu', nullif(h.legacy, false), 'dang_chay_thu', nullif(h.mode <> 'live', false),
            'cach_xu_ly', h.fix_hint, 'ai_xu_ly', h.owner_hint, 'link', h.link) x
        from hit h where v_loc
        order by h.severity, abs(coalesce(h.amount, 0)) desc, h.first_seen_at
        limit v_limit) s
    )
    select jsonb_build_object(
      'tong_so', (select count(*) from hit),
      'da_tra', jsonb_array_length((select j from ket_qua)),
      'tom_tat', (select j from tom_tat),
      'ket_qua', (select j from ket_qua))
  );
end $$;

revoke all on function public.control_findings_search_v1(text, text, text, text, integer) from public, anon;
grant execute on function public.control_findings_search_v1(text, text, text, text, integer) to authenticated;

comment on function public.control_findings_search_v1(text, text, text, text, integer) is
  'Sổ lệch Kiểm soát viên cho Trợ lý: lọc theo luật / người / phân hệ / mức, hoặc không lọc để lấy bảng tổng hợp. Quyền theo control_can_view.';
