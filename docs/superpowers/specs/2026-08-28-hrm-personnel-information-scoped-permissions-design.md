# Đặc tả chuẩn hóa hồ sơ nhân sự, định biên và phân quyền theo phạm vi HRM

**Ngày:** 28/08/2026

**Trạng thái:** Đã duyệt định hướng; đang chờ xác nhận bản cập nhật ngày 28/08/2026

**Phạm vi:** Hồ sơ nhân sự, Danh mục dùng chung HRM, Sơ đồ tổng quan, Định biên & nhân sự, Permission Health và RLS/RPC liên quan HRM

**Chưa bao gồm:** Migration, thay đổi dữ liệu Cloud, triển khai UI và công thức tính lương

## 1. Tóm tắt quyết định

HRM được chuẩn hóa theo một mô hình thống nhất thay vì bổ sung thêm cột vào `employees` hoặc sao chép nguyên cấu trúc Excel:

1. `employees` tiếp tục là hồ sơ lõi và định danh nhân sự.
2. Dữ liệu một-nhiều hoặc nhạy cảm được tách thành các miền con có lịch sử hiệu lực.
3. Sơ đồ tổ chức, định biên, slot và phân bổ đang hiệu lực là nguồn sự thật về vị trí tổ chức hiện tại.
4. Tổng quan nhân sự là dữ liệu chiếu/tính toán, không phải nơi lưu lặp các giá trị như thâm niên, hợp đồng hiện tại hoặc phép còn lại.
5. Quyền HRM được quyết định bằng `action + scope + quan hệ tổ chức đang hiệu lực`, không suy ra trực tiếp từ tên chức danh, cấp E1–E11 hoặc quyền quản trị kỹ thuật.
6. Người dùng thông thường chỉ đọc các projection an toàn; bảng thô chứa định danh, pháp lý, ngân hàng và lương không được mở đọc rộng.
7. Permission Health được nâng từ bộ đếm policy `true` thành cổng kiểm soát riêng cho dữ liệu HRM nhạy cảm, quyền `anon`, ghi rộng, policy legacy và độ phủ dữ liệu tổ chức.
8. Triển khai theo lát cắt dọc, mỗi lát gồm registry → grant → RLS/RPC → UI → test → xác minh Supabase Cloud; không làm một migration lớn cho toàn HRM.

## 2. Quan hệ với tài liệu hiện có

Tài liệu này kế thừa:

- `2026-08-18-hrm-shared-catalog-org-slot-design.md` về đơn vị, slot, phân bổ và manager slot.
- `2026-08-18-hrm-org-chart-workforce-planning-redesign.md` về giao diện gộp định biên và chuyển đổi khỏi slot `LEGACY`.
- `principal-permission-scope-assignment-workflow-notification-architecture.md` về Principal, Permission, Scope, Assignment, Workflow và Notification.
- `permission-refactor-roadmap.md` về namespace permission và rollout deny-by-default.

Khi có khác biệt trong phạm vi HRM, tài liệu này thay thế các quyết định cũ sau:

- Một cờ `canManage` hoặc `is_module_admin('HRM')` không còn đủ để quản lý toàn bộ Danh mục dùng chung HRM.
- “Authenticated được đọc tất cả” không áp dụng cho hồ sơ nhân sự, định biên chi tiết, hợp đồng, chứng từ, chấm công, nghỉ phép, ngân hàng hoặc lương.
- Trong quy mô hiện tại, Trưởng đơn vị chính là Quản lý trực tiếp; không tạo thêm persona hoặc scope “Quản lý đơn vị” độc lập.
- Chưa triển khai workflow đề xuất/phê duyệt định biên. HR Manage nhận thông tin từ các luồng khác và trực tiếp tạo hoặc điều chỉnh định biên bằng RPC có audit.
- Tách hai mức `HR` và `HR Manage`; không tạo thêm persona Payroll. HR Manage kế thừa HR và giữ các action cấu hình/điều chỉnh nhạy cảm.
- Fallback `users.manager_id` chỉ là cơ chế chuyển tiếp có theo dõi, không phải nguồn quản lý trực tiếp đích.

Các quyết định về cách hiển thị slot gộp, lưu lịch sử và tương thích dữ liệu trong hai tài liệu ngày 18/08 vẫn còn hiệu lực nếu không mâu thuẫn với tài liệu này.

## 3. Nguồn đầu vào và hiện trạng

### 3.1 Workbook nhân sự

File tham khảo `nhan-vien.report.14.32.20.08.26.xlsx` có 6 sheet:

| Sheet nguồn | Số cột | Nhận định |
| --- | ---: | --- |
| Tổng quan | 24 | Trộn dữ liệu gốc với số liệu suy ra như thâm niên, hợp đồng hiện tại và lần tăng lương gần nhất. |
| Lương | 27 | Trộn đề xuất, hợp đồng, mức hiện hành, tài khoản ngân hàng và tham số tính lương. |
| Legals | 17 | Gom giấy tờ định danh, thuế, bảo hiểm và người phụ thuộc vào một hàng. |
| Times | 17 | Trộn lịch làm việc, phép, công và chỉ tiêu chấm công. |
| Nhóm | 5 | Tên quá rộng; thực chất là thông tin công việc và tổ chức. |
| Nhân viên | 12 | Hồ sơ cá nhân và liên hệ cơ bản. |

Toàn workbook có 102 lần xuất hiện header và 64 header duy nhất. Workbook là nguồn khám phá yêu cầu, không phải schema database đích. Template nhập liệu chính thức không được chứa bản ghi nhân sự thật.

### 3.2 Snapshot Supabase Cloud ngày 28/08/2026

Snapshot chỉ đọc được lấy từ Supabase Cloud bằng cấu hình dự án hiện có:

| Chỉ số | Giá trị |
| --- | ---: |
| Nhân sự | 45 |
| Nhân sự trạng thái `Đang làm việc` | 45 |
| Thiếu ngày sinh | 20 |
| Chưa liên kết app user | 3 |
| Hợp đồng lao động | 0 |
| Lịch sử lương | 0 |
| Đơn vị đang hoạt động | 22 |
| Slot đang hoạt động | 49 |
| Phân bổ đang hiệu lực | 3 |
| Phân bổ chính đang hiệu lực | 3 |
| Đơn vị có manager slot | 10/22 |
| Permission action HRM đã khai báo | 11 |
| Grant HRM đang hoạt động | 3, đều là `hrm.employee.*` scope `global` |
| Broad policy liên quan HRM | 35 |
| Broad write policy liên quan HRM | 8 |
| Bảng HRM có grant `anon SELECT` | 37 |

Tám broad write policy hiện tại nằm ở `hrm_doc_categories`, `hrm_documents`, `hrm_employee_shifts`, `hrm_leave_logs`, `hrm_leave_requests` và `hrm_shift_types`. Các broad read nhạy cảm gồm chấm công, hợp đồng, số dư phép và đơn nghỉ phép.

### 3.3 Khoảng cách chính

- Mới `hrm.employee.view/create/edit` được bảo vệ theo permission; phần lớn action HRM còn ở trạng thái khai báo hoặc legacy.
- `pages/Settings.tsx` đang quy toàn bộ Danh mục dùng chung HRM về `system.hrm.manage` rồi truyền một boolean `canManage` xuống màn hình.
- Scope HRM hiện mới có `global`, `own`, `department`, `assigned`; chưa mô tả direct report và cây đơn vị.
- Chỉ 3/45 nhân sự có phân bổ chính đang hiệu lực, nên chưa thể dùng sơ đồ hiện tại để cấp quyền quản lý cho toàn công ty.
- Permission Health chưa tính `anon SELECT`, chưa phân biệt catalog đọc rộng với bảng HRM nhạy cảm, và coi mọi biểu thức `true` như cùng một loại rủi ro.

## 4. Mục tiêu và ngoài phạm vi

