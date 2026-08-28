# Đặc tả chuẩn hóa hồ sơ nhân sự, định biên và phân quyền theo phạm vi HRM

**Ngày:** 28/08/2026

**Trạng thái:** Bản đặc tả đề nghị duyệt

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
- Quản lý đơn vị được phép đề xuất định biên nhưng không mặc định có quyền phê duyệt, phân bổ nhân sự hoặc đặt manager slot.
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
- Cho nhân viên, quản lý trực tiếp, quản lý đơn vị, HR, payroll và lãnh đạo thấy đúng phần dữ liệu cần thiết.
- Chặn direct API bypass bằng RLS/RPC, không dựa vào việc ẩn nút frontend.
- Cắt giảm policy rộng HRM đồng thời với triển khai chức năng, không để nợ bảo mật sang giai đoạn cuối.
- Cho phép nhập dữ liệu từ workbook theo quy trình staging, kiểm tra và audit.

### 4.2 Ngoài phạm vi phiên bản này

- Công thức P3, chốt bảng lương, hạch toán hoặc chuyển tiền lương.
- Tuyển dụng, onboarding workflow đầy đủ, đánh giá KPI/năng lực cá nhân.
- Chấm công thiết bị vật lý hoặc đồng bộ cơ quan bảo hiểm.
- Xóa ngay các cột HRM legacy đang được module khác sử dụng.
- Tự suy đoán quản lý từ tên vị trí, level hoặc chuỗi chức danh.
- Mở quyền cho user chỉ vì họ là system admin.

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
| C3 | Hạn chế HR | hợp đồng, hồ sơ pháp lý, thuế, bảo hiểm, người phụ thuộc, tài liệu | HR có action và scope; quản lý không mặc định được xem. |
| C4 | Đặc biệt nhạy cảm | lương, phụ cấp, tài khoản ngân hàng, payroll result | Payroll/HR được cấp riêng; system admin và quản lý không tự động có quyền. |

Một trường có độ nhạy cao hơn sẽ quyết định policy của row/table chứa nó. Không hạ độ nhạy bằng cách đặt chung với dữ liệu danh bạ.

## 8. Bộ khung thông tin nhân sự

### 8.1 Cấu trúc giao diện đích

| Tab | Nội dung | Nguồn chính | Ghi chú quyền |
| --- | --- | --- | --- |
| Tổng quan | Thông tin hiện tại, trạng thái hoàn thiện, thâm niên, vị trí, hợp đồng hiện tại, phép còn lại | Projection/RPC | Chỉ đọc; không lưu lặp. |
| Cá nhân & liên hệ | Họ tên, ngày sinh, giới tính, liên hệ, địa chỉ, khẩn cấp | `employees` + private profile/address/contact | Own hoặc HR scoped. |
| Công việc & tổ chức | Đơn vị, vị trí, level, chức danh hiển thị, quản lý, địa điểm, chuyên môn | Slot assignment + catalog | Tổ chức/vị trí chỉ đổi qua luồng phân bổ. |
| Hợp đồng & quá trình làm việc | Hợp đồng, thử việc, bổ nhiệm, điều chuyển, tăng lương, nghỉ việc | Contract + employment event | HR scoped; sự kiện có hiệu lực. |
| Chấm công & nghỉ phép | Lịch làm việc, công, đơn nghỉ, số dư và ledger phép | Attendance/leave domains | Own, manager scope hoặc HR. |
| Lương, thuế & ngân hàng | Compensation plan, mức hiệu lực, thuế, tài khoản nhận lương, payroll snapshot | Compensation/tax/bank/payroll | Action C4 riêng. |
| Pháp lý & bảo hiểm | CCCD/hộ chiếu, BHXH, bảo hiểm, người phụ thuộc | Identity/insurance/dependent | C3; dữ liệu hiển thị có masking. |
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

### 9.3 Workflow định biên

Mọi thay đổi số lượng định biên đi qua `hrm_staffing_change_requests`:

```text
DRAFT → SUBMITTED → APPROVED | REJECTED → APPLIED
```

