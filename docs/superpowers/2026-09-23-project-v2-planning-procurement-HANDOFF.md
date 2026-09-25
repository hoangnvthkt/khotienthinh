# Handoff — Project V2 planning → material planning → Procurement V2

> Ngày lập: 2026-09-23
>
> Repository: `/Users/admin/khotienthinh`
>
> Branch đang dùng: `feature/refactor-du-an-t9-1`
>
> Trạng thái cập nhật 2026-09-24: **Task 1–12 đã implement và commit; Task 13 đang kiểm chứng tích hợp.** Không kích hoạt pilot hoặc coi automation là business signoff. Xem [evidence](../designs/erp-completion-2026-09-19/evidence/project-v2-validation-20260923.md) và [runbook](../runbooks/project-v2-pilot-rollout.md). Các mô tả “chưa bắt đầu” bên dưới là baseline lịch sử ngày 23/09, không phải trạng thái hiện tại.

**Business clarification after this handoff:** the owner has refined the project-wide material BOQ, cumulative site receipts, remaining BOQ quantity, month/week construction periods, clean input screens, and the procurement/warehouse/AP boundaries. Read [24 September business clarifications](2026-09-24-project-v2-business-clarifications.md) before changing the pilot or planning UI. The earlier implementation plan remains an execution record; conflicting assumptions must be reconciled against these newer owner decisions.

Task 13 còn mở: replay full chain trên Cloud có dữ liệu vướng migration daily-log `20260923091500` ở Room constraint; baseline allowlist chưa chứa migration V2; `npm run lint` còn 185 lỗi từ prototype untracked. Chuỗi migration V2 và các smoke kế hoạch/intake/dossier/collaboration đã chạy trên Cloud preview rồi xóa branch. Mixed-source PO có bằng chứng Task 11 trên preview riêng, nhưng smoke cùng data clone bị G9 gate chặn synthetic project. Chưa có UAT nghiệp vụ theo persona hay business signoff.

Đợt tiếp theo ngày 24/09 đã nối cân đối BOQ tổng công trình vào màn hình nhập và chi tiết kế hoạch vật tư. Reader tính lũy kế nhập kho công trường từ mọi nguồn, trừ hàng trả NCC; đơn đang đặt/chuyển chưa nhập không trừ vào “Còn lại”. Trạng thái thiếu dữ liệu và ngoài BOQ vẫn tách bạch. Migration reader chỉ được chạy trên Cloud preview có dữ liệu và branch đã xóa; chưa deploy Project V2 lên production. Xem evidence Task 13 và smoke `supabase/tests/project_v2_material_boq_position_smoke.sql`. Pending supply hiện vẫn “Chưa xác định” vì chưa có reader riêng. Full migration parity, actual app-route walkthrough theo persona và business signoff vẫn mở.

Ngày 25/09, giao diện mẫu và shell Project V2 được chỉnh theo phong cách trang “Hôm nay”; mẫu ghi rõ dữ liệu minh họa, không còn nút gửi duyệt giả. Phần này chỉ là UX preview, không thay đổi tình trạng Cloud gate. Một read-only check cùng ngày xác nhận production Cloud vẫn chưa có `project_v2_workspaces` và BOQ reader, nên `/project-v2` chưa dùng cho dữ liệu thật.

Đợt kiểm chứng tiếp theo ngày 25/09 trên Cloud branch có bản sao dữ liệu production đã replay được chuỗi schema V2, daily-log và Procurement theo thứ tự sau khi sửa constraint daily-log giữ action `return` của Project V2. Các smoke rollback-only planning, BOQ, intake/dossier, collaboration và mixed-source PO trong G9 scope đều qua; không còn fixture. Tuy nhiên Management API ghi migration bằng timestamp mới, **chưa có parity theo version file**, shared migration marker còn đỏ, và chưa có UAT trên app route bằng persona thật. Production chưa được deploy V2. Xem evidence Task 13; cần hoàn tất parity, advisor review, named cohort/personas và business UAT trước khi mở V2 với dữ liệu thật.