### 4.1 Mục tiêu

- Tạo bộ khung thông tin đủ dùng cho hồ sơ nhân sự, báo cáo, workflow, chấm công, nghỉ phép, hợp đồng và payroll về sau.
- Giữ một nguồn sự thật cho tổ chức/vị trí và một nguồn lịch sử cho các thay đổi có hiệu lực.
- Cho bốn nhóm vận hành chính — Nhân viên, Quản lý trực tiếp, HR và HR Manage — thấy và quản lý đúng phần dữ liệu cần thiết.
- Chặn direct API bypass bằng RLS/RPC, không dựa vào việc ẩn nút frontend.
- Cắt giảm policy rộng HRM đồng thời với triển khai chức năng, không để nợ bảo mật sang giai đoạn cuối.
- Cho phép nhập dữ liệu từ workbook theo quy trình staging, kiểm tra và audit.

### 4.2 Ngoài phạm vi phiên bản này

- Công thức P3, chốt bảng lương, hạch toán hoặc chuyển tiền lương.
- Tuyển dụng, onboarding workflow đầy đủ, đánh giá KPI/năng lực cá nhân.
- Chấm công thiết bị vật lý hoặc đồng bộ cơ quan bảo hiểm.
- Xóa ngay các cột HRM legacy đang được module khác sử dụng.
- Tự suy đoán quản lý từ tên vị trí, level hoặc chuỗi chức danh.
- Mở quyền HR ngầm cho user chỉ vì họ là System Admin; Admin phải chủ động tự cấp `HR_MANAGE` qua luồng được audit.

## 5. Các phương án đã cân nhắc

### Phương án A — Mở rộng bảng `employees`

Thêm toàn bộ 64 trường workbook vào một bảng. Cách này nhanh lúc nhập dữ liệu nhưng tạo nhiều cột null, không giữ được lịch sử, khó tách quyền theo nhóm dữ liệu và dễ lưu lặp số liệu suy ra.

**Kết luận:** Không chọn.

### Phương án B — Tạo HRM v2 độc lập

Tạo một bộ bảng và màn hình mới, giữ hệ thống cũ song song đến khi chuyển đổi xong. Cách này tách biệt tốt nhưng tạo hai nguồn sự thật cho nhân viên, tổ chức và quyền, làm tăng rủi ro đồng bộ.

**Kết luận:** Không chọn.

### Phương án C — Chuẩn hóa tiến hóa theo miền

Giữ `employees`, `org_units`, slot và assignment làm lõi; tách dữ liệu một-nhiều/nhạy cảm; bổ sung projection; thay policy và UI theo từng lát cắt dọc.

**Kết luận:** Chọn. Đây là phương án duy nhất vừa tái sử dụng phần đã triển khai, vừa cho phép harden permission mà không tạo hệ thống song song.

## 6. Nguyên tắc mô hình dữ liệu

1. Một sự kiện có lịch sử không được ghi đè thành một cột “hiện tại” duy nhất.
2. Giá trị suy ra không lưu lặp nếu có thể tính ổn định từ dữ liệu nguồn.
3. Dữ liệu nhạy cảm được tách theo miền để RLS và audit có thể độc lập.
4. Mọi bảng lịch sử có `effective_from`, `effective_to`, trạng thái và audit fields phù hợp.
5. Ngày nghiệp vụ dùng `date`; thời điểm hệ thống/audit dùng `timestamptz`; tiền dùng `numeric`; mã định danh dùng `text`.
6. Mọi foreign key dùng trong join, policy hoặc xóa/cập nhật phải có index phù hợp.
7. Không dùng tên người, email hoặc chức danh làm khóa liên kết. Khóa nhập chuẩn là `employee_code`; bản ghi một-nhiều có thêm `record_code` hoặc natural key rõ ràng.
8. Không hard delete hồ sơ đã phát sinh nghiệp vụ; dùng trạng thái/kết thúc hiệu lực.
9. Không lưu số CCCD, tài khoản ngân hàng hoặc mã số thuế trong JSON metadata tổng hợp.

## 7. Phân loại dữ liệu

| Mức | Nhóm | Ví dụ | Nguyên tắc mặc định |
| --- | --- | --- | --- |
| C0 | Danh mục tham chiếu | loại hợp đồng, level, vị trí, loại nhân sự | Authenticated được đọc nếu cần vận hành; ghi theo action quản trị danh mục. |
| C1 | Danh bạ nội bộ | tên, mã nhân viên, avatar, chức danh hiển thị, đơn vị, email/điện thoại công việc | Nhân viên được đọc projection an toàn; không đọc row thô. |
| C2 | Cá nhân | ngày sinh, địa chỉ, liên hệ riêng, người liên hệ khẩn cấp, trình độ | Chính chủ và HR theo scope; quản lý chỉ thấy allowlist nghiệp vụ. |
| C3 | Hạn chế HR | hợp đồng, hồ sơ pháp lý, thuế, bảo hiểm, người phụ thuộc, tài liệu | HR và HR Manage được xem/quản lý trong V1. |
| C4 | Đặc biệt nhạy cảm | lương, phụ cấp, tài khoản ngân hàng, payroll result | HR được xem; HR Manage được xem/quản lý trong V1. |

Một trường có độ nhạy cao hơn sẽ quyết định policy của row/table chứa nó. Không hạ độ nhạy bằng cách đặt chung với dữ liệu danh bạ.

## 8. Bộ khung thông tin nhân sự

### 8.1 Cấu trúc giao diện đích

| Tab | Nội dung | Nguồn chính | Ghi chú quyền |
| --- | --- | --- | --- |
| Tổng quan | Thông tin hiện tại, trạng thái hoàn thiện, thâm niên, vị trí, hợp đồng hiện tại, phép còn lại | Projection/RPC | Chỉ đọc; không lưu lặp. |
| Cá nhân & liên hệ | Họ tên, ngày sinh, giới tính, liên hệ, địa chỉ, khẩn cấp | `employees` + private profile/address/contact | Own hoặc HR scoped. |
| Công việc & tổ chức | Đơn vị, vị trí, level, chức danh hiển thị, quản lý, địa điểm, chuyên môn | Slot assignment + catalog | Tổ chức/vị trí chỉ đổi qua luồng phân bổ. |
| Hợp đồng & quá trình làm việc | Hợp đồng, thử việc, bổ nhiệm, điều chuyển, tăng lương, nghỉ việc | Contract + employment event | Chỉ HR/HR Manage; sự kiện có hiệu lực. |
| Chấm công & nghỉ phép | Lịch làm việc, công, đơn nghỉ, số dư và ledger phép | Attendance/leave domains | Own, manager scope hoặc HR. |
| Lương, thuế & ngân hàng | Compensation plan, mức hiệu lực, thuế, tài khoản nhận lương, payroll snapshot | Compensation/tax/bank/payroll | HR xem; HR Manage xem/quản lý; action C4 riêng ở backend. |
| Pháp lý & bảo hiểm | CCCD/hộ chiếu, BHXH, bảo hiểm, người phụ thuộc | Identity/insurance/dependent | Chỉ HR/HR Manage; dữ liệu hiển thị có masking khi cần. |
| Trình độ & hồ sơ | Học vấn, chứng chỉ, năng lực, tài liệu đính kèm | Qualification/certification/document | C2/C3 tùy loại tài liệu. |

Sheet `Nhóm` được đổi nghĩa thành tab `Công việc & tổ chức`; `Tổng quan` là projection; `Lương`, `Legals` và `Times` được phân rã theo miền thay vì giữ một hàng rộng.

### 8.2 Bảng lõi giữ lại