- Quản lý đơn vị có `hrm.staffing.propose` trong scope hợp lệ được tạo/gửi đề xuất.
- HR manager có `hrm.staffing.approve` được duyệt hoặc từ chối.
- Người đề xuất không tự duyệt cùng một yêu cầu, trừ override được cấu hình riêng, có lý do và audit.
- Khi duyệt, RPC khóa nhóm slot, kiểm tra invariant rồi tạo/lưu trữ slot trong một transaction.
- Không giảm định biên xuống dưới số người đang bố trí.
- Thao tác nhập nền bằng migration không dùng workflow người dùng nhưng phải có manifest và đối soát.

RPC `adjust_hrm_staffing` trực tiếp hiện có được đánh dấu legacy và ngừng cấp execute cho client sau khi workflow mới hoạt động.

### 9.4 Workflow phân bổ

- Gán/chuyển người vào slot trống cần `hrm.staffing.assign`.
- Kết thúc phân bổ hiện tại và tạo phân bổ mới trong một transaction.
- Một nhân viên chỉ có một `PRIMARY` đang hiệu lực; một slot chỉ có một người giữ `PRIMARY` hoặc `ACTING` đang hiệu lực.
- `ACTING` giữ manager slot được hưởng manager relationship trong đúng thời gian hiệu lực và phải được audit.
- `SECONDARY` không tạo quyền quản lý mặc định.
- Đặt manager slot cần `hrm.staffing.set_manager`, độc lập với quyền assign.

### 9.5 Quản lý trực tiếp

Thứ tự resolve đích:

1. Người đang giữ slot được `reports_to_slot_id` chỉ định.
2. Người đang giữ `manager_slot_id` của đơn vị.
3. Manager slot gần nhất ở đơn vị cha.
4. Không resolve được thì trả trạng thái thiếu dữ liệu; không suy đoán theo chức danh.

`users.manager_id` chỉ được dùng như fallback chuyển tiếp. Permission Health phải đếm số quyết định còn dùng fallback; điều kiện gỡ fallback là 0 trong ít nhất một chu kỳ vận hành đã thống nhất.

## 10. Mô hình phân quyền HRM

### 10.1 Persona nghiệp vụ

| Persona | Được xem/quản lý mặc định | Không mặc định được phép |
| --- | --- | --- |
| Nhân viên | danh bạ an toàn, sơ đồ cơ bản, hồ sơ/công/phép/payroll của mình | dữ liệu riêng hoặc lương của người khác |
| Quản lý trực tiếp | direct reports, thông tin công việc, công/phép cần duyệt | CCCD, ngân hàng, lương và hồ sơ pháp lý |
| Quản lý đơn vị | subtree được quản lý, số liệu định biên, gửi đề xuất | tự duyệt định biên, tự gán người, xem lương |
| HR specialist | hồ sơ/contract/legal/time theo grant | payroll nếu chưa được cấp action C4 |
| HR manager | quản trị tổ chức, duyệt định biên, phân bổ, đặt manager | không vượt invariant hoặc audit |
| Payroll | compensation, thuế, ngân hàng, payroll theo scope | sửa cơ cấu tổ chức nếu không có grant riêng |
| Lãnh đạo | tổng hợp/global và projection có masking | raw table C3/C4 nếu không có grant riêng |
| System admin | vận hành kỹ thuật | tự động đọc dữ liệu C3/C4 |

Persona là template cấp quyền, không phải một nhánh bypass trong RLS.

Ma trận mặc định dưới đây là điểm bắt đầu của template; grant thực tế vẫn phải có action, scope và thời gian hiệu lực:

| Nhóm dữ liệu/thao tác | Nhân viên | QL trực tiếp | QL đơn vị | HR specialist | HR manager | Payroll | Lãnh đạo | System admin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Danh bạ C1 | Toàn công ty, projection an toàn | Như nhân viên | Như nhân viên | Theo grant | Toàn công ty | Theo nhu cầu | Toàn công ty | Không tự động |
| Hồ sơ C2 | Own | Allowlist direct reports | Allowlist subtree | Org/subtree/global theo grant | Global | Own hoặc theo grant | Tổng hợp/masked | Không tự động |
| Pháp lý/hợp đồng C3 | Own theo section được mở | Không | Không | Org/subtree/global theo grant | Global | Phần phục vụ payroll theo grant | Masked/aggregate | Không tự động |
| Lương/ngân hàng C4 | Own payroll statement | Không | Không | Không mặc định | Theo grant riêng | Org/subtree/global theo grant | Aggregate theo grant | Không tự động |
| Xem định biên | Own unit hoặc projection chung | Direct unit | Org subtree | Theo grant | Global | Không mặc định | Global | Không tự động |
| Đề xuất định biên | Không | Không mặc định | Org subtree | Theo grant | Global | Không | Không mặc định | Không tự động |
| Duyệt định biên | Không | Không | Không | Không mặc định | Theo grant | Không | Theo grant riêng | Không tự động |
| Phân bổ nhân sự | Không | Không | Không mặc định | Theo grant | Global | Không | Không | Không tự động |
| Đặt manager slot | Không | Không | Không | Không mặc định | Theo grant | Không | Không | Không tự động |
| Duyệt công/phép | Own submit/view | Direct reports/assigned | Subtree nếu được cấp | Theo grant | Global | Theo kỳ payroll nếu được cấp | Không mặc định | Không tự động |

“Không tự động” không có nghĩa là cấm tuyệt đối; actor chỉ được làm khi có grant nghiệp vụ riêng và audit. “Không” trong template nghĩa là persona đó không nên được cấp action trong luồng thông thường.

### 10.2 Permission action đích

| Module | Permission | Mục đích |
| --- | --- | --- |
| Organization | `hrm.organization.view` | Xem sơ đồ/projection tổ chức. |
| Organization | `hrm.organization.manage` | Tạo/sửa/lưu trữ đơn vị theo scope. |
| Staffing | `hrm.staffing.view` | Xem định biên và tình trạng bố trí. |
| Staffing | `hrm.staffing.propose` | Đề xuất thay đổi định biên. |
| Staffing | `hrm.staffing.approve` | Duyệt thay đổi định biên. |
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

Ba permission legacy `hrm.employee.view/create/edit` được adapter tạm sang `directory/profile` phù hợp. Không adapter `hrm.master_data.manage` thành quyền organization/staffing hoặc sensitive data.

### 10.3 Scope đích

| Scope | Ý nghĩa HRM |
| --- | --- |
| `own` | Employee liên kết với actor hiện tại. |
| `direct_reports` | Nhân sự báo cáo trực tiếp qua slot relationship đang hiệu lực. |
| `org_unit` | Một đơn vị cụ thể, không tự bao gồm đơn vị con. |
| `org_subtree` | Một đơn vị và toàn bộ cây con tại thời điểm kiểm tra. |
| `assigned` | Subject/workflow đang được giao trực tiếp cho actor. |
| `global` | Toàn công ty; chỉ cấp có chủ đích và audit. |

`department` được giữ làm adapter tương thích, map một-một sang `org_unit`; code mới không tiếp tục mở rộng ý nghĩa của `department`.

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

Admin override, nếu có, là RPC riêng, bắt buộc lý do; không được là `OR is_admin()` rải trong policy C3/C4.

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
→ người có quyền xác nhận
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
canProposeStaffing
canApproveStaffing
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

### 14.3 Màn hình cấp quyền

- Chọn persona/template rồi preview grant cụ thể.
- Với `org_unit`/`org_subtree`, bắt buộc chọn đơn vị.
- Hiển thị thời gian hiệu lực, người cấp, lý do và mức dữ liệu C0–C4.
- Cảnh báo khi cấp `global`, export, sensitive hoặc payroll.
- Không gắn permission tự động theo level E1–E11.

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
- Thêm test snapshot policy/grant Cloud.
- Không đổi dữ liệu nghiệp vụ.

### Phase 1 — Chặn ghi rộng

- Revoke `anon` và broad write ở 6 nhóm table hiện có.
- Thay mutation leave/document/shift bằng policy/RPC kiểm action.
- Giữ feature flag và smoke test theo persona.

### Phase 2 — Projection và đọc nhạy cảm