Cập nhật Task 13 ngày 25/09: pilot được chỉ định chính xác là **DỰ ÁN RICO** (`PRJ-12788C72`), không phải các dự án RiCo tên gần giống. Nguyễn Phương Thảo lập kế hoạch; Dương Xuân Thịnh duyệt kế hoạch; Nguyễn Văn Năm tạo PO; Nguyễn Thị Mơ duyệt PO, phụ trách kho và tài chính. Read-only Cloud audit xác nhận cả bốn tài khoản đang hoạt động, nhưng Thịnh/Năm chưa là nhân sự công trường RICO, Mơ chưa có quyền `material_po.approve`, và chưa có grant Room V2. RICO có 74 work BOQ items, 8 dòng BOQ vật tư thủ công và kho công trường, nhưng **không có định mức vật tư đang hoạt động** để suy ra kế hoạch; 2/8 dòng vật tư tham chiếu item không tồn tại. Không tự tạo định mức, sửa identity hay cấp quyền trong production.

Cloud preview thứ hai có dữ liệu đã replay **đúng version và thứ tự 16 migration file** bằng Supabase CLI; migration history parity và CLI dry run sau đó đều qua. Các smoke rollback-only tiếp tục qua trên chính preview này. Preview và credential tạm đã xóa. Vấn đề timestamp mismatch của preview trước đã được xử lý về mặt kỹ thuật, nhưng shared migration marker vẫn dirty và có file daily-log untracked, nên **chưa có sạch release gate ở repository**. Production vẫn 116 migration, chưa có schema/cohort V2. Bước tiếp theo: xác nhận định mức có nguồn phê duyệt cho ít nhất một công tác/vật tư RICO, xử lý hai item tham chiếu thiếu, chuẩn bị staff/Room grants theo bốn người dùng trên, làm sạch migration release gate và review advisor, rồi mới chạy app-route UAT theo persona; không dùng smoke tự động thay business signoff. Xem [evidence](../designs/erp-completion-2026-09-19/evidence/project-v2-validation-20260923.md).

Chủ dự án chọn hai cặp thử đầu tiên: `Đổ bê tông lót → Bê tông M300` và `Đào móng → Cát trát`, và xác nhận **100 là tổng lượng vật tư**, không phải suất tiêu hao. Giữ Cát trát bằng `m³`; câu trả lời `100 tấn` trước đó đã được làm rõ. Cloud xác nhận hai dòng BOQ vật tư hiện có đều là **100 m³**, liên kết đúng hai công tác trên. Tổng BOQ không tự trở thành định mức cho mỗi đơn vị công tác; chưa ghi norm mapping. Check migration baseline ngày 25/09 còn fail với 14 file post-baseline chưa allowlist.

Sau khi chủ dự án cấp thêm quyền, Cloud read-only check thấy cả bốn người là RICO site staff và Mơ đã có `material_po.approve`. Tuy nhiên Thảo, Thịnh và Năm cũng đang có `material_po.approve`, rộng hơn vai trò pilot được chỉ định; cần rà lại trước UAT persona. Production vẫn 116 migration, chưa có bảng V2, ba Room V2, thành viên Room V2 hay norm mapping RICO. Fixture UI chạy qua 11 test Project V2 + 5 test Procurement V2; 46 focused unit tests qua. Đây chỉ là technical test trên dữ liệu mẫu, chưa thể test giao dịch RICO thật cho đến khi release gate/schema được triển khai. Không ghi dữ liệu production ở đợt kiểm chứng này.

Cập nhật quyền sau khi chủ dự án chỉnh lại: Cloud xác nhận **chỉ Mơ còn `material_po.approve`** trong bốn persona; cả bốn vẫn có `material_po.submit`, nên cần rà quyền gửi PO của Thảo/Thịnh theo vai trò pilot trước UAT. Hai vật tư pilot đều liên kết item kho có thật. Cần chủ dự án cung cấp suất tiêu hao/nguồn định mức được duyệt cho từng cặp công tác–vật tư; hai tổng BOQ 100 m³ không thể tự dùng làm hệ số. Phần kỹ thuật migration, V2 Room grants và test tiếp tục xử lý riêng; không stage file migration daily-log đang untracked hoặc shared baseline marker đang dirty vào commit Project V2.

Chủ dự án xác nhận tiếp **50 m³ Bê tông M300 và 50 m³ Cát trát là tổng lượng của từng kế hoạch pilot**, không phải định mức trên một đơn vị công tác. Giữ tách biệt với tổng BOQ công trình 100 m³ cho mỗi loại. Chủ dự án nói đã bỏ quyền gửi PO của Thảo/Thịnh, nhưng Cloud read-only check ngay sau đó vẫn thấy `material_po.submit` của cả hai đang active; `approve` đã inactive. Cần đối chiếu thao tác trong Room “Đơn hàng PO” (action “Gửi”) với trạng thái DB trước negative persona UAT. Không ghi norm giả hoặc coi quyền đã gỡ khi Cloud chưa xác nhận.