- `employees`: định danh nhân sự, mã nhân viên, tên chuẩn, trạng thái việc làm hiện tại và khóa liên kết user.
- `org_units`: cây đơn vị.
- `hrm_positions`, `hrm_position_groups`, `hrm_position_levels`: khung vị trí.
- `hrm_org_position_slots`: định biên vật chất hóa.
- `hrm_employee_slot_assignments`: phân bổ nhân sự có hiệu lực.
- `hrm_compensation_plans`, `hrm_employee_compensation_assignments`, `hrm_employee_manual_allowances`: nền compensation hiện có.
- Các bảng attendance/leave/payroll/document hiện có được giữ nhưng phải harden và chuẩn hóa theo từng lát cắt.

### 8.3 Bảng cần bổ sung hoặc chuẩn hóa

| Bảng đích | Cardinality | Dữ liệu chính | Mức |
| --- | --- | --- | --- |
| `hrm_employee_private_profiles` | 1:1 | ngày sinh, giới tính, tình trạng hôn nhân, liên hệ riêng | C2 |
| `hrm_employee_addresses` | 1:N | thường trú, tạm trú, liên hệ; hiệu lực | C2 |
| `hrm_employee_emergency_contacts` | 1:N | người liên hệ, quan hệ, số điện thoại | C2 |
| `hrm_employee_identity_documents` | 1:N | loại giấy tờ, số, ngày cấp/hết hạn, nơi cấp | C3 |
| `hrm_employee_tax_profiles` | 1:N theo hiệu lực | mã số thuế, trạng thái thuế | C3 |
| `hrm_employee_bank_accounts` | 1:N | ngân hàng, chi nhánh, số tài khoản, tài khoản nhận lương chính | C4 |
| `hrm_employee_insurance_profiles` | 1:N theo hiệu lực | mã BHXH, nơi tham gia, trạng thái | C3 |
| `hrm_employee_dependents` | 1:N | người phụ thuộc và thời gian giảm trừ | C3 |
| `hrm_employment_events` | 1:N | vào làm, thử việc, chính thức, bổ nhiệm, điều chuyển, tăng lương, nghỉ việc | C3/C4 |
| `hrm_employee_qualifications` | 1:N | học vấn, chuyên ngành, cơ sở đào tạo | C2 |
| `hrm_employee_certifications` | 1:N | chứng chỉ, đơn vị cấp, ngày hết hạn | C2/C3 |

`hrm_labor_contracts` và `hrm_salary_history` hiện chưa có dữ liệu. Trước khi nhập liệu thật, hai bảng này được chuẩn hóa tại chỗ về tên cột snake_case, kiểu dữ liệu và effective dating; không tạo thêm bảng `v2` song song.

Các trường C2 đang nằm trên `employees`, ví dụ ngày sinh hoặc liên hệ riêng, được chuyển dần sang bảng private tương ứng. Cột cũ được giữ như compatibility projection trong thời gian consumer chuyển đổi; không cho phép hai chiều chỉnh sửa tạo hai nguồn sự thật.

Với bảng attendance/leave/payroll đã có dữ liệu, việc chuẩn hóa kiểu/cột dùng chiến lược thêm cột typed → backfill → đối soát → chuyển consumer → bỏ cột cũ ở migration sau.

### 8.4 Giá trị không lưu trực tiếp trong hồ sơ

- Thâm niên: tính từ giai đoạn làm việc hợp lệ, có quy tắc trừ thời gian gián đoạn nếu nghiệp vụ yêu cầu.
- Hợp đồng hiện tại: chọn bản ghi có hiệu lực tại ngày truy vấn.
- Lần tăng lương gần nhất: lấy từ employment/compensation event đã duyệt.
- Mức lương hiện tại: lấy từ compensation assignment có hiệu lực; payroll result là snapshot theo kỳ, không phải hồ sơ hiện tại.
- Phép còn lại: lấy từ leave ledger/balance đã đối soát.
- Quản lý trực tiếp: resolve từ manager slot và assignment đang hiệu lực.
- Đơn vị, vị trí, level và chức danh chuẩn: resolve từ primary slot assignment; cột trên `employees` chỉ là compatibility projection trong giai đoạn chuyển tiếp.

## 9. Tổ chức, định biên và phân bổ nhân sự

### 9.1 Nguồn sự thật

```text
org_units
  → hrm_org_position_slots
    → hrm_employee_slot_assignments
      → projection vị trí hiện tại của nhân viên
```

Level E1–E11 mô tả khung vị trí/nghề nghiệp, không phải role bảo mật. Một E8 không tự động xem dữ liệu cấp dưới; một E4 có thể được cấp quyền HR chuyên trách trong phạm vi được duyệt.

### 9.2 Phân biệt khái niệm

- `position`: mẫu vị trí dùng chung.
- `slot`: một ghế định biên cụ thể tại một đơn vị.
- `level`: cấp nghề nghiệp của slot/vị trí.
- `display_title`: chức danh hiển thị, không dùng để cấp quyền.
- `specialty`: chuyên môn nghiệp vụ.
- `work_location`: văn phòng/công trường/nhà máy nơi làm việc; không đồng nhất với đơn vị tổ chức.
- `org_unit`: đơn vị quản trị trong cây tổ chức.

### 9.3 Quản lý định biên trong V1

V1 không tạo `hrm_staffing_change_requests` và không triển khai trạng thái đề xuất/phê duyệt định biên. HR Manage nhận thông tin đã thống nhất từ email, họp, quyết định hoặc các luồng nghiệp vụ khác rồi trực tiếp tạo hoặc điều chỉnh định biên.

- Chỉ HR Manage có `hrm.staffing.manage` được tăng/giảm định biên.
- RPC `adjust_hrm_staffing` hiện có được giữ, nhưng thay điều kiện Admin/HRM module-admin bằng `hrm.staffing.manage` thuộc template HR Manage và kiểm tra scope.
- Mỗi lần điều chỉnh bắt buộc có `reason`; có thể kèm `source_type`, `source_id` hoặc `source_reference` để truy vết luồng cung cấp thông tin.
- RPC khóa nhóm slot, kiểm tra invariant rồi tạo/lưu trữ slot trong một transaction.
- Không giảm định biên xuống dưới số người đang bố trí.
- Audit lưu người thao tác, thời điểm, đơn vị/vị trí, số lượng trước/sau, lý do và nguồn tham chiếu.
- Thao tác nhập nền bằng migration phải có manifest và đối soát.

Workflow đề xuất/phê duyệt chỉ được xem xét lại khi quy mô hoặc yêu cầu kiểm soát nội bộ tăng; không tạo bảng/action dự phòng trong V1.

### 9.4 Workflow phân bổ

- Gán/chuyển người vào slot trống cần `hrm.staffing.assign`; action này được cấp cho template HR Manage.
- Kết thúc phân bổ hiện tại và tạo phân bổ mới trong một transaction.
- Một nhân viên chỉ có một `PRIMARY` đang hiệu lực; một slot chỉ có một người giữ `PRIMARY` hoặc `ACTING` đang hiệu lực.
- `ACTING` giữ manager slot được hưởng manager relationship trong đúng thời gian hiệu lực và phải được audit.
- `SECONDARY` không tạo quyền quản lý mặc định.
- Đặt manager slot cần `hrm.staffing.set_manager`; action này thuộc template HR Manage và vẫn tách ở backend để audit.

### 9.5 Quản lý trực tiếp

Trong quy mô hiện tại, người giữ manager slot của đơn vị chính là Trưởng đơn vị và đồng thời là Quản lý trực tiếp của nhân sự trong đơn vị. Không tạo thêm persona “Quản lý đơn vị”. Thứ tự resolve đích:

1. Người đang giữ slot được `reports_to_slot_id` chỉ định; mặc định slot này là manager slot của đơn vị.
2. Người đang giữ `manager_slot_id` của đơn vị nếu slot nhân sự chưa cấu hình tuyến báo cáo.
3. Manager slot gần nhất ở đơn vị cha.
4. Không resolve được thì trả trạng thái thiếu dữ liệu; không suy đoán theo chức danh.

