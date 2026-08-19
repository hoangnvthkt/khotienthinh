begin;

-- Preserve legacy employee links while attaching the old generic positions to
-- the approved job framework. This is intentionally a conservative name map.
update public.hrm_positions
set level_code = case name
      when 'Ban giám đốc' then 'E9'
      when 'Giám đốc dự án' then 'E9'
      when 'Giám đốc vật tư' then 'E9'
      when 'Chỉ huy trưởng công trình' then 'E8'
      when 'Kế toán trưởng' then 'E8'
      when 'Trưởng phòng' then 'E7'
      when 'Kỹ thuật trưởng' then 'E7'
      when 'Quản lý' then 'E6'
      when 'Trưởng nhóm' then 'E6'
      when 'Chỉ huy phó công trình' then 'E6'
      when 'Chuyên viên' then 'E4'
      when 'Cán bộ an toàn (HSE)' then 'E4'
      when 'QC (Quality Control)' then 'E4'
      when 'QS (Quantity Surveyor)' then 'E4'
      when 'Trắc đạc' then 'E3'
      when 'Nhân viên kỹ thuật' then 'E3'
      when 'Nhân viên kế toán' then 'E2'
      when 'Nhân viên thủ kho' then 'E2'
      when 'Nhân viên' then 'E1'
      when 'Bảo vệ nội bộ' then 'E1'
      else level_code
    end,
    group_code = case
      when name in ('Ban giám đốc', 'Giám đốc dự án', 'Giám đốc vật tư') then 'BoD'
      when name in ('Chỉ huy trưởng công trình', 'Kế toán trưởng', 'Trưởng phòng', 'Kỹ thuật trưởng') then 'QLCT'
      when name in ('Quản lý', 'Trưởng nhóm', 'Chỉ huy phó công trình') then 'QLN'
      when name in ('Chuyên viên', 'Cán bộ an toàn (HSE)', 'QC (Quality Control)', 'QS (Quantity Surveyor)', 'Trắc đạc') then 'CV'
      else 'NV'
    end
where source = 'legacy'
  and (level_code is null or group_code is null);

update public.hrm_org_position_slots slot
set level_code = position.level_code,
    updated_at = now()
from public.hrm_positions position
where position.id = slot.position_id
  and slot.level_code is null
  and position.level_code is not null;

-- Choose the strongest occupied position as the initial direct-manager slot.
-- HRM admins can override this choice in the shared catalog screen.
with manager_candidates as (
  select slot.org_unit_id,
         slot.id as slot_id,
         row_number() over (
           partition by slot.org_unit_id
           order by
             case
               when lower(position.name) like '%tổng giám đốc%' then 110
               when lower(position.name) like '%kế toán trưởng%' then 100
               when lower(position.name) like '%trưởng phòng%' then 95
               when lower(position.name) like '%giám đốc%' then 90
               when lower(position.name) like '%chỉ huy trưởng%' then 85
               when lower(position.name) like '%kỹ thuật trưởng%' then 80
               when lower(position.name) = 'quản lý' then 75
               when lower(position.name) like '%trưởng nhóm%' then 70
               when lower(position.name) like '%chỉ huy phó%' then 65
               else coalesce(nullif(regexp_replace(slot.level_code, '\D', '', 'g'), '')::integer, 0)
             end desc,
             assignment.effective_from,
             slot.sort_order,
             slot.id
         ) as candidate_rank
  from public.hrm_org_position_slots slot
  join public.hrm_positions position on position.id = slot.position_id
  join public.hrm_employee_slot_assignments assignment
    on assignment.slot_id = slot.id
   and assignment.status = 'ACTIVE'
   and assignment.assignment_type in ('PRIMARY', 'ACTING')
   and assignment.effective_from <= current_date
   and (assignment.effective_to is null or assignment.effective_to >= current_date)
  where slot.status = 'ACTIVE'
)
update public.org_units org
set manager_slot_id = ranked.slot_id
from manager_candidates ranked
where ranked.candidate_rank = 1
  and org.id = ranked.org_unit_id
  and org.manager_slot_id is null;

update public.hrm_org_position_slots slot
set reports_to_slot_id = org.manager_slot_id,
    updated_at = now()
from public.org_units org
where org.id = slot.org_unit_id
  and org.manager_slot_id is not null
  and slot.id <> org.manager_slot_id
  and slot.reports_to_slot_id is null
  and slot.status = 'ACTIVE';

notify pgrst, 'reload schema';

commit;