Audit event Room mới nhất xác nhận payload đã lưu vẫn chứa `submit` cho Thảo/Thịnh, nên không phải chậm đồng bộ Cloud. V2 candidate/validation yêu cầu norm resource/revision và hệ số trên một đơn vị công tác; số 50 m³ chỉ là lượng kế hoạch dự kiến, chưa thể duyệt/publish material plan bằng nguồn không có định mức. Chờ người dùng xác nhận suất tiêu hao đúng và thao tác bỏ action “Gửi” trong Room, rồi query lại Cloud. Không chạm workstream daily-log.

Cloud check sau khi chủ dự án lưu Room lần nữa: `material_po.submit` của Thảo/Thịnh đã **inactive**, quyền duyệt cũng inactive; Năm còn gửi, Mơ còn duyệt. Thảo/Thịnh vẫn có `edit` và `delete` trong Room PO; `edit` ánh xạ sang quyền tạo PO draft, nên đã hỏi chủ dự án có cố ý giữ hay muốn giới hạn về chỉ `view`. Chưa tự sửa grant. Chưa có suất tiêu hao trên mỗi đơn vị công tác và schema V2 production vẫn chưa triển khai.

Chủ dự án cho phép giả định số liệu **trên môi trường test** để kiểm chứng các bước và nói sẽ bỏ `Sửa/Xóa` PO của Thảo/Thịnh. Trên Cloud branch có bản sao dữ liệu RICO, CLI đã replay đúng 16 migration với version/name parity. Transaction rollback-only dùng đúng project/site, hai work BOQ, hai material BOQ, item kho và actor Thảo/Thịnh; giả định **5 m³ công tác × 10 m³ vật tư / 1 m³ công tác = 50 m³** cho mỗi cặp. Hai candidate đều selectable, Thảo gửi kế hoạch vật tư, Thịnh duyệt, G2 tạo một demand dossier. Đây chỉ là hệ số giả lập, **không phải định mức được duyệt**. Sau rollback không còn workspace/plan/norm giả; preview và credential tạm đã xóa. Production chưa deploy V2. Cloud check gần nhất vẫn thấy Thảo/Thịnh có `view/edit/delete` PO, chưa thấy `Sửa/Xóa` được gỡ; `submit/approve` đã tắt. Không trộn daily-log vào commit Project V2. Xem evidence Task 13.

## Prompt bắt đầu nhanh cho phiên chat mới

```text
Đọc toàn bộ docs/superpowers/2026-09-23-project-v2-planning-procurement-HANDOFF.md và tiếp tục đúng trạng thái hiện tại.

Luồng nghiệp vụ và kế hoạch triển khai Project V2 → Procurement V2 đã được chốt. Không re-plan, không hỏi duyệt lại các quyết định đã ghi trong handoff. Task 1–12 đã commit trên branch hiện tại; tiếp tục Task 13 của docs/superpowers/plans/2026-09-23-project-v2-planning-procurement-flow.md từ evidence và runbook, trừ khi anh báo một regression cụ thể.

Giữ một branch/một worktree, không sub-agent, không dùng taste skill. Supabase chỉ dùng Cloud qua .env, không local/Docker. Không chạm docs/audits/erp-end-to-end-2026-09-19/README.md và không trộn các thay đổi daily-log/auth/procurement đang dở vào commit Project V2. Không coi automation là business signoff; không đổi unknown thành 0. Cập nhật làm việc bằng tiếng Anh và báo cáo hoàn tất bằng tiếng Việt.
```

## 1. Mục tiêu sản phẩm đã chốt

Xây thêm **Project V2** và **Procurement V2** chạy song song với module hiện tại, dùng cho một cohort dự án mẫu riêng. Không thay thế, không migrate cưỡng bức và không phá luồng `/da` hoặc `/procurement` hiện tại.

Chuỗi công việc đích:

```text
Tiến độ gốc / hợp đồng / BOQ
  → Kế hoạch tháng
  → Kế hoạch thi công tuần/ngày
  → Kế hoạch vật tư
  → Duyệt kế hoạch vật tư
  → Mua hàng tiếp nhận như một nguồn nhu cầu chính thức
  → Chọn phương án cung ứng
      ├─ Cấp từ kho
      ├─ Điều chuyển
      ├─ Hợp đồng/đơn gọi hàng hiện có
      └─ Mua ngoài → PO
```