`users.manager_id` chỉ được dùng như fallback chuyển tiếp. Permission Health phải đếm số quyết định còn dùng fallback; điều kiện gỡ fallback là 0 trong ít nhất một chu kỳ vận hành đã thống nhất.

## 10. Mô hình phân quyền HRM

### 10.1 Persona nghiệp vụ

| Persona | Được xem/quản lý mặc định | Không mặc định được phép |
| --- | --- | --- |
| Nhân viên | danh bạ an toàn, sơ đồ cơ bản, hồ sơ cá nhân C2 của mình, công/phép của mình | C3 pháp lý/hợp đồng và C4 lương/ngân hàng, kể cả của chính mình trong V1 |
| Quản lý trực tiếp | quyền như nhân viên; thêm direct reports, thông tin công việc và công/phép cần duyệt | C3/C4 của cấp dưới, điều chỉnh định biên, phân bổ nhân sự |
| HR | nghiệp vụ nhân sự hằng ngày: hồ sơ C2–C4, hợp đồng, tài liệu, công/phép; xem compensation/payroll và danh mục | thay đổi cơ cấu, định biên, phân bổ, manager slot, cấu hình payroll/danh mục hoặc export nhạy cảm |
| HR Manage | toàn bộ quyền HR; thêm quản trị tổ chức, định biên, phân bổ, manager slot, compensation/payroll, danh mục và export | không vượt invariant/audit và không tự cấp quyền hệ thống cho tài khoản khác nếu không đồng thời là System Admin |

V1 có hai template nghiệp vụ HR: `HR` và `HR_MANAGE`. Không tách thêm HR specialist hoặc Payroll thành persona riêng. `HR_MANAGE` kế thừa toàn bộ `HR`; các action backend vẫn tách nhỏ để RLS và audit rõ ràng.

Hai template được đăng ký trong `role_permission_templates`; action của từng template nằm trong `role_permission_template_items`, còn việc cấp cho tài khoản được lưu bằng một assignment `global` đang hiệu lực trong `principal_role_assignments`. `HR_MANAGE` chứa đầy đủ tập action của `HR` cộng các action quản trị, không phụ thuộc vào cơ chế role lồng nhau. Không bung template thành nhiều dòng `user_permission_grants`, và không dùng tên phòng ban, chức danh, level hoặc metadata user để suy ra một actor thuộc HR/HR Manage.

System Admin là vai trò kỹ thuật nằm ngoài bốn persona nghiệp vụ. System Admin không tự động nhận quyền HR, nhưng được phép tự cấp template `HR_MANAGE` cho chính mình hoặc cấp `HR`/`HR_MANAGE` cho tài khoản khác qua màn hình quản trị quyền. Sau khi role assignment được ghi thành công, System Admin đó đồng thời là HR Manage và có full quyền HR.

Ma trận mặc định dưới đây là điểm bắt đầu của template; quyền thực tế vẫn phải có action, scope và thời gian hiệu lực:

| Nhóm dữ liệu/thao tác | Nhân viên | Quản lý trực tiếp | HR | HR Manage | System Admin chưa tự cấp HR |
| --- | --- | --- | --- | --- | --- |
| Danh bạ C1 | Toàn công ty, projection an toàn | Như nhân viên | Toàn công ty | Toàn công ty | Quyền nền Nhân viên |
| Hồ sơ C2 | Own | Allowlist direct reports | Toàn công ty | Toàn công ty | Own |
| Pháp lý/hợp đồng C3 | Không | Không | Xem/sửa toàn công ty | Xem/sửa toàn công ty | Không |
| Lương/ngân hàng C4 | Không | Không | Xem toàn công ty | Xem/sửa toàn công ty | Không |
| Xem định biên | Projection chung hoặc đơn vị của mình | Đơn vị trực tiếp quản lý | Toàn công ty | Toàn công ty | Projection chung |
| Điều chỉnh định biên | Không | Không | Không | Có, qua RPC và audit | Không |
| Phân bổ nhân sự | Không | Không | Không | Có | Không |
| Đặt manager slot | Không | Không | Không | Có | Không |
| Quản lý danh mục/payroll | Không | Không | Chỉ xem | Có | Không |
| Export C3/C4 | Không | Không | Không | Có, có audit | Không |
| Duyệt công/phép | Own submit/view | Direct reports/assigned | Toàn công ty | Toàn công ty | Own |

C3/C4 là HR-only: cả `HR` và `HR_MANAGE` được xem theo ma trận; chỉ `HR_MANAGE` được thay đổi C4, chạy/chốt payroll và export dữ liệu nhạy cảm. System Admin thuần kỹ thuật không có C3/C4, nhưng có thể tự cấp `HR_MANAGE` bằng luồng quản trị được audit.

### 10.2 Permission action đích

| Module | Permission | Mục đích |
| --- | --- | --- |
| Organization | `hrm.organization.view` | Xem sơ đồ/projection tổ chức. |
| Organization | `hrm.organization.manage` | Tạo/sửa/lưu trữ đơn vị theo scope. |
| Staffing | `hrm.staffing.view` | Xem định biên và tình trạng bố trí. |
| Staffing | `hrm.staffing.manage` | HR Manage trực tiếp tăng/giảm định biên qua RPC có audit. |
| Staffing | `hrm.staffing.assign` | Gán/chuyển/kết thúc phân bổ. |
| Staffing | `hrm.staffing.set_manager` | Chỉ định manager slot. |
| Employee | `hrm.employee.view_directory` | Xem projection danh bạ C1. |
| Employee | `hrm.employee.view_profile` | Xem hồ sơ C2 theo scope. |
| Employee | `hrm.employee.edit_profile` | Sửa hồ sơ C2 theo scope. |
| Employee | `hrm.employee.view_sensitive` | Xem C3 có masking phù hợp. |
| Employee | `hrm.employee.edit_sensitive` | Sửa C3. |
| Contract | `hrm.contract.view` | Xem hợp đồng theo scope. |
| Contract | `hrm.contract.manage` | Tạo/sửa/kết thúc hợp đồng. |
| Document | `hrm.document.view` | Xem metadata/file được phép. |
| Document | `hrm.document.manage` | Quản lý hồ sơ/tài liệu. |
| Attendance | `hrm.attendance.view` | Xem công theo scope. |
| Attendance | `hrm.attendance.edit` | Hiệu chỉnh công theo scope. |
| Attendance | `hrm.attendance.approve` | Duyệt/chốt công theo scope. |
| Leave | `hrm.leave.view` | Xem đơn/số dư theo scope. |
| Leave | `hrm.leave.approve` | Duyệt đơn được giao/thuộc scope. |
| Compensation | `hrm.compensation.view` | Xem C4 ngoài payroll result. |
| Compensation | `hrm.compensation.manage` | Quản lý mức/plan/phụ cấp. |
| Payroll | `hrm.payroll.view` | Xem kết quả payroll. |
| Payroll | `hrm.payroll.manage` | Chạy/chốt/điều chỉnh payroll qua workflow. |
| Master data | `hrm.master_data.view` | Xem danh mục C0. |
| Master data | `hrm.master_data.manage` | Quản lý danh mục C0. |
| Export | `hrm.employee.export`, `hrm.payroll.export` | Export là quyền riêng, không suy từ view. |

Nội dung template V1:

- Nhân viên: directory global; profile/attendance/leave ở scope `own` theo action được mở.
- Quản lý trực tiếp: kế thừa Nhân viên; thêm profile/attendance/leave ở scope `direct_reports` hoặc `assigned`.
- HR: `organization.view`, `staffing.view`, toàn bộ employee/profile/sensitive, contract, document, attendance, leave; `compensation.view`, `payroll.view`, `master_data.view` ở scope `global`. Không có organization/staffing/compensation/payroll/master-data manage hoặc export.
- HR Manage: kế thừa HR; thêm `organization.manage`, `staffing.manage`, `staffing.assign`, `staffing.set_manager`, `compensation.manage`, `payroll.manage`, `master_data.manage`, `employee.export` và `payroll.export` ở scope `global`.
- System Admin thuần kỹ thuật: không nhận quyền HRM ngầm. Khi tự cấp `HR_MANAGE`, hệ thống tạo một business-role assignment `global` đang hiệu lực cho tài khoản Admin.

