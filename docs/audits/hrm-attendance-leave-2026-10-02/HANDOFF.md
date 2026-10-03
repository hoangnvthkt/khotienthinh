# HANDOFF — Module Nhân sự (HRM): chấm công, nghỉ phép, hồ sơ, bảng công

> Viết ngày 02/10/2026, cuối phiên rà soát và triển khai G0 → G4. Đọc hết file này trước khi làm bất cứ việc gì về HRM.
> Báo cáo gốc nằm cùng thư mục: `README.md`. Mục 11 ghi các quyết định đã chốt, mục 12 về chống chấm công hộ, mục 13 về yêu cầu bảng công.

---

## 0. Tóm tắt 30 giây

- Toàn bộ lộ trình HRM **G0 → G4 đã lên production** ngày 02/10/2026, gồm 9 PR (#55, #58, #59, #62, #63, #64, #65, #67, #69). Không còn PR HRM nào mở.
- Hệ thống đã chạy thật:
  - Chấm công một nút, có GPS và ảnh, xác thực bằng vân tay/Face ID.
  - Nghỉ phép tự tìm người duyệt; phép tồn được tính và có sổ phép.
  - Bảng công tính theo ca, làm tròn khối 30 phút.
  - Hồ sơ nhân viên tự xem; nhân viên gửi đề nghị cập nhật hồ sơ.
  - Nhắc hết hạn giấy tờ; một nguồn "quản lý trực tiếp" dùng chung.
- Còn lại ba nhóm việc (chi tiết ở mục 8):
  - **Dữ liệu HR phải nhập**, không cần code.
  - **1 câu hỏi chờ chủ sản phẩm:** ân hạn 15 phút.
  - **Các hạng mục mới, chọn làm tiếp:** H1 lịch làm việc, H2 điều động công trường (đề xuất làm trước), H3 vòng đời nhân sự, H4 nối bảng công sang tính lương.
- **Việc đầu tiên của phiên mới:** hỏi chủ sản phẩm chọn hạng mục nào, và chốt câu ân hạn 15 phút (mục 9).

---

## 1. Chủ sản phẩm và cách làm việc

- Chủ sản phẩm (anh Hoàng, `hoangnvthkt`) viết tiếng Việt và xưng "anh". Trả lời bằng tiếng Việt, xưng "em", ngắn gọn, không dùng thuật ngữ khi không cần.
- Họ muốn Claude đóng vai **Giám đốc Nhân sự**: tra luật Việt Nam, đề xuất, và hỏi quyết định khi có rẽ nhánh. Sau khi họ chốt thì làm luôn, không hỏi lại.
- **Quy tắc bắt buộc của repo** (`AGENTS.md`, luôn có trong ngữ cảnh):
  - Chỉ dùng Supabase Cloud qua `.env`. Không dùng Supabase local, không dùng Docker.
  - **Không dùng sub-agent.** Không dùng các skill Superpowers cho việc đơn giản.
  - Phần UI phải nghĩ như Product Designer: đi thử như người dùng lần đầu trên desktop, tablet và điện thoại. Không che lỗi hay giá trị chưa biết bằng `0`. Trạng thái loading, rỗng, lỗi, không có quyền, đang chờ phải hiện đúng.
- **Mỗi giai đoạn làm trên một nhánh và một worktree riêng**, mỗi giai đoạn một PR.
- **Xem thử giao diện luôn ở nền sáng.** Chủ sản phẩm từng chê ảnh xem thử bị nền đen. Dùng `resize_window` với `colorScheme: 'light'`.
- **Deploy:**
  - Auto-mode classifier hay chặn `db push`, `gh pr merge` và force push. Vì vậy **chủ sản phẩm tự chạy lệnh** trong terminal; Claude đưa sẵn lệnh, mỗi lệnh một khối `bash`.
  - Deploy edge function thì Claude được tự chạy.
  - Sau khi họ chạy, đọc lại terminal bằng `read_terminal` rồi kiểm tra trên Cloud.
- **Commit** kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Body PR** kết thúc bằng `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Merge** bằng squash. `gh` nằm ở `/opt/homebrew/bin/gh`.

## 2. Quy trình kỹ thuật (đã kiểm chứng qua 9 PR)

1. **Tạo worktree** từ `origin/main`:
   ```bash
   git fetch -q origin && git worktree add -q -b <nhánh> .worktrees/<tên> origin/main
   cd .worktrees/<tên> && ln -s ../../node_modules node_modules && cp ../../.env .env
   ```
2. **Đặt số migration:**
   - Chạy `npx supabase migration list --linked` để xem mốc mới nhất **trên Cloud**, rồi đặt số lớn hơn mốc đó.
   - Các phiên khác (Tài chính, Mua hàng) cũng đẩy migration song song. Mốc cuối cùng ngày 02/10 là `20261007120000`.
3. **Chạy thử trên Cloud trong giao dịch hoàn tác:**
   - Ghép `begin;` + migration + nội dung smoke test (bỏ `begin`/`rollback` của file test) + `rollback;` vào một file trong scratchpad.
   - Chạy:
     ```bash
     npx supabase db query --linked --agent=no --file <file>
     ```
   - Sau khi chạy, **khôi phục file CLI** bằng `git checkout -q supabase/.temp/cli-latest`.
   - Chạy kèm các smoke test cũ có liên quan, ví dụ `hrm_g2_leave_policy_smoke.sql` và `hrm_g4_timesheet_smoke.sql`.
4. **Bẫy khi giả lập người dùng trong smoke test:**
   - Giả lập bằng `set_config('request.jwt.claims', …)` cộng `set local role authenticated`.
   - Trong vai `authenticated`, **đọc thẳng bảng sẽ bị từ chối**, kể cả bảng `employees`. Hãy đọc trước khi chuyển vai rồi lưu vào `set_config('test.x', …)`, hoặc `reset role` trước khi đọc.
   - Ghi chép tạo trong cùng một giao dịch thì có cùng `now()`. Cần thứ tự thì dùng `clock_timestamp()`.
5. **Thêm migration vào allowlist:**
   - Mỗi migration mới phải thêm vào `supabase/baseline/current.json`, mảng `allowedPostBaselineFiles`, đúng thứ tự.
   - Xung đột ở file này thì **giải bằng parse JSON**: lấy bản của main, nối thêm file của mình vào cuối. Không sửa tay.
6. **Kiểm tra trước khi push**, luôn có `set -o pipefail`; `| tail` từng che lỗi và làm hỏng main:
   ```bash
   set -o pipefail; npm run -s check:supabase-migrations && npm run -s check:supabase-queries && npm run -s lint && npm test && npm run -s build
   ```
   Truy vấn Supabase phía client phải có `.limit()`, không thì `check:supabase-queries` báo lỗi.
7. **Mở PR** bằng `gh pr create --body-file -`, sau đó gọi `mcp__ccd_pr__get_status`. Nếu PR báo `CONFLICTING` thì rebase lên `origin/main`, giải allowlist rồi `push --force-with-lease`.
8. **Chủ sản phẩm deploy:**
   ```bash
   cd /Users/admin/khotienthinh/.worktrees/<tên> && npx supabase db push --linked && /opt/homebrew/bin/gh pr merge <N> --squash
   ```
   - Nếu báo **"Remote migration versions not found in local migrations directory"**: phiên khác vừa đẩy migration lên Cloud. Rebase nhánh lên main rồi nhờ chạy lại.
   - **Tuyệt đối không** bảo họ chạy lệnh `migration repair --status reverted` mà CLI gợi ý.
9. **Xem thử giao diện:**
   - Tạo `preview-<x>.html` ở gốc worktree. Chép khối `<script src=tailwind CDN>`, `tailwind.config` và khối `<style>` chứa biến màu (`--card`, `--border`…) từ `index.html`. Thiếu biến màu thì ngăn kéo sẽ bị trong suốt.
   - Viết `scripts/preview/<X>Harness.tsx`: gán lại method của service bằng dữ liệu mẫu (`Object.assign(service, {...})`).
   - Component nào dùng `useApp()` thì alias `context/AppContext` sang một stub trong vite config riêng.
   - Thêm một mục vào `/Users/admin/khotienthinh/.claude/launch.json`, chạy `preview_start`, rồi xem ở các khổ desktop 1280, 1100 và mobile.
   - **Xem xong phải xóa** harness và mục trong launch.json.

## 3. Những gì đã giao (production)

| PR | Giai đoạn | Migration | Nội dung chính |
|---|---|---|---|
| #55 | G0 | `20261005100000`, `20261005110000` | Chấm công v2: giờ và khoảng cách tính ở server, chặn khi ngoài phạm vi, chặn GPS sai số > 100 m, lượt đầu là vào và các lượt sau là ra; ảnh lưu 60 ngày (cron và edge function `hrm-checkin-photo-retention`); sửa trigger phép; `totalDays` cho phép nửa ngày; thu hồi quyền xem phép toàn công ty của 44 tài khoản không phải HR; AI tool HR phải có `view_sensitive` |
| #58 | G1 | `20261005120000` | Chống chấm công hộ: passkey WebAuthn (edge function `hrm-attendance-passkey`), mỗi người một điện thoại (máy mới phải chờ HR duyệt), cờ nghi vấn (`shared_device`, `same_gps_fix`, `no_passkey`), miễn passkey có hạn; tab HR "Thiết bị & nghi vấn" |
| #59 | G2 | `20261005130000` | Danh mục loại nghỉ và cài đặt; chuỗi duyệt tự động: nhân viên công trường do người duyệt của công trường duyệt; nhân viên khác theo sơ đồ tổ chức, rồi `users.manager_id`, rồi HR; đơn trên 3 ngày làm việc thêm bước TGĐ Dương Xuân Thịnh; RPC preview/submit/decide/cancel; bỏ ghi thẳng vào bảng |
| #62 | G3a | `20261006100000` | Nhân viên tự xem HĐLĐ, BHXH, giấy tờ của mình; form hồ sơ chọn từ danh sách thay vì gõ mã; bảng "Hồ sơ còn thiếu" cho HR |
| #63 | G4 | `20261006160000` | Bảng công `hrm_month_timesheet`: theo ca, làm tròn khối 30 phút, giải trình đi muộn/về sớm duyệt 2 bước (trưởng bộ phận rồi HR), phút làm thêm chuyển thành loại đơn `overtime` (trần 40 giờ/tháng); tab "Tổng hợp công" và xuất Excel 2 sheet |
| #64 | G3b | `20261007100000` | Đề nghị cập nhật hồ sơ (bảng `hrm_profile_change_requests`, bucket `hrm-profile-evidence`; tài khoản ngân hàng và thuế cần HR Manage duyệt); địa chỉ 2 cấp (`ward_name`, 34 tỉnh/thành); nhắc hết hạn (cron `hrm-hr-reminders` lúc 07:30); `list_hrm_direct_managers` và `set_hrm_designated_manager`; `resolve_slot_direct_manager` thêm nhánh: người có đơn vị nhưng chưa có vị trí thì do trưởng đơn vị duyệt (không leo lên cấp trên); khung "Việc hồ sơ cần xử lý" |
| #65 | Dọn vị trí | `20261007110000` | Danh mục vị trí 121 → 99: xóa 13 vị trí tên số và mục `G3-BOQ`, gộp 6 cặp trùng tên, "Chỉ huy trưởng/phó" bỏ hậu tố tên dự án |
| #67 | G2b | `20261007120000` | Phép tồn: cột `carriedDays`, `carryExpiresOn` (31/03), `carryUsedDays`, `carryExpiredDays`; phép tồn dùng trước nếu đơn **bắt đầu** đến hết 31/03; sổ phép `hrm_leave_ledger` do trigger ghi; `adjust_hrm_leave_balance` bắt buộc lý do; tab "Số phép" cho HR |
| #69 | Sửa lỗi | (không) | Nhận diện trình duyệt nhúng (Zalo, Facebook, TikTok…) và hiện nút "Mở bằng Chrome"; form nhân viên không còn tự tạo hay sửa số phép |
| (03/10) | Thiết lập nghỉ phép | `20261008140000` | Tab Nghỉ phép → **Thiết lập**: ngưỡng thêm bước TGĐ riêng từng loại (`second_step_after_days`), lý do con + số ngày tối đa (`subtypes`, vượt thì chặn), bắt buộc đính kèm (`requires_attachment`, bucket `hrm-leave-evidence`, cột `attachment_paths`), HR Manage/Admin thêm loại mới (mã `custom_*`, chỉ tắt không xóa); ghi qua RPC `save_hrm_leave_type`, `set_hrm_leave_type_active`, `save_hrm_leave_settings`, lịch sử `hrm_leave_policy_log`; khóa hưởng lương của annual/late_early/overtime/business_trip và lý do của late_early |
| (03/10) | H2 Điều động công trường | `20261008150000` | `/hrm/assignments`: phiếu điều động Chính / Kiêm nhiệm / Tạm thời (`hrm_site_assignments`, sự kiện `hrm_site_assignment_events`); lập: HR, chỉ huy trưởng / người duyệt công trường, quản lý trực tiếp; duyệt: HR Manage / Admin; lùi ngày tối đa 7; duyệt xong tự đóng nơi chính cũ, thêm vào Tổ chức dự án với quyền Xem; `employees.construction_site_id` đồng bộ theo nơi chính (cron `hrm-site-assignment-daily-sync` 00:10); chấm công ưu tiên công trường được điều động; HR rà soát hiện trạng (`hrm_site_assignment_reviews`) trước khi dùng |

**File và đối tượng chính** (tra cứu khi cần sửa):
- **Chấm công:**
  - `pages/hrm/CheckIn.tsx`, `lib/checkInService.ts`, `lib/attendanceGeo.ts`, `lib/attendancePasskey.ts`.
  - Màn HR: `pages/hrm/Attendance.tsx`, `pages/hrm/AttendanceDevicesPanel.tsx`, `pages/hrm/AttendanceSummaryPanel.tsx`.
  - Cài đặt địa điểm: `pages/settings/SettingsAttendanceLocations.tsx`.
  - RPC `employee_attendance_punch_v2`, `get_my_checkin_context`; bảng `hrm_attendance_*`.
- **Nghỉ phép:**
  - `pages/hrm/LeaveManagement.tsx`, `lib/leaveService.ts`, `components/hrm/LeaveLedgerDrawer.tsx`, `components/hrm/LeaveBalancesPanel.tsx`, `lib/leaveBalance.ts`.
  - Hàm DB: `app_private.hrm_leave_approval_chain`, `hrm_leave_annual_available`, `hrm_leave_year_maintenance`, `accrue_monthly_leave` (cron `hrm-monthly-leave-accrual` chạy 00:05 giờ Việt Nam).
- **Bảng công:**
  - `lib/timesheetService.ts`.
  - Hàm DB: `app_private.hrm_month_timesheet`, `public.get_hrm_timesheet`.
- **Hồ sơ:**
  - `pages/ep/HrmPersonnelProfile.tsx`, `lib/hrmProfileFields.ts` (form và danh mục chọn dùng chung), `lib/hrmProfileChangeService.ts`.
  - Component: `components/hrm/HrmWorkQueuePanel.tsx`, `ProfileChangeRequestDialog.tsx`, `MyProfileChangesCard.tsx`, `HrmProfileCompletenessPanel.tsx`.
- **Smoke test:** `supabase/tests/hrm_g0_*`, `hrm_g1_*`, `hrm_g2_*`, `hrm_g2b_*`, `hrm_g3b_*`, `hrm_g4_*`, `hrm_position_catalog_cleanup_smoke.sql`.

## 4. Quyết định đã chốt (đừng hỏi lại)

1. Ngoài phạm vi thì chặn hẳn. Muốn ghi công thì gửi đề xuất chấm công bù; đề xuất do người duyệt của địa điểm đó duyệt.
2. Bán kính: công trường 300 m, văn phòng và nhà máy 150 m. Tọa độ lấy từ Google Maps, nhập ở Cài đặt → Địa điểm chấm công.
3. Màn chấm công chỉ có một nút "Chấm công".
4. Phép năm:
   - Mỗi mùng 1 cộng 1 ngày. Người đang thử việc không được cộng.
   - Phép tồn dùng đến hết quý I.
   - HR và HR Manage được sửa trực tiếp số phép còn lại, kèm lý do.
5. Ngưỡng của đơn nghỉ tính theo ngày làm việc. Thứ 7 là ngày làm việc.
6. Mỗi địa điểm chấm công có một người duyệt do Admin chọn (`managerId`). Người này duyệt chấm công bù và đơn nghỉ của nhân viên công trường.
7. Đi muộn/về sớm:
   - Mỗi lần tối đa 60 phút.
   - Có giải trình và được duyệt (trưởng bộ phận, rồi HR hoặc HR Manage) thì tính đủ công.
   - Không có giải trình thì làm tròn khối 30 phút và cộng dồn trong tháng.
8. Ảnh chấm công giữ 60 ngày, có nén.
9. Nhân sự chủ chốt:
   - HR: Trần Thị Tươi (TT020). HR Manage: Nguyễn Thị Giang (TT052).
   - Các tài khoản đang giữ quyền HR khác giữ nguyên, không thu hồi: Đặng Thị Hương, Hà Thị Hải Hồng, Hoàng Công Minh.
   - Nhân viên được tự xem HĐLĐ và BHXH của mình.
10. Chưa chấm công cho công nhân tổ đội.
11. Bước duyệt thứ 2 cho đơn nghỉ trên 3 ngày là TGĐ Dương Xuân Thịnh. Admin đổi được người này ở tab Chính sách.
12. Duyệt phép của nhân sự văn phòng: quản lý trên sơ đồ tổ chức.
13. Chống chấm công hộ làm đủ 3 lớp: passkey, mỗi người một thiết bị, cờ nghi vấn.
14. (03/10) Thiết lập nghỉ phép: ngưỡng TGĐ riêng từng loại; lý do con + số ngày tối đa; bắt buộc đính kèm (Ốm đau/Thai sản chưa bật sẵn, HR tự bật); HR Manage + Admin sửa, HR khác chỉ xem; không làm "báo trước tối thiểu".
15. Dọn danh mục vị trí:
    - Đã duyệt mục 1–3.
    - "Cố vấn" là vị trí mặc định do chủ sản phẩm đặt; họ sẽ tự sửa sau.
    - Còn giữ 6 vị trí tên số vì đang gắn với 31 bản ghi đãi ngộ. Khi HR gán lại vị trí thì xóa nốt.

## 5. Dữ liệu thực tế cần biết (02/10/2026)

- 79 nhân sự đang làm việc. Khoảng 47 người/ngày chấm công.
- 20 điện thoại đã đăng ký passkey (ACTIVE).
- **Trình duyệt nhúng của Zalo không có WebAuthn**, nên người mở Vioo từ Zalo không chấm công được. Đã có nút "Mở bằng Chrome", anh Tới đã thử và chạy được. Ba người hay gặp: TT193 Nguyễn Trọng Tới, TT204 Vũ Duy Tùng, TT181 Bùi Đình Thứ.
- **Số phép:** mới có 3 người có số phép năm 2026. HR cần nhập ở tab Số phép.
- **Sơ đồ tổ chức:**
  - 24 đơn vị; mới 2 vị trí trưởng đơn vị có người ngồi.
  - 15/79 nhân sự được gán vị trí chính trên sơ đồ.
  - 33 tài khoản đã có quản lý trực tiếp, phần lớn lấy từ `users.manager_id`.
- **Hồ sơ:** chưa có dòng HĐLĐ, CCCD, chứng chỉ hay địa chỉ nào, nên phần nhắc hết hạn chưa có gì để nhắc.
- **Dự án SMB:**
  - Dự án đã ở trạng thái `completed` nhưng 28 người vẫn được gán vào đó.
  - Lịch sử chấm công SMB từng lệch tọa độ khoảng 33 km. G0 đã sửa cách tính; tọa độ thật do HR nhập ở Cài đặt → Địa điểm chấm công.
- **Kiểm tra hệ thống:** HRM Dashboard và Báo cáo đọc trực tiếp bảng `hrm_leave_balances`. Đã chuyển sang dùng `leaveBalanceAvailable` để tính cả phép tồn.

## 6. UI/UX — học theo module Mua hàng

Chủ sản phẩm **rất thích phong cách của module Mua hàng**. HRM từ đây làm theo cùng kiểu đó. **Đọc code trước khi vẽ màn mới:**
- `components/procurement/hub/ProcurementHubView.tsx`: mẫu tốt nhất cho màn tổng.
- `components/procurement/hub/hubUi.tsx`: bộ component dùng chung `Badge`, `StateBox`, `Drawer`, `inputCls`, `primaryBtn`, `secondaryBtn`, `money`. **Dùng lại, đừng tự chế.**
- `components/procurement/hub/OrdersView.tsx` và `OrderDrawer.tsx`; `components/procurement/receipt/ReceiptReconciliationView.tsx`; `components/wms/WmsWorkspace.tsx` và `StockCountView.tsx`.
- `components/project/work-plan/workPlanUi.tsx` (`fmt`, `dateVi`, `useGroupAccordion`).
- Chi tiết quy ước nằm ở `docs/designs/project-closed-loop-2026-09-30/HANDOFF-K3.md`, mục 7.

Các nguyên tắc rút ra:
- **Dải các bước (StageStrip):** thẻ đánh số 1, 2, 3… cho từng bước của quy trình. Mỗi thẻ vừa là tab vừa là ô chỉ số: số lớn có `tabular-nums`, dòng gợi ý nói việc cần làm (ví dụ "3 chờ bạn duyệt"). Thẻ đang chọn có `border-teal-500 ring-2 ring-teal-500/20`.
- **Màu theo ý nghĩa** (theme xanh FastCons: mint `#3cbfaa`, leaf `#52b53a`, teal):
  - Dữ liệu có id (tên người, mã phiếu, dự án): `font-semibold text-mint-700 dark:text-mint-300`.
  - Số liệu: `font-semibold tabular-nums text-leaf-700 dark:text-leaf-300`.
  - Cam/amber cho thiếu hoặc lệch. Đỏ/rose cho quá hạn và từ chối, kèm class `overdue-blink` (nhấp nháy nhẹ, tôn trọng reduced-motion).
  - Không làm giao diện một màu.
- **Badge** dạng viên thuốc có viền nhẹ, mỗi loại trạng thái một màu (xem `PO_STATUS_STYLE`).
- **Bố cục:**
  - Thẻ tiêu đề có icon nền gradient teal → mint/leaf, mô tả ngắn, và phần "Cách làm" thu gọn được.
  - Thanh công cụ: ô tìm kiếm đa năng (nhiều từ, khớp đủ mọi từ), các bộ lọc, sắp xếp, nút tải lại.
  - Danh sách bên trái rộng 360–400px, chi tiết bên phải. Mỗi dòng có dải `border-l-4` theo bước, nhãn bằng lời người dùng, số tiền hoặc số lượng căn phải.
  - Ngăn kéo chi tiết dùng `Drawer` (đóng bằng Escape, toàn màn hình trên điện thoại). Nút hành động ghim ở đáy; phần phụ như lịch sử thì thu gọn.
- **Trạng thái:** luôn dùng `StateBox` cho loading, lỗi, không có quyền, rỗng, kèm nút "Thử lại".
- **Hộp thoại:**
  - `useConfirm()` mặc định dùng mẫu xóa (đếm ngược 3 giây). Luôn truyền `confirmText`; thao tác không phá hủy thì truyền `intent: 'success'` và `countdownSeconds: 0`, có `warningText` nói cách hoàn tác.
  - Từ chối và hủy dùng `useReasonConfirm()` (bắt buộc lý do).
- **Toast:** `toast.success(tiêu đề, mô tả)`. Mô tả nêu tên chứng từ, đã làm gì, và bước tiếp theo.
- **Điện thoại:**
  - Hiện danh sách trước. Chạm vào thì mở chi tiết, có nút "← Danh sách".
  - Khi đang xem chi tiết thì ẩn ô chỉ số và thanh công cụ.
  - Bảng có ô nhập thì chuyển sang dạng thẻ. Không để trang cuộn ngang.
- **Phân quyền:** server trả cờ `can.*`. UI ẩn hoặc khóa nút theo cờ đó và giải thích vì sao chưa làm được.
- **Với màn lớn:** đưa **mockup dùng dữ liệu thật** cho chủ sản phẩm duyệt trước, rồi mới làm thật.
- **Trạng thái HRM hiện tại:**
  - Các màn mới (Việc hồ sơ cần xử lý, Số phép, Tổng hợp công) đã theo mint/leaf nhưng **chưa dùng `hubUi`**.
  - Màn hồ sơ `HrmPersonnelProfile` vẫn dùng sky-700 (kiểu cũ).
  - Khi chạm tới màn nào thì đưa dần về kiểu Mua hàng, trong phạm vi an toàn.

## 7. Bẫy và kinh nghiệm

- `finiteOrNull(null)` trả về `0` từng làm khoảng cách bị tính thành 11.692 km. Tọa độ rỗng phải giữ là `null`.
- Viết heredoc mà không quote thì shell nuốt mất `$function$`. Dùng `<<'EOF'` hoặc viết file bằng Python.
- Xóa file trên Storage phải qua Storage API, vì trigger `protect_delete` chặn lệnh xóa từ SQL.
- Bảng `notifications` có ràng buộc: `delivery_reason` chỉ nhận `assigned`, `mentioned`, `watching`, `responsible`, `system`.
- Có 4 hàm tìm quản lý trực tiếp:
  - `resolve_active_direct_manager` (sơ đồ tổ chức, rồi `users.manager_id`) là hàm dùng chung cho Yêu cầu và danh sách HR.
  - Chuỗi duyệt phép đi theo thứ tự: người duyệt công trường, rồi sơ đồ, rồi `manager_id`, rồi HR.
  - `resolve_strict_direct_manager` gắn với cài đặt `hrm_manager_scope_settings` (đang tắt).
- Smoke test cũ `g3_boq_material_planning_smoke.sql` từng rò dữ liệu thử lên production (đã dọn). Nếu thấy dữ liệu tên "G3 …" thì đó là dữ liệu thử.
- Check CI "Supabase Preview" hay đỏ hoặc bị skip; bỏ qua được. Check chính là "Typecheck, test and build".

## 8. Việc còn lại

**A. Việc HR cần làm (không cần code; nhắc chủ sản phẩm):**
- Nhập số phép còn lại cho từng người ở Nghỉ phép → Số phép (lọc "Chưa có số phép").
- Điền trưởng đơn vị trên sơ đồ tổ chức (Cài đặt → Danh mục HRM dùng chung), hoặc chỉ định ở khung "Chưa có quản lý trực tiếp".
- Kiểm tra tọa độ và người duyệt của từng địa điểm chấm công.
- Sửa vị trí "Cố vấn" của từng người và gán lại vị trí trong bản ghi đãi ngộ. Xong thì xóa 6 vị trí tên số bằng một migration nhỏ.
- Thông báo cho nhân viên: mở Vioo bằng Chrome/Safari, không mở từ Zalo; đăng ký vân tay/Face ID; xin nghỉ trên app.

**B. Câu hỏi chờ chủ sản phẩm:**
- ~~Ân hạn 15 phút~~ — chủ sản phẩm chốt 03/10: **không ân hạn**, giữ "muộn 1 phút tính 30 phút".

**C. Hạng mục mới (mục 5 và 6.3 của README); chủ sản phẩm chọn:**
- **H2. Điều động nhân sự tới công trường** (Claude đề xuất làm trước):
  - Ghi ai làm ở công trường nào, từ ngày nào đến ngày nào.
  - Dùng làm nguồn tự nhận địa điểm chấm công, xác định người duyệt và phân bổ chi phí nhân công cho dự án.
  - Lý do làm trước: sửa được tình trạng 28 người vẫn gán vào dự án SMB đã xong. Lưu ý `project_staff` còn dùng cho phân quyền Room, nên **không dùng thẳng** làm nơi làm việc.
- **H1. Lịch làm việc theo nhóm:**
  - Mẫu lịch theo tuần: văn phòng T2–T6 cộng sáng T7, công trường T2–T7, nhà máy theo ca.
  - Gán theo đơn vị, công trường hoặc chức danh, có ngày hiệu lực; ghi đè được cho từng người hoặc từng ngày.
  - Lịch ngày lễ theo năm, gồm nghỉ bù và ngày 24/11.
  - Màn "Lịch làm việc của tôi".
  - Bảng công G4 hiện đọc ca theo thứ tự: ca theo ngày → ca mặc định → `work_schedule` → 08:00–17:00.
- **H3. Vòng đời nhân sự:** tiếp nhận, hết thử việc, lên chính thức, nghỉ việc (thu hồi tài khoản và thiết bị, thanh toán phép tồn, chốt BHXH), theo kiểu danh sách việc cần làm.
- **H4. Chốt công và nối sang tính lương:** khóa công theo tháng sau khi HR duyệt, rồi đưa thẳng vào bảng lương thay vì qua Excel. Lưu ý Bộ luật Lao động điều 127 cấm phạt tiền; đi muộn chỉ trừ công.

**D. Dọn dẹp:** các worktree `.worktrees/hrm-g0`, `hrm-g1`, `hrm-g2`, `hrm-g3`, `hrm-g4`, `hrm-g3b`, `hrm-positions`, `hrm-g2b`, `hrm-fix1` đều đã merge. Xóa được bằng `git worktree remove` hoặc tool `clean_up_worktrees`.

## 9. Việc đầu tiên khi mở phiên mới

1. Đọc file này và `README.md` cùng thư mục.
2. Chạy `git fetch origin && git log --oneline -5 origin/main` và `npx supabase migration list --linked | tail -5` để biết các phiên khác đã đẩy gì lên.
3. Hỏi chủ sản phẩm hai câu, trong một tin nhắn:
   - Chọn hạng mục nào trong H1–H4 (đề xuất H2).
   - Có áp dụng ân hạn 15 phút không.
4. Khi đã chọn:
   - Khảo sát dữ liệu thật trên Cloud.
   - Viết thiết kế ngắn: bảng tình huống gồm cả luồng ngược (hủy, sửa, lùi ngày) và bảng phân quyền.
   - Làm **mockup theo kiểu Mua hàng** bằng dữ liệu thật, gửi duyệt.
   - Code, chạy thử rollback trên Cloud, xem thử ở nền sáng, mở PR, đưa lệnh deploy.