Song song, công trường vẫn được tạo **Đề xuất vật tư** độc lập. Procurement V2 phải phân biệt rõ hai nguồn:

- `Kế hoạch vật tư`: phát sinh từ kế hoạch thi công đã duyệt.
- `Đề xuất vật tư`: phát sinh chủ động tại công trường.

Kế hoạch vật tư được duyệt đi thẳng sang Mua hàng như canonical demand; **không bắt người dùng tạo lại một MR và không lặp thêm vòng duyệt MR**. Tuy nhiên, kế hoạch vật tư cũng **không tự động tạo PO**. Mua hàng vẫn phải chọn phương án cung ứng; PO chỉ sinh khi thực sự mua ngoài.

## 2. Baseline lịch sử trước khi bắt đầu Task 1

Mục này ghi trạng thái ngày 23/09. Trạng thái thực thi mới nhất nằm ở đầu file, trong SDD ledger và evidence Task 13.

### Đã xong

- Phân tích các màn hình hiện tại và xác nhận UI Workbench hiện tại không phù hợp cho người dùng nghiệp vụ.
- Chốt chuỗi nghiệp vụ từ tiến độ gốc → kế hoạch thi công → kế hoạch vật tư → mua hàng/PO.
- Chốt việc Project V2 và Procurement V2 tồn tại song song với module hiện tại.
- Đánh giá prototype Astra và xác định phần được tái sử dụng về tư duy UX, phần không được sao chép về kỹ thuật.
- Lập kế hoạch triển khai chi tiết 13 task tại:
  - [2026-09-23-project-v2-planning-procurement-flow.md](plans/2026-09-23-project-v2-planning-procurement-flow.md)
- G1–G9 của ERP completion đã triển khai; production pilot DA29 vẫn là luồng riêng, không được mở lại hoặc re-plan.

### Chưa xong

- Chưa có `types/projectV2.ts`.
- Chưa có domain/state machine cho Project V2.
- Chưa có schema/migration Project V2.
- Chưa có route `/project-v2` hoặc `/procurement-v2`.
- Chưa có UI Project V2 / Procurement V2.
- Chưa có cohort dự án mẫu V2.
- Chưa publish material-plan V2 sang canonical demand G2.
- Chưa mở Cloud preview hoặc pilot V2.

Đó là điểm bắt đầu lịch sử của chuỗi triển khai; hiện tại tiếp tục tại **Task 13**.

## 3. Thứ tự đọc bắt buộc ở phiên mới

1. [AGENTS.md](../../AGENTS.md)
2. File handoff này.
3. [Business decisions — project planning workflow](../designs/erp-completion-2026-09-19/project-planning-workflow-20260922.md)
4. [Implementation plan 13 tasks](plans/2026-09-23-project-v2-planning-procurement-flow.md)
5. [Astra integration handoff](../references/vioo-project-v2-codex-handoff/CODEX_START_HERE.md)
6. Khi đến phần tương ứng, đọc các tài liệu Astra sau:
   - `docs/references/vioo-project-v2-codex-handoff/docs/01_CONTEXT_AND_SCOPE.md`
   - `docs/references/vioo-project-v2-codex-handoff/docs/02_BEHAVIOR_SPEC.md`
   - `docs/references/vioo-project-v2-codex-handoff/docs/03_INTEGRATION_PLAN.md`
   - `docs/references/vioo-project-v2-codex-handoff/docs/04_DATA_AND_PERMISSION_CONTRACTS.md`
   - `docs/references/vioo-project-v2-codex-handoff/docs/05_ACCEPTANCE_AND_TESTS.md`
   - `docs/references/vioo-project-v2-codex-handoff/docs/06_SOURCE_MAP_AND_GAPS.md`
7. Chỉ dùng source prototype như UX reference:
   - `docs/references/vioo-project-v2-codex-handoff/prototype-source/app/workspace.tsx`
   - `docs/references/vioo-project-v2-codex-handoff/prototype-source/lib/project-data.ts`
   - `docs/references/vioo-project-v2-codex-handoff/prototype-source/app/globals.css`
   - `docs/references/vioo-project-v2-codex-handoff/references/06-v2-overview.jpg`
8. Nếu cần đối chiếu production pilot G1–G9, đọc:
   - [ERP completion handoff](../designs/erp-completion-2026-09-19/HANDOFF.md)
   - [Pilot rollout runbook](../runbooks/erp-completion-pilot-rollout.md)