`app_private.has_permission` phải được mở rộng để resolve cả direct grant hợp lệ lẫn item của business-role assignment đang hiệu lực. Riêng các action C3/C4 và export nhạy cảm, RPC cấp quyền lẻ phải từ chối; RLS/RPC dùng helper HR chuyên biệt để xác nhận action đến từ assignment `HR`/`HR_MANAGE` đã duyệt. Permission Health là lớp phát hiện bổ sung, không phải lớp bảo vệ duy nhất.

Ba permission legacy `hrm.employee.view/create/edit` được adapter tạm sang `directory/profile` phù hợp. Không adapter `hrm.master_data.manage` thành quyền organization/staffing hoặc sensitive data. Ba global grant HRM hiện hữu phải được rà lại và thay bằng template phù hợp trước khi C3/C4 hoạt động.

### 10.3 Scope đích

| Scope | Ý nghĩa HRM |
| --- | --- |
| `own` | Employee liên kết với actor hiện tại. |
| `direct_reports` | Nhân sự báo cáo trực tiếp qua slot relationship đang hiệu lực. |
| `org_unit` | Một đơn vị cụ thể, không tự bao gồm đơn vị con. |
| `assigned` | Subject/workflow đang được giao trực tiếp cho actor. |
| `global` | Toàn công ty; chỉ cấp có chủ đích và audit. |

`department` được giữ làm adapter tương thích, map một-một sang `org_unit`; code mới không tiếp tục mở rộng ý nghĩa của `department`. `org_subtree` chưa đưa vào V1; nếu cơ cấu nhiều tầng phát sinh nhu cầu thật, scope này được bổ sung bằng một thay đổi thiết kế riêng.

### 10.4 Chuỗi quyết định quyền

```text
session hợp lệ
→ app user đang hoạt động
→ permission action đang hiệu lực
→ scope grant khớp
→ subject thuộc scope tại thời điểm kiểm tra
→ relationship/assignment khớp nếu action yêu cầu
→ workflow state cho phép
→ thực thi và ghi audit
```

Admin override trực tiếp không áp dụng cho C3/C4 trong V1. Nếu một System Admin cần full quyền HR, người đó dùng chức năng tự cấp `HR_MANAGE`; policy chỉ chấp nhận business-role assignment đang hiệu lực, không dùng `OR is_admin()` trong policy C3/C4.

### 10.5 Helper và ranh giới database

- Helper đặc quyền nằm trong `app_private`, `SECURITY DEFINER`, có owner cố định, `search_path` rỗng hoặc cố định an toàn và revoke execute khỏi `public/anon/authenticated` nếu không cần gọi trực tiếp.
- Public RPC là wrapper có chữ ký hẹp, kiểm action/scope/subject, không nhận actor id từ client làm nguồn tin.
- View đơn giản dùng `security_invoker = true` và kế thừa RLS bảng nguồn.
- Danh bạ/sơ đồ có masking dùng guarded RPC trả explicit columns; client thông thường không query `employees` hoặc bảng C2–C4 thô.
- Không dùng service role ở frontend.
- Policy gọi auth/helper ổn định theo statement bằng `(select helper(...))` khi phù hợp và có index cho các cột join/policy.
- Bảng exposed bật RLS; policy C2–C4 deny-by-default.
- Active actor gate dùng restrictive policy; action policies dùng permissive policy có `USING` và `WITH CHECK` tương ứng.

## 11. Projection phục vụ giao diện

### 11.1 Danh bạ an toàn

RPC/projection chỉ trả:

- `employee_id`, `employee_code`, tên hiển thị, avatar.
- Đơn vị, vị trí, level và chức danh hiển thị.
- Email/điện thoại công việc nếu được đánh dấu công khai nội bộ.
- Trạng thái làm việc ở mức an toàn.

Không trả ngày sinh đầy đủ, địa chỉ, email/điện thoại riêng, giấy tờ, thuế, bảo hiểm, ngân hàng, lương hoặc link tài liệu.

### 11.2 Sơ đồ tổng quan

- Nhân viên: xem cây đơn vị và occupant C1 cần thiết cho cộng tác.
- Quản lý: xem định biên/tình trạng bố trí trong scope được quản lý.
- HR/lãnh đạo: xem toàn công ty theo action tương ứng.
- Số liệu nhạy cảm như chi phí lương không gắn vào RPC sơ đồ chung.
- Vacancy ngoài scope của nhân viên thường có thể bị ẩn hoặc chỉ hiển thị tổng quan theo quyết định sản phẩm, nhưng không được làm lộ kế hoạch nhân sự hạn chế.

### 11.3 Tổng quan hồ sơ

`get_hrm_employee_overview(employee_id)` trả các section theo action của actor. Response có `visible_sections` và `masked_fields` để frontend không tự suy đoán quyền từ dữ liệu null.

## 12. Chuẩn hóa nhập liệu từ Excel

### 12.1 Workbook nhập chuẩn

Workbook chính thức giữ nguyên nguyên tắc “mỗi sheet là một nhóm thông tin”, nhưng dùng 8 sheet theo các tab ở mục 8.1. Mỗi sheet có:

- `employee_code` bắt buộc.
- `record_code` cho dữ liệu một-nhiều.
- Cột typed rõ ràng; ngày là ngày, tiền là số, mã định danh là text.
- Danh mục chọn từ code chuẩn, không match tự do theo tên.
- Cột `effective_from`, `effective_to` khi dữ liệu có lịch sử.
- Sheet hướng dẫn/data dictionary riêng khi phát hành template; sheet này không phải dữ liệu nhập.

### 12.2 Pipeline nhập

```text
Upload file
→ lưu manifest + hash
→ parse vào staging riêng theo import batch
→ validate cấu trúc/kiểu/danh mục/trùng khóa
→ dry-run và báo lỗi theo sheet/dòng/cột
→ HR có quyền import xác nhận
→ apply bằng RPC transaction theo domain
→ audit + đối soát
```

- Không ghi thẳng từ Excel vào bảng đích.
- Không tự tạo danh mục mới khi gặp tên không khớp.
- Không match nhân sự bằng họ tên.
- Không log giá trị CCCD/tài khoản/lương trong thông báo lỗi hoặc client telemetry.
- File staging và file nguồn có retention/revoke rõ ràng; storage policy kiểm batch owner và permission.
- Template mẫu dùng dữ liệu giả danh/anonymized.

## 13. Permission Health cho HRM

### 13.1 Nhóm kiểm tra mới