- Tạo directory/org projection an toàn.
- Harden contract, attendance, leave, document và storage reads.
- Tách C2–C4 khỏi endpoint employee chung.

### Phase 3 — Scope tổ chức và làm sạch dữ liệu

- Thêm `direct_reports`, `org_unit`, `org_subtree` vào permission model.
- Hoàn thiện primary assignment và manager slot.
- Chỉ bật manager-scoped mutations cho đơn vị đạt readiness; nơi chưa đạt tiếp tục deny và hiển thị remediation.
- Theo dõi rồi loại fallback `users.manager_id`.

### Phase 4 — Workflow định biên và capability UI

- Thêm staffing change request và approve/apply RPC.
- Tách các capability của `SettingsHrmSharedCatalog`.
- Ngừng direct staffing adjustment từ client.

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
- Org manager truy cập đúng subtree khi có grant; bị deny với unit ngoài scope.
- HR specialist không đọc payroll nếu thiếu action C4.
- Payroll không sửa organization nếu thiếu staffing action.
- System admin không tự động đọc C3/C4.
- Grant hết hạn bị deny.
- Quyền đúng action nhưng sai scope bị deny.
- Direct REST table call và RPC bypass bị chặn.

### 18.2 Tổ chức/định biên

- Không tạo primary assignment hoặc occupant trùng hiệu lực.
- Không tạo reporting/org cycle.
- Không giảm headcount dưới occupied count.
- Người đề xuất không tự duyệt request.
- Approve/apply tạo đúng slot trong một transaction và audit đầy đủ.
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
- Quản lý đề xuất được định biên đúng scope nhưng không tự duyệt/gán người nếu thiếu action.
- Employee, manager, HR, payroll, executive và system admin nhận đúng projection theo ma trận.
- Import workbook có staging, dry-run, lỗi theo cell, audit và dữ liệu mẫu giả danh.

### 19.3 Nghiệm thu bảo mật

- Không còn 8 broad write policy HRM hiện tại.
- Không còn `anon SELECT` trên bảng HRM C1–C4.
- Không còn broad read C2–C4 cho public/authenticated.
- C0 read rộng chỉ tồn tại trong allowlist có owner và review date.
- Permission Health không còn Critical/High trong lát cắt đã cutover.
- Không có raw sensitive payload bị tải về client khi UI không hiển thị.

## 20. Phản biện và quyết định cần giữ vững

1. **Không sao chép nguyên Excel vào database.** Workbook tối ưu cho nhập/đọc theo hàng; database phải tối ưu cho lịch sử, toàn vẹn và phân quyền.
2. **Không coi cấp bậc là quyền.** E-level là dữ liệu nghề nghiệp; gắn thẳng với quyền sẽ khiến luân chuyển/chức danh làm thay đổi truy cập ngoài ý muốn.
3. **Không cho quản lý xem toàn bộ hồ sơ cấp dưới.** Nhu cầu quản lý công việc không đồng nghĩa với nhu cầu xem định danh, ngân hàng hoặc lương.
4. **Không cho system admin mặc định xem lương/CCCD.** Quản trị kỹ thuật và nghiệp vụ HR/payroll là hai trách nhiệm khác nhau.
5. **Không để một cờ quản trị cho toàn HRM.** Tạo đơn vị, đề xuất định biên, duyệt định biên, gán người, xem lương và sửa danh mục có mức rủi ro khác nhau.
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

## 23. Quyết định cần người dùng duyệt

Bản đặc tả đề nghị duyệt ba quyết định sản phẩm sau trước khi viết implementation plan:

1. Chọn mô hình 8 tab tại mục 8.1 thay cho 6 sheet nguồn.
2. Chọn separation of duties: quản lý đơn vị chỉ đề xuất định biên; HR duyệt và quyền assign/set-manager được cấp riêng.
3. Chọn nguyên tắc bảo mật: quản lý không mặc định xem lương/pháp lý của cấp dưới và system admin không mặc định xem C3/C4.

Sau khi ba quyết định được duyệt, bước tiếp theo là viết implementation plan theo phase 0–6; chưa triển khai migration trước mốc duyệt này.