Không đọc prototype rồi copy thẳng code trước khi hiểu các boundary của repository hiện tại.

## 4. Quyết định nghiệp vụ đã được người dùng duyệt

### 4.1 Cấp kế hoạch

- Tiến độ gốc/hợp đồng/BOQ là baseline.
- Công trường lập kế hoạch thực tế theo tháng từ baseline.
- Kế hoạch thi công tuần/ngày phải có nguồn từ kế hoạch tháng đã duyệt.
- Kế hoạch vật tư phải có nguồn từ công việc thi công đã duyệt và định mức vật tư liên kết.
- Người dùng phải xem được lineage từ dòng vật tư ngược về công việc, kế hoạch và baseline.

### 4.2 Duyệt và chỉnh sửa

- Chứng từ đã duyệt là immutable.
- Thay đổi sau duyệt phải tạo revision, không sửa âm thầm dữ liệu đã duyệt.
- Không self-approval ở Project V2 trong release đầu.
- Hủy hoặc giảm nhu cầu phải tôn trọng số lượng đã cam kết/đặt hàng/nhận hàng downstream.
- Các lệnh duyệt/publish phải repeat-safe và có audit trail.

### 4.3 Quantity và dữ liệu chưa đủ

- Không có định mức, hệ số quy đổi, identity, ngày cần hoặc nơi nhận thì phải hiện là thiếu/unknown.
- Không đổi unknown thành `0`.
- Không tự động kẹp số lượng bằng `Math.min` rồi che sai lệch.
- Sai đơn vị hoặc thiếu conversion phải chặn duyệt/publish ở đúng tầng nghiệp vụ.
- Dùng representation số lượng chính xác theo convention repository/Postgres; không lấy JavaScript `number` làm nguồn sự thật cho quantity quan trọng.

### 4.4 Mua hàng

- Approved material plan publish trực tiếp sang G2 canonical demand với source `material_plan`.
- Đề xuất vật tư công trường vẫn là nguồn `project_material_request` độc lập.
- Mua hàng xử lý theo hồ sơ/chứng từ, không bắt đầu từ một biển dòng dữ liệu kỹ thuật.
- Người mua chọn supply method trước; chỉ external purchase mới tạo PO.
- Một PO có thể gom dòng hợp lệ từ nhiều nguồn, nhưng lineage từng allocation phải chính xác.
- Không tạo fake MR link cho demand có nguồn `material_plan`.

## 5. Product architecture: module cũ và V2 song song

| Surface | Vai trò | Quy tắc |
|---|---|---|
| `/da` | Module Dự án hiện tại | Giữ nguyên, không redesign trong workstream này |
| `/procurement` | Module Mua hàng hiện tại/G5 Workbench | Giữ nguyên làm backend/operational reference; không coi UI hiện tại là target V2 |
| `/project-v2` | Workspace dự án V2 | Kế hoạch tháng, thi công, vật tư, revision, duyệt, trao đổi, hoạt động |
| `/procurement-v2` | Inbox và dossier Mua hàng V2 | Tiếp nhận nguồn nhu cầu, chọn phương án cung ứng, tạo PO khi cần |

### Cohort dự án V2

- Dùng cùng `project_id` hiện hữu để tận dụng permission, hợp đồng, kho, tài chính và identity.
- Dữ liệu vận hành V2 nằm trong các bảng/aggregate V2 riêng.
- Dự án tham gia cohort V2 được ẩn khỏi picker module cũ để tránh người dùng thao tác nhầm, nhưng không xóa hoặc nhân đôi project master.
- Chỉ bật cho dự án mẫu/canary được chỉ định.
- Không tự ý dùng pilot production DA29 làm dự án mẫu V2 nếu người dùng chưa chỉ định.

### Crew model

Project V2 cần crew/tổ đội thi công riêng phù hợp nghiệp vụ lập kế hoạch. Không tái sử dụng mù quáng `safety_teams` chỉ vì có tên gần giống.

## 6. Những gì tái sử dụng từ G1–G9

G1–G9 là nền tảng backend đã triển khai, không được xây lại:

- G2 canonical demand ledger và source adapter đã có khả năng nhận `material_plan`.
- G3 policy/canonical control cho procurement.
- G4 material planning hiện hữu là nguồn tham khảo về identity/quantity, nhưng workflow `draft/confirmed → MR draft` **không phải** workflow duyệt Project V2.
- G5 là owner của atomic PO allocation; V2 phải mở rộng đúng boundary này, không tạo đường tắt tạo PO riêng.
- G6–G9 tiếp tục cung cấp các integration và production controls hiện hữu.