| Check | Mức mặc định | Điều kiện |
| --- | --- | --- |
| `anonSensitiveSelect` | Critical | `anon` đọc bảng/view/storage C1–C4 không có capability công khai được duyệt. |
| `anonHrmMutation` | Critical | `anon` có insert/update/delete/truncate hoặc execute mutation HRM. |
| `authenticatedBroadWrite` | Critical | Authenticated/public ghi HRM bằng `true` hoặc không kiểm action/scope. |
| `hrmSensitiveBroadRead` | Critical | C2–C4 đọc rộng cho authenticated/public. |
| `hrmRawTableExposure` | High | Client thông thường được grant raw table C2–C4 thay vì projection/RPC hẹp. |
| `hrmLegacyAdminPolicies` | High | Policy/RPC C2–C4 còn dùng `is_module_admin('HRM')` hoặc `system.hrm.manage` làm đủ quyền. |
| `hrmUnscopedOrganizationPolicies` | High | Organization/staffing mutation không kiểm org scope. |
| `duplicatePolicies` | Medium | Nhiều policy trùng chức năng trên cùng table/action/role. |
| `catalogAllowlistDrift` | Medium | Read rộng C0 không có allowlist, owner, lý do và ngày review. |
| `staffingIntegrity` | High | Primary assignment trùng, occupied > headcount, manager slot sai đơn vị hoặc vòng lặp. |
| `organizationReadiness` | High | Nhân sự active thiếu primary slot hoặc đơn vị quản lý thiếu manager chain. |
| `legacyManagerFallback` | Medium | Quyết định quản lý còn dùng `users.manager_id`. |
| `permissionRegistryDrift` | High | Code/policy dùng action không có registry hoặc action nhạy cảm chưa enforced. |
| `hrSensitiveGrantOutsideApprovedTemplate` | Critical | Grant C3/C4 đang hoạt động được cấp ngoài template `HR` hoặc `HR_MANAGE`. |
| `hrAdminImplicitBypass` | Critical | Frontend/helper/RLS cho System Admin dùng HR action chỉ vì `role = ADMIN` hoặc `is_admin()`. |
| `hrTemplateDefinitionDrift` | High | Item/phiên bản của system template `HR` hoặc `HR_MANAGE` không còn khớp permission registry được khai báo trong migration. |

### 13.2 Allowlist policy rộng

Policy `true` không tự động là lỗi nếu table chỉ là C0 và chỉ cho `authenticated SELECT`. Mỗi ngoại lệ phải có registry:

- schema/table/view và command.
- data classification.
- vai trò được phép.
- lý do nghiệp vụ.
- owner.
- ngày duyệt và ngày review tiếp theo.

Không allowlist bằng regex tên bảng. `public` không đồng nghĩa với dữ liệu được phép công khai qua `anon`.

### 13.3 Cổng chất lượng

Trước khi đóng mỗi lát cắt HRM:

- 0 `anon` read/write trên dữ liệu C1–C4.
- 0 broad write chưa được phê duyệt.
- 0 broad read trên C2–C4.
- 0 action UI nhạy cảm chỉ dựa vào boolean route/module.
- Direct REST và RPC test cho phép/deny giống UI.
- Permission Health không tăng finding Critical/High mới.

## 14. Thay đổi giao diện phân quyền

### 14.1 Danh mục dùng chung HRM

`SettingsHrmSharedCatalog` không nhận một prop `canManage`. Component nhận capability map hoặc gọi hook permission theo action và subject:

```text
canViewOrganization
canManageOrganization
canViewStaffing
canManageStaffing
canAssignEmployee
canSetManager
canViewMasterData
canManageMasterData
```

Mỗi nút và mỗi API call kiểm action tương ứng. UI disable/ẩn chỉ phục vụ trải nghiệm; RPC vẫn kiểm lại.

### 14.2 Hồ sơ nhân sự

- Section render theo `visible_sections` từ backend.
- Field C3/C4 không được tải rồi mới ẩn bằng CSS.
- Có trạng thái “không có quyền xem” khác với “chưa có dữ liệu”.
- Edit form chỉ gửi field thuộc section được cấp; không gửi lại toàn bộ employee object.
- Organization fields là chỉ đọc và chuyển qua workflow phân bổ.

### 14.3 Màn hình cấu hình quyền đích

Màn hình nằm tại `Cài đặt → Người dùng & phân quyền`. Danh sách bên trái có tìm kiếm và các nhãn `System Admin`, `Nhân viên`, `Quản lý trực tiếp`, `HR`, `HR Manage`. Khi chọn một tài khoản, panel bên phải có bốn tab:

```text
┌ Tìm tài khoản ───────────┬ Tài khoản: Nguyễn Văn A ─────────────────────┐
│ Nguyễn Văn A             │ [Tổng quan] [Vai trò nghiệp vụ] [Quyền] [LS] │
│ System Admin · HR Manage │ Vai trò hệ thống:  System Admin              │
│                          │ Quản lý trực tiếp:  Có · Đơn vị X (chỉ đọc)  │
│ Trần Thị B               │ Template HR:        ○ Không  ○ HR  ● HR Manage│
│ Nhân viên · HR           │ Hiệu lực:            Từ ngày ... / hết hạn ...│
│                          │ Lý do:               [........................]│
│ Lê Văn C                 │ ┌ Preview: + payroll.manage, + export ... ┐   │
│ Nhân viên                │ └──────────────────────────────────────────┘   │
│                          │                         [Áp dụng quyền]        │
└──────────────────────────┴────────────────────────────────────────────────┘
```

1. `Tổng quan`: trạng thái tài khoản, employee liên kết, đơn vị/manager slot, template hiện tại và thời hạn.
2. `Vai trò nghiệp vụ`: chọn template HR và xem vai trò Quản lý trực tiếp được suy ra từ tổ chức.
3. `Quyền chi tiết`: ma trận action/scope để giải thích template; mặc định chỉ đọc đối với action do template quản lý.
4. `Lịch sử`: ai cấp/gỡ quyền, trước/sau, lý do, thời gian và nguồn thao tác.

Khối `Vai trò nghiệp vụ` dùng các điều khiển sau:

| Trường | Cách hoạt động |
| --- | --- |
| Vai trò hệ thống | `Nhân viên` hoặc `System Admin`; độc lập với quyền HR. |
| Vai trò quản lý trực tiếp | Badge chỉ đọc, được suy ra từ manager slot và assignment đang hiệu lực; không tick tay tại đây. |
| Template HR | Chọn một trong `Không có`, `HR`, `HR Manage`; `HR Manage` đã bao gồm HR. |
| Hiệu lực | Mặc định từ hiện tại, có thể đặt ngày hết hạn cho quyền tạm thời. |
| Lý do | Bắt buộc khi cấp, nâng, hạ hoặc thu hồi HR/HR Manage. |

Sau khi chọn template, UI gọi preview và hiển thị:

- action được thêm/gỡ, scope và thời hạn;
- section C3/C4 sẽ mở hoặc đóng;
- cảnh báo riêng khi thêm `HR Manage`, payroll manage hoặc export;
- fingerprint trạng thái hiện tại để phát hiện người khác vừa sửa quyền.

Nút `Áp dụng quyền` chỉ hoạt động sau khi Admin nhập lý do và xác nhận cảnh báo. Preview cấp mới dùng `preview_business_role_assignment`; cấp mới dùng `assign_business_role`; thu hồi dùng `revoke_business_role_assignment`. Khi đổi `HR ↔ HR Manage` hoặc đổi về `Không có`, một RPC điều phối `set_user_hr_business_role` thực hiện revoke/assign trong cùng transaction, kiểm fingerprint, ghi audit rồi frontend tải lại effective grants. Client không cập nhật trực tiếp `public.users`, `principal_role_assignments` hoặc `user_permission_grants`.

### 14.4 System Admin tự cấp full quyền HR

System Admin nhìn thấy nút `Cấp HR Manage cho tôi` trong tài khoản của chính mình. Luồng thao tác:

```text
Bấm “Cấp HR Manage cho tôi”
→ preview template HR_MANAGE và toàn bộ action sẽ có hiệu lực
→ cảnh báo truy cập pháp lý, lương, ngân hàng và payroll
→ nhập lý do bắt buộc + xác nhận
→ tạo business-role assignment bằng RPC quản trị quyền
→ ghi audit self-grant
→ refresh session/effective grants
→ mở các màn hình HR theo quyền mới
```

Self-grant được phép vì actor đã là System Admin có quyền quản trị grant; `target_user_id` có thể bằng actor. Đây không phải self-update hồ sơ: RPC vẫn kiểm actor là Admin, phiên bản/fingerprint, template hợp lệ và warning acceptance. HR Manage không có quyền cấp template cho mình hoặc người khác nếu tài khoản đó không đồng thời là System Admin.

Khi System Admin đã có `HR_MANAGE`, nút đổi thành `Thu hồi HR Manage của tôi`; thao tác cũng bắt buộc preview, lý do và audit. Thu hồi chỉ bỏ business role HR, không đổi vai trò hệ thống `System Admin`.

Hiện tại `PermissionMatrix` bị ẩn khi `role = ADMIN`, save path xóa explicit grants của Admin, và `canPerform()` trả `true` cho mọi action của Admin. Lộ trình phải sửa cả ba điểm, đồng thời tách UI business-role assignment khỏi ma trận direct grant:

- System Admin vẫn thấy khối template HR và lưu được role assignment của chính mình.
- `canPerform()`/`getInheritedPermissionCodes()` không coi Admin có HR actions ngầm.
- RLS/RPC HR không dùng `is_admin()` làm bypass; chỉ đọc role assignment đang hiệu lực từ `HR`/`HR_MANAGE`.

### 14.5 Cách Admin phân tài khoản

| Nhu cầu tài khoản | Cấu hình của Admin |
| --- | --- |
| Nhân viên thông thường | Vai trò hệ thống `Nhân viên`, Template HR `Không có`; liên kết đúng employee. |
| Trưởng đơn vị/Quản lý trực tiếp | Giữ vai trò hệ thống `Nhân viên`, Template HR `Không có`; cấu hình người đó giữ manager slot tại Danh mục dùng chung HRM. Quyền direct reports tự phát sinh theo quan hệ. |
| Nhân sự HR tác nghiệp | Vai trò hệ thống `Nhân viên`, Template `HR`. |
| Người quản trị toàn bộ HR | Vai trò hệ thống `Nhân viên`, Template `HR Manage`. |
| System Admin thuần kỹ thuật | Vai trò hệ thống `System Admin`, Template HR `Không có`. |
| System Admin cần full HR | Vai trò hệ thống `System Admin`, Template `HR Manage`; có thể tự cấp bằng nút riêng. |

Không gán Quản lý trực tiếp theo chức danh hoặc checkbox permission. Không chọn đồng thời `HR` và `HR Manage`. Không cấp lẻ action C3/C4 ngoài hai template trong V1.

## 15. Luồng lỗi và trạng thái biên

- Actor không có employee liên kết: own scope deny, hiển thị hướng dẫn HR liên kết hồ sơ.
- Nhân sự chưa có primary slot: hiển thị `Chờ phân bổ`; không tự gán org scope từ cột legacy.
- Manager slot trống: tìm manager chain cha; nếu vẫn trống thì workflow báo thiếu tuyến duyệt và không broadcast cho mọi HR/admin.
- Hai thay đổi hiệu lực giao nhau: constraint/RPC từ chối với lỗi nghiệp vụ rõ ràng.
- Giảm định biên có người: từ chối và trả số slot cần xử lý.
- File import sai danh mục: dry-run trả code lỗi theo cell, không tự tạo/match gần đúng.
- Quyền bị thu hồi khi form đang mở: mutation trả 403 nghiệp vụ; frontend làm mới capability.
- Link sâu đến hồ sơ: re-check session, action, scope và subject; copy URL không tạo quyền.

## 16. Rollout đề xuất

### Phase 0 — Baseline và health gate

- Đăng ký data classification và allowlist C0.
- Mở rộng Permission Health với `anon SELECT`, broad read/write, raw table, legacy policy và readiness.
- Đăng ký hai template `HR`/`HR_MANAGE`, thêm preview/apply/self-grant có audit và gán trước template cho các tài khoản cần giữ quyền sau cutover.
- Thêm test snapshot policy/grant Cloud.
- Không đổi dữ liệu nghiệp vụ.

### Phase 1 — Chặn ghi rộng

- Revoke `anon` và broad write ở 6 nhóm table hiện có.
- Thay mutation leave/document/shift bằng policy/RPC kiểm action.
- Gỡ HR action khỏi blanket `Role.ADMIN => true` và khỏi mọi `is_admin()`/module-admin bypass sau khi self-grant UI đã sẵn sàng.
- Giữ feature flag và smoke test theo persona.

### Phase 2 — Projection và đọc nhạy cảm

- Tạo directory/org projection an toàn.
- Harden contract, attendance, leave, document và storage reads.
- Tách C2–C4 khỏi endpoint employee chung.

### Phase 3 — Scope tổ chức và làm sạch dữ liệu

- Thêm `direct_reports` và `org_unit` vào permission model; chưa triển khai `org_subtree`.
- Hoàn thiện primary assignment và manager slot.
- Chỉ bật quyền xem/duyệt theo `direct_reports` cho đơn vị đạt readiness; Quản lý trực tiếp không có staffing mutation.
- Theo dõi rồi loại fallback `users.manager_id`.

### Phase 4 — Quản lý định biên trực tiếp và capability UI

- Harden `adjust_hrm_staffing` bằng `hrm.staffing.manage`, reason/source reference và audit.
- Tách các capability của `SettingsHrmSharedCatalog`.
- Chỉ template HR Manage được gọi staffing/assignment/set-manager RPC.

### Phase 5 — Hồ sơ nhân sự mở rộng

- Triển khai lần lượt C2, C3 rồi C4.
- Chuẩn hóa contract/salary table trống trước khi nhập.
- Phát hành workbook template và import staging/dry-run.

### Phase 6 — Cleanup

- Gỡ adapter `department`, HRM module-admin và cột projection legacy khi không còn consumer.
- Xóa execute/grant legacy sau một chu kỳ theo dõi không có sử dụng.
- Chốt tài liệu vận hành và playbook xử lý finding Permission Health.

## 17. Chiến lược migration và rollback

- Mọi thay đổi schema/policy là migration mới, chạy trên Supabase Cloud theo quy trình dự án; không dùng Supabase local hoặc Docker.
- Mỗi phase có preflight query, backup logic/manifest, transaction thử nếu khả thi và postflight counts.
- Policy mới được test với JWT persona thật hoặc service mô phỏng đúng PostgREST; không dùng role `postgres` làm bằng chứng duy nhất.
- Dữ liệu mới backfill theo batch idempotent, có bảng đối soát và không log PII.
- Rollback policy phải đưa hệ thống về deny/read-only an toàn, không mở `using (true)` để chữa lỗi.
- Khi thay đổi function, giữ chữ ký cũ bằng wrapper có thời hạn nếu consumer chưa chuyển; Permission Health báo consumer legacy.
- Migration phá vỡ contract chỉ thực hiện sau khi static search và runtime telemetry xác nhận không còn consumer.

## 18. Kiểm thử bắt buộc

### 18.1 Database/RLS

- `anon` không đọc/ghi C1–C4 và không execute mutation HRM.
- Employee chỉ đọc/sửa allowlist own.
- Direct manager chỉ truy cập direct reports, không truy cập peer hoặc người ở subtree khác.
- Employee và Direct manager không đọc được C3/C4, kể cả C3/C4 của chính Employee trong V1.
- HR xem/sửa C3 và xem C4 nhưng bị deny C4 mutation, organization/staffing manage và export.
- HR Manage xem/sửa C3/C4 và thực hiện được toàn bộ HR manage action.
- System Admin chưa có template HR bị deny C3/C4.
- System Admin tự cấp `HR_MANAGE` qua RPC thì được phép C3/C4; audit phải ghi actor và target là cùng một user.
- Grant hết hạn bị deny.
- Quyền đúng action nhưng sai scope bị deny.
- Direct REST table call và RPC bypass bị chặn.

### 18.2 Tổ chức/định biên

- Không tạo primary assignment hoặc occupant trùng hiệu lực.
- Không tạo reporting/org cycle.
- Không giảm headcount dưới occupied count.
- `adjust_hrm_staffing` từ chối actor không có HR Manage.
- Điều chỉnh định biên yêu cầu lý do, ghi nguồn tham chiếu nếu có, tạo đúng slot trong một transaction và audit đầy đủ.
- Acting manager chỉ có scope trong thời gian acting.
- Manager resolver đi theo thứ tự mục 9.5.