Các điểm cần mở rộng, không thay thế:

- Material plan V2 publish vào G2 bằng lineage chính xác đến revision/line.
- Atomic PO command hiện giả định request links và allocations đi cùng nhau. Task 11 phải hỗ trợ material-plan allocation không có fake request link, trong khi `project_material_request` vẫn bắt buộc request link.
- Procurement V2 dùng read model/dossier mới trên nền canonical demand, không bê nguyên Workbench row UI.

## 7. Đánh giá prototype Astra

### Có thể tái sử dụng về tư duy sản phẩm

- Một workspace thống nhất theo dự án.
- Ba loại chứng từ kế hoạch rõ ràng: tháng, thi công, vật tư.
- List/detail, trạng thái và primary action rõ.
- Source picker để lấy dữ liệu từ chứng từ upstream.
- Tabs `Thông tin / Trao đổi / Hoạt động`.
- Revision-like flow, lịch sử và audit dễ hiểu.
- Progressive disclosure: màn hình chính phục vụ quyết định; chi tiết kỹ thuật nằm ở drill-down.
- Bảng kế hoạch quen thuộc với người dùng xây dựng, có thể nhập nhanh mà vẫn thấy nguồn và số còn lại.

### Không được sao chép như implementation production

- Next.js/shadcn shell của prototype.
- State in-memory, hardcoded seed/KPI/date.
- ID sinh bằng `Date.now()`.
- JavaScript `number` cho quantity quan trọng.
- Same-actor self approval.
- `sourceIds` chỉ lưu ở header mà không có lineage theo dòng.
- Silent clipping bằng `Math.min`.
- Bất kỳ giả định nào không có Auth/RLS/persistence/audit.

UI production phải reuse design system hiện tại trong `components/erp`, routing và authorization convention của repository.

## 8. UX target đã chốt

Người dùng phải trả lời được trong vài giây:

1. Tôi đang xem kế hoạch/hồ sơ nào?
2. Trạng thái hiện tại là gì?
3. Dữ liệu này lấy từ đâu?
4. Có vấn đề nào phải xử lý trước khi duyệt hoặc mua?
5. Tôi phải làm gì tiếp theo?

### Project V2

- Điều hướng theo công việc: Tổng quan → Kế hoạch tháng → Kế hoạch thi công → Kế hoạch vật tư.
- Danh sách chứng từ trước, mở detail khi cần.
- Form header ngắn, rõ kỳ kế hoạch, người phụ trách, người theo dõi, status.
- Bảng dòng phục vụ nhập/so sánh thực tế; ẩn metadata kỹ thuật khỏi màn hình chính.
- Primary action theo trạng thái: tạo nháp, gửi duyệt, duyệt/từ chối, tạo revision, publish.
- Hiện rõ dữ liệu thiếu và nguyên nhân block.

### Procurement V2

- Trang đầu là inbox theo **hồ sơ nhu cầu**, không phải hàng trăm dòng rời.
- Card/row hiển thị nguồn, dự án, người yêu cầu/chủ kế hoạch, ngày cần, nơi nhận, số dòng, trạng thái và việc tiếp theo.
- Mở dossier để xem dòng vật tư, nguồn gốc, allocation, đối chiếu, lịch sử và action.
- Label nguồn bằng ngôn ngữ nghiệp vụ: `Kế hoạch vật tư` hoặc `Đề xuất vật tư`.
- `Cần đối chiếu`, `Thiếu dữ liệu`, `Chưa xác định` phải giải thích được và dẫn đến action cụ thể.
- Không hiện reason code kỹ thuật như `boq_closure_not_supported` trên mặt UI chính.

### Responsive và accessibility

- Walkthrough desktop, tablet và mobile theo scope từng màn hình.
- Bảng rộng dùng sticky identity columns/scroll có chủ đích; mobile chuyển thành progressive detail thay vì ép toàn bộ bảng.
- Keyboard focus, label, status semantics và contrast phải dùng được hằng ngày.

## 9. Kế hoạch triển khai đã duyệt — không re-plan

Thực hiện tuần tự theo file plan chi tiết:

1. Lock V2 contracts, state machine và quantity invariants.
2. Add isolated V2 cohort và authoritative planning aggregate.
3. Add V2 permissions, routes và sidebar song song.
4. Implement server-authoritative planning commands/workflow.
5. Build strict read/query services và Project V2 overview shell.
6. Implement month và construction plan UX.
7. Derive/approve material plans từ construction work.
8. Publish approved material plans vào G2 canonical demand.
9. Add document-first Procurement V2 read model/routes.
10. Build Procurement V2 inbox/dossier UX.
11. Generalize atomic PO creation cho material-plan và mixed-source demand.
12. Complete comments/activity/CSV/lineage/related-plan navigation.
13. Integration verification, Cloud preview và controlled pilot handoff.

### Delivery gates

- Gate A — Domain contract: Task 1.
- Gate B — Persisted Project V2 foundation: Tasks 2–4.
- Gate C — Usable Project V2 planning: Tasks 5–7.
- Gate D — End-to-end Procurement V2: Tasks 8–11.
- Gate E — Collaboration, verification và pilot: Tasks 12–13.

Không nhảy trực tiếp sang Task 6/10 để dựng màn hình khi state machine, quantity và lineage chưa được khóa.

## 10. Hướng dẫn khởi động ban đầu (lịch sử trước Task 1)

Các bước trong mục này đã được thực hiện; không chạy lại chỉ vì mở một phiên mới. Tiếp tục từ Task 13 và evidence nêu ở đầu handoff.

### 10.1 Kiểm tra read-only

```bash
pwd
git status --short --branch
git log -5 --oneline
git diff --name-only
git ls-files --others --exclude-standard
```

Xác nhận đang ở đúng branch/worktree và ghi nhận file bẩn trước khi sửa. Không restore/stash/reset thay đổi không thuộc workstream.

Task 1 là pure TypeScript/domain contract, nên chưa cần Cloud write hoặc migration.

### 10.2 Bắt đầu Task 1 bằng TDD

Tạo test fail trước theo plan:

- `lib/__tests__/projectV2PlanDomain.test.ts`
- `lib/__tests__/projectV2Presentation.test.ts`

Sau đó mới tạo:

- `types/projectV2.ts`
- `lib/projectV2/planDomain.ts`
- `lib/projectV2/presentation.ts`

Contract tối thiểu phải khóa:

- Plan kinds: monthly, construction, material.
- State machine và allowed transitions.
- Separate submit/approve actors.
- Revision/immutability semantics.
- Exact lineage theo document revision và line.
- Quantity state: known/unknown/incomplete, không fallback 0.
- Approval blockers và presentation microcopy.
- Source labels thân thiện nghiệp vụ.

Chạy targeted tests và lint/typecheck phù hợp rồi mới commit đúng các file Task 1. Không stage các file bẩn khác.

## 11. Trạng thái Git tại thời điểm lập handoff

- Branch: `feature/refactor-du-an-t9-1`
- Tracking: `origin/feature/refactor-du-an-t9-1`
- Trước khi tạo handoff: branch ahead origin 14 commits.
- HEAD trước handoff: `7cee7eb feat(daily-log): publish summary progress atomically`
- Plan commit đã có trong history: `0346f75 docs: plan project v2 planning and procurement flow`

Worktree đang có nhiều thay đổi của workstream khác, gồm procurement usability, BOQ UI, daily-log, auth và migrations. Những thay đổi đó thuộc người dùng/phiên khác; không sửa, không stage, không restore trong task Project V2.

Các nhóm file cần đặc biệt tránh trộn:

- `components/procurement/*`
- `components/project/material/*`
- `pages/procurement/ProcurementWorkbench.tsx`
- `pages/project/DailyLogTab.tsx`
- `pages/project/WeeklyProgressTab.tsx`
- `lib/projectWeeklyProgressService.ts`
- `supabase/functions/*`
- các migration daily-log/auth ngày 2026-09-23
- `types.ts` nếu đang còn diff từ workstream khác; ưu tiên type V2 trong file mới như plan.

Tuyệt đối không chạm:

- `docs/audits/erp-end-to-end-2026-09-19/README.md`

Nếu file này đang dirty, chỉ ghi nhận và bỏ qua. Không stage, restore hoặc “dọn sạch” nó.

## 12. Quy tắc Git và commit

- Một branch, một worktree.
- Không tạo sub-agent.
- Không tự stash/reset/checkout file bẩn.
- Dùng `git diff -- <path>` trước khi stage.
- Stage bằng danh sách path chính xác của task.
- Kiểm tra `git diff --cached --name-only` trước commit.
- Mỗi task hoặc slice có commit hẹp, dễ review.
- Không amend/rebase/push nếu người dùng chưa yêu cầu.