### 18.3 Hồ sơ/import

- Overview tính đúng hợp đồng, thâm niên, lương và phép tại ngày biên.
- Section C3/C4 không xuất hiện trong payload khi actor không có quyền.
- Import bắt trùng employee/record key, sai kiểu ngày/tiền, danh mục lạ và khoảng hiệu lực giao nhau.
- Dry-run không thay đổi bảng đích.
- Apply idempotent theo batch và không nhân đôi lịch sử.

### 18.4 UI/hồi quy

- Mỗi action button có capability riêng và backend deny tương ứng.
- Deep link/refresh không làm lộ dữ liệu.
- Danh bạ, My Profile, Employee Dashboard, workflow chọn người duyệt, booking direct manager và project consumers tiếp tục hoạt động.
- Production build, lint, unit/integration test và smoke test persona đều đạt.

## 19. Tiêu chí sẵn sàng và nghiệm thu

### 19.1 Cổng bật manager-scoped permission

- 100% nhân sự `Đang làm việc` có đúng một primary assignment đang hiệu lực, hoặc có exception record được HR duyệt.
- 100% đơn vị được phép chạy workflow quản lý có manager slot hoặc manager chain hợp lệ.
- Không có slot/reporting cycle và không có occupied > headcount.
- Direct manager resolver không phụ thuộc vào chức danh/level.
- Các user quản lý cần thiết đã liên kết employee.

Với baseline hiện tại 3/45 primary assignment và 10/22 manager slot, cổng này **chưa đạt**.

### 19.2 Nghiệm thu chức năng

- Tám tab hồ sơ dùng đúng nguồn dữ liệu, không lưu lặp giá trị suy ra.
- Organization fields chỉ thay đổi qua phân bổ.
- Quản lý trực tiếp xem/duyệt đúng direct reports nhưng không điều chỉnh định biên hoặc phân bổ nhân sự.
- HR thực hiện nghiệp vụ hồ sơ hằng ngày và xem C4 nhưng không điều chỉnh cơ cấu/payroll.
- HR Manage trực tiếp tạo/điều chỉnh định biên, phân bổ nhân sự, đặt manager slot và quản lý payroll với audit.
- Nhân viên, Quản lý trực tiếp, HR, HR Manage và System Admin nhận đúng projection theo ma trận.
- System Admin tự cấp/thu hồi HR Manage cho mình qua preview/apply; save không làm mất business-role assignment của tài khoản Admin.
- Import workbook có staging, dry-run, lỗi theo cell, audit và dữ liệu mẫu giả danh.

### 19.3 Nghiệm thu bảo mật

- Không còn 8 broad write policy HRM hiện tại.
- Không còn `anon SELECT` trên bảng HRM C1–C4.
- Không còn broad read C2–C4 cho public/authenticated.
- C3/C4 chỉ trả dữ liệu cho actor có template HR hoặc HR Manage; Employee, Quản lý trực tiếp và System Admin chưa tự cấp HR đều bị deny.
- Không còn HR permission bypass từ `Role.ADMIN`, `is_admin()` hoặc `system.hrm.manage`.
- C0 read rộng chỉ tồn tại trong allowlist có owner và review date.
- Permission Health không còn Critical/High trong lát cắt đã cutover.
- Không có raw sensitive payload bị tải về client khi UI không hiển thị.

## 20. Phản biện và quyết định cần giữ vững

1. **Không sao chép nguyên Excel vào database.** Workbook tối ưu cho nhập/đọc theo hàng; database phải tối ưu cho lịch sử, toàn vẹn và phân quyền.
2. **Không coi cấp bậc là quyền.** E-level là dữ liệu nghề nghiệp; gắn thẳng với quyền sẽ khiến luân chuyển/chức danh làm thay đổi truy cập ngoài ý muốn.
3. **Không cho quản lý xem toàn bộ hồ sơ cấp dưới.** Nhu cầu quản lý công việc không đồng nghĩa với nhu cầu xem định danh, ngân hàng hoặc lương.
4. **Chỉ HR/HR Manage được xem C3/C4 trong V1.** Nhân viên và Quản lý trực tiếp bị deny. System Admin chỉ xem được sau khi tự gán business role `HR_MANAGE`; mở self-service cho nhân viên phải là thay đổi thiết kế riêng.
5. **Hai template HR không thay thế action kỹ thuật.** HR làm nghiệp vụ hằng ngày; HR Manage có quyền cấu hình/điều chỉnh đầy đủ. Mỗi hành động vẫn dùng permission code riêng để RLS và audit rõ ràng.
6. **Không bật scope quản lý khi dữ liệu tổ chức chưa sạch.** Cho phép trên dữ liệu 3/45 assignment sẽ tạo quyết định quyền sai hoặc fallback quá rộng.
7. **Không sửa Permission Health bằng cách ẩn finding.** Chỉ allowlist catalog C0 có hồ sơ ngoại lệ; policy C2–C4 phải được thay thực sự.
8. **Không để cột lương “đề xuất/hợp đồng/hiện tại/thực trả” nhập nhằng.** Mỗi khái niệm phải có nguồn, ngày hiệu lực và người duyệt riêng.
9. **Không đưa “ký quỹ nhân viên” vào schema chuẩn nếu chưa có căn cứ pháp lý và quy trình được phê duyệt.** Nếu đây là tạm ứng/khấu trừ hoặc công cụ lao động thì phải mô hình đúng nghiệp vụ tương ứng.
10. **Không dùng tên gọi BHXH cũ làm khóa bất biến.** Lưu loại mã, giá trị, cơ quan và thời gian hiệu lực để hỗ trợ thay đổi định danh/quy định.

## 21. Chỉ số vận hành sau triển khai

- Tỷ lệ active employee có primary assignment.
- Tỷ lệ managed org unit có manager chain.
- Số lần dùng legacy manager fallback.
- Số grant `global`, C3/C4 và export đang hoạt động.
- Số deny theo action/scope và số override có lý do.
- Số Permission Health finding theo nhóm/mức.
- Tỷ lệ hồ sơ hoàn thiện theo section, không dùng một phần trăm chung che mất trường bắt buộc.
- Tỷ lệ import row thành công/lỗi và lỗi theo loại, không ghi PII.
- Thời gian truy vấn directory/org projection và số policy scan chậm.

## 22. Tài liệu kỹ thuật tham chiếu

- Supabase Row Level Security: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase database functions: <https://supabase.com/docs/guides/database/functions>
- Supabase table security/Data API: <https://supabase.com/docs/guides/database/tables#table-security>
- Postgres Row Security Policies: <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>

## 23. Quyết định đã được người dùng duyệt

1. Dùng mô hình 8 tab tại mục 8.1 thay cho 6 sheet nguồn.
2. Trưởng đơn vị chính là Quản lý trực tiếp; vai trò này được suy ra từ manager slot, không gán tay trong permission matrix.
3. Có hai template HR: `HR` cho nghiệp vụ hằng ngày và `HR_MANAGE` cho full quyền HR; không tách persona Payroll.
4. Chưa triển khai tính năng đề xuất/phê duyệt định biên. HR Manage nhận thông tin từ các luồng khác và trực tiếp tạo/điều chỉnh định biên có lý do, nguồn tham chiếu và audit.
5. C3/C4 chỉ HR và HR Manage được xem trong V1. System Admin không có quyền HR ngầm nhưng được phép tự cấp `HR_MANAGE` qua luồng preview/xác nhận/audit; Employee self-service C3/C4 chưa triển khai.

Sau khi người dùng xác nhận bản cập nhật phản ánh đúng năm quyết định trên, bước tiếp theo là viết implementation plan theo phase 0–6; chưa triển khai migration trước mốc xác nhận này.