## 13. Supabase và môi trường

- Chỉ dùng Supabase Cloud qua cấu hình `.env` của repository.
- Không chạy Supabase local.
- Không dùng Docker.
- Migration phải là file mới; không sửa migration đã apply.
- Trước mọi Cloud write phải kiểm tra target/project/branch theo runbook và scope của task.
- Task 1 không cần Cloud write.
- Task 2 trở đi: viết migration + SQL tests trước; chỉ apply vào Cloud preview/branch khi plan đến gate tương ứng.
- Không deploy production trong các task foundation.
- Không log secret/token/.env content vào output hoặc tài liệu.

## 14. Authorization và security invariants

- Permission phải đi qua registry/convention hiện tại, không hardcode email/user ID.
- RLS và server-authoritative command là nguồn sự thật; UI guard chỉ hỗ trợ trải nghiệm.
- Không cho actor submit tự approve trong release đầu.
- Approved document/revision không được update trực tiếp.
- Publish phải idempotent và tránh duplicate canonical demand.
- Audit actor/time/reason đầy đủ cho submit, approve, reject, revise, cancel và publish.
- Query service không được nuốt denied/error thành empty data hoặc zero.

## 15. Quan hệ với production pilot G1–G9

- G1–G9 đã triển khai; production pilot DA29 đang active.
- Không re-plan hoặc xin duyệt lại các task G1–G9 đã hoàn tất.
- Business UAT J01–J08 vẫn phải do người dùng nghiệp vụ xác nhận; automation không thay thế signoff.
- Hai hotfix cuối đã được xác nhận trong handoff G9:
  - quyền Mua hàng của Nguyễn Phương Thảo;
  - BOQ material-planning wrapper tại migration `20260922064202_fix_boq_material_planning_wrapper_security.sql`.
- Không lặp Cloud write cho hai hotfix này khi chưa có regression cụ thể.
- Project V2 là workstream mới chạy song song; không được làm mất ổn định pilot hiện tại.

## 16. Non-goals release đầu

- Không thay thế toàn bộ module Dự án hiện tại.
- Không thay thế toàn bộ module Mua hàng hiện tại.
- Không migrate tất cả dự án sang V2.
- Không tự động tạo PO khi duyệt kế hoạch vật tư.
- Không tự động tạo receipt/AP/payment/cash posting.
- Không xây scheduling engine CPM/resource leveling đầy đủ.
- Không copy pixel-for-pixel prototype Astra.
- Không redesign ngoài Project V2/Procurement V2 scope.
- Không sửa UI Workbench cũ để giả làm Procurement V2.

## 17. Definition of done cho toàn workstream

Chỉ coi workstream hoàn tất khi:

- Project V2 và Procurement V2 tồn tại song song, được cohort-gate và permission-gate.
- Người dùng tạo được kế hoạch tháng từ baseline.
- Người dùng tạo được kế hoạch thi công từ kế hoạch tháng đã duyệt.
- Người dùng tạo được kế hoạch vật tư từ công việc và định mức có lineage.
- Submit/approve/reject/revision/cancel tuân thủ state machine và audit.
- Approved material plan publish đúng một lần sang G2 canonical demand.
- Procurement V2 phân biệt rõ material plan và site request.
- Người mua chọn được supply method và chỉ tạo PO cho external purchase.
- Atomic PO hỗ trợ material-plan và mixed-source mà không tạo fake MR link.
- Unknown/incomplete được giữ nguyên và hướng dẫn xử lý, không biến thành 0.
- Targeted unit/integration/SQL/E2E tests pass.
- Desktop/tablet/mobile walkthrough đạt UX acceptance trong scope.
- Cloud preview được verify trước; production/pilot chỉ kích hoạt sau khi người dùng duyệt gate tương ứng.
- Business signoff được ghi nhận riêng, không suy diễn từ test automation.

## 18. Cách báo cáo trong phiên mới

- Cập nhật tiến độ trong lúc làm bằng tiếng Anh.
- Báo cáo hoàn tất bằng tiếng Việt.
- Mỗi báo cáo cần nêu: outcome, file/commit, verification đã chạy, phần chưa chạy, rủi ro hoặc quyết định cần người dùng xác nhận.
- Không nói “hoàn tất” nếu chỉ có test automation mà chưa có business signoff ở gate cần signoff.
