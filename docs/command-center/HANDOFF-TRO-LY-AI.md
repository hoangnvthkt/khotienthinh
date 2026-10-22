# HANDOFF — Trợ lý AI v2 + Trung tâm AI (cập nhật 19/10/2026 — thêm công cụ chi_tiet_ho_so)

Đọc tệp này **trước khi làm bất cứ gì** về Trợ lý AI, Trung tâm AI, cổng `ai-gateway`. Đủ để làm tiếp ngay.
Tài liệu sống kèm theo: Claude Docs "Audit AI" → tab **"Trợ lý v2 · 17/10"** (doc `Wo95Mv3mZw3wxBpZLNY9NG`, thân tab `08e095b7-9f8a`, khối cuối `mfjt2rsnpg4.22529` — mỗi đợt xong thêm một gạch đầu dòng sau khối cuối).
Hướng dẫn người dùng: `docs/command-center/huong-dan-trung-tam-dieu-hanh.md` (mục "Tab Trợ lý") và `docs/command-center/huong-dan-tro-ly/` (1 trang PNG / PDF gửi Zalo).

---

## 1. Tình hình ngay lúc bàn giao

- **Mọi thứ đã lên prod**: PR #230 → #248 đã merge vào `main` (gần nhất `ef2b98ba`), mọi migration đã áp Supabase Cloud, `ai-gateway` đã deploy (lần cuối sau #245; #246–#248 không đổi mã cổng).
- **Nhóm thí điểm 15 người đang dùng Trợ lý** (cấp 18/10 tối). Chủ SP vừa nhận hướng dẫn 1 trang để gửi nhóm Zalo — **đang chờ chủ SP phản hồi** ("đã gửi" / "sửa hướng dẫn").
- **Jev (TypeSafe AI) — J0 ĐẠT, J1 chạy bóng** (18/10 đêm): đọc `docs/command-center/09-jev-typesafe-ket-hop-tro-ly-2026-10-18.md` (mục 7–8). Sau khi J1 lên prod, Admin phải gán kết nối TypeSafe vào tính năng "Trợ lý · điều hướng Jev (chạy bóng)" thì mới ghi `ai_decisions`; 1 tuần sau chạy `scripts/jev-evals/shadow-report.mjs` rồi đề xuất J2.
- **Việc tiếp theo đã thống nhất**: sau 1–2 tuần dùng thật, đọc tab **Trung tâm AI → Hoạt động** rồi đề xuất **T5 – báo cáo theo lịch** (bản tin sáng 7h tự gửi, báo cáo tuần dự án cho BLĐ thứ Hai) dựa trên điều nhóm hỏi nhiều nhất. Không làm T5 trước khi chủ SP đồng ý.

## 2. Cách làm việc chủ SP yêu cầu (bắt buộc)

1. **Làm lần lượt từng đợt**: xong đợt → lên prod → chủ SP thử → "OK" mới sang đợt sau. Có nhiều phương án → hỏi bằng **AskUserQuestion / nút bấm**, phương án đề xuất đứng đầu ghi "(Recommended)".
2. **"Merge khi CI xanh"**: check chính là **"Typecheck, test and build"**. Check **"Supabase Preview"** luôn đỏ / pending / skipping ở mọi PR — **không chặn merge**. Squash-merge bằng `/opt/homebrew/bin/gh pr merge <n> --squash`.
3. **AI không bao giờ tự xóa, trả lại, duyệt, ghi sổ**. Trợ lý chỉ **chuẩn bị nháp** (thẻ), người dùng tự bấm. Từ chối lịch sự câu ngoài công việc / khiếm nhã / đòi thao tác cấm.
4. **Thiếu ngữ cảnh thì hỏi lại kèm nút**, không đoán từ màn đang xem (vd chưa nói dự án → hỏi dự án bằng gợi ý bấm).
5. **Giao diện**: đọc `AGENTS.md` + **`docs/ui/VIOO-UI-UX.md` trước khi làm màn nào** (component dùng lại `hubUi`, `financeUi` `Kpi`/`ENT`/`NUM`, `Drawer`, `StateBox`, `useConfirm`, `useToast`; theme xanh FastCons; cam/đỏ chỉ cho cảnh báo; header ô icon `bg-teal-700`; tab khung `bg-teal-700` khi chọn). Chỉ tiêu đề + số liệu, giải thích để `title`. Kiểm 1440 / 820 / 390, **Playwright WebKit (`mobile-safari`)** cho màn có trên điện thoại, không tràn ngang. Ảnh gửi chủ SP luôn **nền sáng**.
6. **Animation lặp vô hạn chỉ `opacity`/`transform`**, không `color-mix` (sự cố Safari #117). Thư viện mới phải chạy iOS 16+.
7. **Không sub-agent. Supabase chỉ dùng Cloud** (`.env` của repo gốc `/Users/admin/khotienthinh/.env`), không local / Docker. **Không in khóa / secret** ra log.
8. Xưng "em", gọi chủ SP "anh". Báo cáo ngắn, tiếng Việt.

## 3. Môi trường, công cụ, lệnh

| Việc | Cách |
|---|---|
| Worktree làm việc | `/Users/admin/khotienthinh/.worktrees/assistant-v2` (có `node_modules` riêng; **không có `.env`** → trỏ vào `/Users/admin/khotienthinh/.env`) |
| Nhánh | mỗi đợt một nhánh mới từ `origin/main` (`git fetch -q origin main && git checkout -q -b feature/… origin/main`) |
| Xem thử | launch `assistant-v2` cổng **4230** (vite của worktree). Cài thư viện mới thì **dừng + khởi động lại** preview |
| Fixture Trung tâm / Trợ lý | `http://localhost:4230/tests/center/fixture.html?ai=gemini` (không gọi Supabase). Tham số: `ai=gemini\|off\|fail\|quota\|busy\|rate\|refuse\|leave-short\|leave-fail\|mr-noflow\|mr-fail\|po-noapprover\|dl-fail`, `memory=1` (đã nhớ cách gọi / lựa chọn), `access=none\|cap` (chưa cấp / trần câu), `models=1` (một model), `mrform=0`, `threads=today\|old`. `window.__aiCalls` ghi mọi lời gọi giả |
| Fixture Trung tâm AI | `http://localhost:4230/tests/center/ai-center.html` (`?role=staff`, `?empty=1`, `?activity=fail`); `window.__aiAdminCalls` |
| E2E | `npx playwright test -c tests/center/playwright.config.ts tests/e2e/center-assistant.spec.ts tests/e2e/center-ai-admin.spec.ts` (desktop + mobile-safari). Chạy cả bộ có vài ca chập chờn khi tải nặng (T2a, T2b, 3D) — chạy riêng là đạt |
| Kiểm tra trước PR | `npm run check:supabase-migrations && npm run lint && npm run check:supabase-queries && TZ=UTC npx vitest run && npm run build` (dùng `set -o pipefail`, đừng `\| tail` che lỗi) |
| Type-check cổng AI | `npm i --no-save @anthropic-ai/sdk@0.131.0` rồi `node_modules/.bin/tsc -p scripts/assistant-evals/tsconfig.gateway.json` |
| **Bộ kiểm hồi quy (model thật)** | `npm i --no-save @anthropic-ai/sdk@0.131.0` rồi `ASSISTANT_EVAL_ENV=/Users/admin/khotienthinh/.env node scripts/assistant-evals/run.mjs [ca…]`. **23 ca (có 9 ca theo vai Admin / nhân viên thường), phải đạt hết trước mỗi lần deploy `ai-gateway`.** Gặp lỗi mới khi thử thật → thêm ca vào `CASES` trước rồi mới sửa |
| SQL trên Cloud | `CLOUD_SQL_ENV=/Users/admin/khotienthinh/.env node scripts/cloud-sql.mjs "select …"` (chỉ đọc); `--file x.sql --rollback` (chạy thử); `--file x.sql --write` (ghi thật) |
| Smoke migration (giao dịch rollback) | `SUPABASE_ACCESS_TOKEN=… node scripts/run-supabase-cloud-transaction.mjs --expected-ref ftciqmqhmfvjtwoycswe --migration supabase/migrations/<m>.sql --smoke supabase/tests/<s>.sql` |
| Áp migration | thêm tên tệp vào `supabase/baseline/current.json` (sửa bằng parse JSON) → `export SUPABASE_ACCESS_TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' /Users/admin/khotienthinh/.env \| cut -d= -f2- \| tr -d '"')` → `npx --no-install supabase db push --linked --dry-run` → `echo Y \| npx --no-install supabase db push --linked` |
| Deploy cổng | `npx --no-install supabase functions deploy ai-gateway --project-ref ftciqmqhmfvjtwoycswe --use-api` (sau khi merge; chỉ khi mã `supabase/functions/ai-gateway` đổi) |
| Thứ tự ship | code → kiểm → (smoke Cloud) → commit + PR (`gh pr create`, cuối mô tả `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; commit kết bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`) → **áp migration** (tương thích bản app cũ) → chờ CI (`gh run watch <id> --exit-status` chạy nền) → merge → deploy cổng nếu cần → cập nhật memory + Claude Docs |
| Model đang dùng | Kết nối **RevidAPI** `openai_compatible`: `claude-sonnet-5-5` (đọc ảnh, 0,008 USD/lượt gọi, mặc định Trợ lý + đọc ảnh kho) và `deepseek-v4.1-flash` (không đọc ảnh). Khóa ở Vault, lấy qua `integration_secret_v1` (service role) |

## 4. Kiến trúc (đường dữ liệu)

```
Trung tâm điều hành (/center) → tab Trợ lý (components/center/AssistantView.tsx)
  ├─ get_my_ai_access_v1 → được cấp chưa, trần câu/ngày, danh sách model (mặc định đầu)
  ├─ gửi câu: lib/assistantChat.ts → POST functions/v1/ai-gateway {skill:'assistant_chat', input:{question, images?, files?}, context:{projectId, connectionId?}}
  └─ SSE: start → tool (đang tra…) → delta → command (thẻ nháp) → done
ai-gateway (supabase/functions/ai-gateway)
  index.ts   ai_gateway_begin_v1 (quyền, cấp phát, trần, model của người) → chat(): ghi nhớ cá nhân, loại nghỉ, lịch sử 12 tin
  chat.ts    lời nhắc (CHAT_GUARD, quy tắc gợi ý [[goi_y:…]], từ chối [[tu_choi:…]], tệp <du_lieu loai="tep">, ghi nhớ <du_lieu loai="ghi_nho">),
             parseChatInput (≤4 ảnh, ≤3 tệp chữ ≤30.000), isDailyReportTurn / looksLikeDailyReport (buộc gọi công cụ nhật ký)
  loop.ts    vòng gọi công cụ ≤5 bước / 8 lần tra / 80 s; ảnh gắn lượt hỏi cuối; forceTool
  tools.ts   đọc: tim_ho_so, ton_kho, chi_tiet_don_mua, chi_tiet_de_xuat, viec_cua_toi, phep_nhan_vien (số phép của mình / người khác / toàn công ty —
             get_hrm_leave_ledger · list_hrm_leave_balances tự chặn 42501; quyền do RPC quyết, lời nhắc không tự giới hạn),
             chi_tiet_ho_so (19/10: hồ sơ CÔNG VIỆC một nhân viên — get_hrm_employee_overview + _work_organization + _contract_employment khi RPC cho xem;
             mức xem danh bạ / chính mình / quản lý / HR do hrm_employee_profile_access_level quyết; không CCCD / STK / lương / SĐT cá nhân;
             quản lý trực tiếp có mã hN riêng; mã hN của hồ sơ ô tìm ngay dùng được nhờ SourceBook.find)
             chuẩn bị (chỉ ghi assistant_commands + emit thẻ): chuan_bi_don_nghi_phep, chuan_bi_de_xuat_vat_tu, chuan_bi_don_mua (tự tính tiền,
             đối chiếu thanh_tien: lệch đúng 1.000 lần thì sửa SL), chuan_bi_nhat_ky (nguyên văn tin / noi_dung chép từ ảnh), chuan_bi_ghi_nho
             matchProjects / projectsMentioned (mã, tên, chủ đầu tư; cặp chữ liền "Xin Hai")
  agent.ts / providers.ts   định dạng OpenAI / Anthropic, ảnh base64, ToolChoice
  _shared/aiComplete.ts (B1, 21/10) gọi MỘT lượt trả JSON dùng chung với wms-doc-reader: ảnh chờ 110 s (như hội thoại), đầu ra dài 100 s, chữ 55 s;
             lỗi thoáng qua (rỗng / 429 / 5xx / không gọi được) thử lại đúng 1 lần trong quỹ 140 s (hết giờ KHÔNG thử lại); mã lỗi ổn định
             AI_TIMEOUT / AI_UNREACHABLE / AI_HTTP_<mã> → lib/aiGateway.ts aiFailureMessage nói đúng chuyện ở mọi màn (Kho, Lập đơn, Đề xuất, Trợ lý)
  chat.ts    (19/10) parseChatHits / foundLines: hồ sơ ô tìm ngay gửi kèm → <du_lieu loai="tim_thay"> với mã hN (SourceBook) — AI dùng trước, không gọi tim_ho_so
  reports.ts (20/10) bao_cao: 3 RPC assistant_report_{workflow,inventory,procurement}_v1 (security invoker → theo quyền xem RLS) → thẻ biểu đồ cột / cột chồng / tròn (lib/assistantChart.ts kinds line|bar|stacked|donut, nhãn riêng từng khung)
             A2 (22/10) thêm 7 loại: tien_do_du_an (assistant_report_progress_v1, bắt buộc du_an — % cuối tuần từ nhật ký duyệt × trọng số ngày KH, hạng mục quá hạn, project_delay_events),
             tai_chinh (assistant_report_finance_v1: DEFINER + finance_can('view'); thu / chi từ project_transactions; công nợ NCC khi finance_can('manage')), cham_cong, nghi_phep (đơn vị qua
             app_private.assistant_employee_unit_names vì employees không mở cho authenticated), yeu_cau (requests), dat_xe, van_ban — invoker theo RLS. Thẻ tối đa 3 khung / 4 ô số.
             Migration 20261027090000_assistant_reports_a2; smoke supabase/tests/assistant_reports_a2_smoke.sql (Admin thấy số, nhân viên mới 0 / 42501 tài chính).
  handbook.ts + handbook.generated.ts (B3, 22/10) công cụ so_tay: "làm sao để…" → tìm mục bằng từ khóa không dấu (tiêu đề ×4, từ khóa ×3, cụm 2 từ ×3; câu ≥ 3 từ
             cần nửa số từ khớp mạnh) trong sổ tay sinh sẵn: docs/so-tay/*.md (21 mục viết tay), docs/huong-dan-su-dung-phong-quan-ly-du-an.md (43 mục "Các bước
             thực hiện"), danh mục màn / thao tác lib/search/searchCatalog.ts (37). Sinh lại: npm run handbook:build (scripts/handbook); test assistantHandbook so khớp tệp
             sinh. Nguồn kiểu page (SourceBook.page → [[hN]]) → client vẽ nút mở màn (lib/assistantChat parseSources, AssistantView sourceChips).
  Bản tin Admin tuần (B4, 22/10) — không trong cổng: migration 20261027120000_ai_admin_weekly_digest: app_private.ai_admin_digest_signals (tín hiệu tuần: Trợ lý
             lỗi / 👎 / từ chối / chậm / chi phí / thẻ nháp / người được cấp chưa dùng / Jev khớp; góp ý mới + mở; việc treo: phép, quy trình, yêu cầu, phiếu giao;
             nháp bỏ dở) → ai_admin_digest_picks (luật có điểm → ≤ 3 việc) → ai_admin_digest_build (bảng ai_admin_digests + notifications push_enabled cho users
             role ADMIN) · cron 'ai-admin-weekly-digest' 0 0 * * 1 (07:00 VN) · RPC ai_admin_digest_list_v1 / ai_admin_digest_run_v1(p_week_start, p_send) ·
             UI Trung tâm AI → tab Bản tin tuần (components/aiCenter/AiDigestPanel.tsx, ?tab=digest từ thông báo). Smoke supabase/tests/ai_admin_weekly_digest_smoke.sql.
  jev.ts     J1 chạy bóng: hỏi Jev (TypeSafe, kết nối tính năng ai.decisions) ý định + câu đòi thao tác cấm song song model chính → ai_decision_log_v1
             B2 (21/10) buildIssueRequest / askJevIssue: Choice loại góp ý (8) + mức khẩn (4) cho công cụ chuan_bi_su_co; ≥ 0,85 lấy của Jev, không thì giữ của
             model; ghi ai_decisions kind issue_class (predicted Jev / actual model, agree theo loại). Không gán kết nối → bỏ qua, thẻ vẫn ra.
  tools.ts   chuan_bi_su_co (B2): kể lỗi / gửi ảnh màn hình → thẻ issue_report {title, description, type, priority, module, screen, modelType, modelPriority, jev}
             → lib/assistantIssue.ts: người dùng bấm Gửi Admin → feedbackService.createItem (module Góp ý sẵn có, visibility private, metadata.source
             'assistant' + 10 lỗi gần nhất trên máy từ lib/clientErrorLog.ts) + ảnh đã gửi trong chat → feedback-attachments + thông báo mọi Admin
             (feedbackNotificationService.notifyCreated) → assistant_command_finish_v1. Admin xử lý ở /feedback như góp ý thường.
Thẻ nháp (components/center/AssistantCommandCard.tsx): kind leave_request | material_request | purchase_order | daily_log | memory_note | unknown
  → form trong chat: AssistantMrForm / AssistantPoForm / AssistantDailyLogForm; gửi bằng ĐÚNG lệnh của module rồi assistant_command_finish_v1
```

Ô hỏi hai tầng (19/10, chủ SP: "cái gì search ra thì không cần AI"): `lib/search/instantSearch.ts` (isLookupQuery, entityTerms, rankRecordHits, strongTopHit) + `components/center/useInstantSearch.ts` (RPC search_global_v1 như ô Tìm kiếm, 150 ms) → danh sách `vcc-hits` trên ô nhập: hồ sơ + **trang + thao tác** (buildLocalIndex từ thanh bên / quickActionDefs, CenterPage truyền `searchLocal`); bấm / ↑↓ Enter mở (0 token); thao tác tại chỗ (nghỉ phép, tạo đề xuất) mở qua `openSearchModal` (CommandPalette nghe `vioo:open-modal`); thao tác Trợ lý tự lo trong chat (`ASSISTANT_HANDLED`: nghỉ phép, đề xuất vật tư, đơn mua, nhật ký) KHÔNG tự mở khi Enter — đi AI để hỏi lại bằng nút. Câu hỏi thật gửi kèm `hits` cho cổng. Ô Tìm kiếm "Hỏi Trợ lý AI" → `/center?view=assistant&ask=…` (CenterPage/CenterShell/AssistantView.initialQuestion). Nháp form đơn mua / đề xuất giữ ở localStorage (`lib/assistantFormDraft.ts`), kết quả tải thẻ nhớ 5 phút (`memoLoad`).

Tệp client chính: `lib/aiGateway.ts` (status, feedback v2, myAccess, thông báo lỗi), `lib/assistantCommands.ts`, `lib/assistantMrForm.ts`, `lib/assistantPoForm.ts`, `lib/assistantDailyLogForm.ts`, `lib/aiLearning.ts` (cách gọi chung), `lib/aiMemory.ts` (ghi nhớ + thói quen), `lib/assistantFiles.ts` (ảnh / Excel / PDF), `lib/assistantPdf.ts` (pdf.js legacy, `PDF_MAX_MB = 50`), `components/center/AssistantModelPicker.tsx`, `components/center/AssistantMemoryPanel.tsx`, `lib/aiAdmin.ts` + `pages/AiCenter.tsx` + `components/aiCenter/AiActivityPanel.tsx` (Trung tâm AI tại route `/ai`).

### Bảng / RPC chính (đều qua RPC, RLS khóa bảng)

| Nhóm | Bảng | RPC |
|---|---|---|
| Lượt AI, trần, phản hồi | `ai_runs` (status, model, cost_usd, summary, accepted, feedback_reason/note), `ai_skills` (daily_limit, per_minute_limit, max_concurrent, **access** everyone/granted), `ai_settings` (trần chung) | `ai_gateway_begin_v1`, `ai_gateway_finish_v1`, `ai_gateway_feedback_v2`, `get_ai_feedback_v1`, `set_ai_settings_v1` |
| Hội thoại | `assistant_threads`, `assistant_messages` | `list/get_ai_thread_v1`, `ai_thread_save_turn_v1` |
| Thẻ nháp | `assistant_commands` | `assistant_command_create_v1` (≤3/lượt, payload ≤20.000), `…_finish_v1`, `…_get_v1`, `assistant_mr_projects_v1`, `assistant_po_approvers_v1`, `assistant_daily_log_projects_v1`, `assistant_leave_types_v1` |
| Học cách gọi (chung) | `ai_memory_aliases` (project/company; task/crew/area/item/vendor) | `get/learn_ai_aliases_v2`, `get/learn_ai_memory_aliases_v1` (nhật ký), `get_ai_memory_overview_v1`, `forget_ai_memory_v1` |
| Trí nhớ cá nhân | `ai_user_memory` (note ≤30, habit `mr.approvers:<p>` `mr.warehouse:<p>` `po.warehouse:<p>` `po.approver`) | `get_ai_user_memory_v1`, `ai_user_note_save_v1`, `learn_ai_user_habits_v1` |
| Jev chạy bóng (J1) | `ai_decisions` (dự đoán + thực tế, không lưu nội dung; chỉ Admin đọc) | `ai_decision_log_v1`, `get_ai_decisions_summary_v1` |
| Trung tâm AI | `ai_grant_templates`, `ai_user_grants` (riêng đè mẫu; `connection_id` mặc định + `extra_connection_ids`), `integration_connections.display_name/blurb/icon/vision` | `get_ai_admin_overview_v1`, `ai_admin_people_v1`, `ai_admin_grant_save_v1`, `ai_admin_template_save_v1/_delete_v1`, `ai_admin_skill_access_v1`, `ai_admin_model_save_v1`, `get_my_ai_access_v1`, `get_ai_activity_v1` |

Mọi thay đổi cấp phát / mẫu / skill / model ghi `audit_trail` (module `AI`). Trần theo người (`user_day`, `user_month`) tính **mọi lượt AI** của người đó.

## 5. Lịch sử đợt (đều đã lên prod)

| PR | Nội dung | Migration |
|---|---|---|
| #230 | T0 khung chat: hỏi tiếp, chữ chạy dần, Lịch sử | `20261018150000_ai_assistant_threads` |
| #231 | Rào chắn: Quản trị AI = Admin Hoàng, trần tháng, chống spam, từ chối lịch sự | `20261018170000_ai_guardrails_costs` |
| #232 | T1 tự tra cứu bằng công cụ đọc (JWT người hỏi) | `20261018190000_ai_assistant_tools` |
| #233 | Giá theo lượt gọi (RevidAPI) | `20261018210000_ai_price_per_call` |
| #234 | T2a lệnh nháp + đơn nghỉ phép | `20261018230000_assistant_commands` |
| #235–#238 | T2b đề xuất vật tư: gợi ý bấm, hỏi dự án, **form ngay trong chat**, danh mục phân trang | `20261019090000_assistant_mr_commands` |
| #239 | T2c đơn mua từ báo giá (form trong chat, tiền do công cụ tính) | `20261019110000_assistant_po_commands` |
| #240 | T2d nhật ký từ báo cáo Zalo (forceTool) | `20261019130000_assistant_daily_log_commands` |
| #241 | Dự án theo tên chủ đầu tư; thẻ loại mới trên bản app cũ → "Tải lại" | `20261019150000_assistant_projects_client` |
| #242 | T4a học từ thẻ đã gửi ("Đã nhớ"), 👎 có lý do, **bộ kiểm hồi quy** | `20261019170000_ai_learning_v1` |
| #243 | T4b nút **Trí nhớ** (xem / quên), "nhớ giúp" → thẻ Lưu, nhớ người duyệt / kho | `20261019190000_ai_personal_memory` |
| #244 | T3 ảnh + Excel / CSV trong chat (đọc trên máy) | — |
| #245 | **Trung tâm AI** (/ai thay màn chat cũ): cấp theo người, mẫu, skill granted; gia hạn thí điểm Center tới 31/12 | `20261019210000_ai_admin_center` |
| #246 | Đọc **PDF** ≤ 50 MB (chữ / PDF scan → ảnh) | — |
| #247 | **Chọn model ở ô hỏi** (ô hỏi hai tầng), tab Model, câu hỏi nhanh dạng thẻ, xóa `pages/AiAssistant.tsx` | `20261019230000_ai_model_choice` |
| #248 | Tab **Hoạt động**, tin chào + "Thử ngay", hướng dẫn 1 trang, mở nhóm 15 người | `20261020090000_ai_activity` |
| J1 | **Jev (TypeSafe) chạy bóng**: kết nối `typesafe`, tính năng `ai.decisions`, `ai_decisions`; bộ đo J0 `scripts/jev-evals` | `20261020110000_jev_shadow_route` |
| #253–#254 | Giữ nháp form; "Hỏi Trợ lý AI" từ ô Tìm; **ô hỏi hai tầng** (tìm ngay / hỏi AI kèm hồ sơ hN) | — |
| #255 | Công cụ **`chi_tiet_ho_so`** (hồ sơ công việc nhân viên theo mức xem RPC); SourceBook.find cho mã hN tìm sẵn; smoke 3 RPC × 3 vai; 3 ca hồi quy | — |

Script vận hành đã chạy (giữ lịch sử): `supabase/operations/center_pilot_extend_2026_12_31.sql`, `supabase/operations/ai_pilot_group_2026_10_18.sql`.

## 6. Trạng thái prod (đã kiểm 18/10)

- **Trợ lý · hội thoại = "Chỉ người được cấp"**; mọi skill khác (đọc báo giá, ảnh phiếu, tóm tắt PO, nhật ký Zalo…) = "Mọi người".
- **16 người được cấp**: Admin Hoàng + 15 người thí điểm.
  - **Nâng cao** (10 USD/tháng, 80 câu/ngày): Admin Hoàng, Dương Xuân Thịnh (TGĐ), Nguyễn Thị Mơ (GĐĐH), Hà Đức Chuẩn (PTGĐ TC), Nguyễn Thị Hương (TP TCKT), Đặng Thị Thu Hà (QPP VTTB).
  - **Tiêu chuẩn** (3 USD, 30 câu): Phạm Thị Thủy, Bùi Thị Tâm (kế toán dự án — "chị Tâm kế toán"), Nguyễn Văn Luật, Nguyễn Văn Năm (CHT XinHai), Đoàn Văn Dương (QS/QC XinHai), Bùi Quang Chung, Bùi Thùy Linh, Nguyễn Thị Phương Thảo, Nguyễn Thành Đô, Nguyễn Thị Giang.
  - Cả 2 mẫu: model mặc định Claude Sonnet 5.5, model thêm DeepSeek Flash.
- **Trần chung 80 USD / 10.000 lượt mỗi tháng** (`ai_settings`).
- **Thí điểm Trung tâm điều hành**: 29 người (28 SMB + Đoàn Văn Dương), hết hạn **31/12/2026 23:59 (VN)**.
- Lưu ý dữ liệu: tài khoản Đoàn Văn Dương có email `hiepnb@…` (có thể nhập nhầm, chưa sửa — báo chủ SP nếu liên quan).

## 7. Bẫy đã gặp (đừng lặp lại)

- RPC trả bảng lớn: PostgREST cắt 1.000 dòng → **phân trang** (`.range()`), lỗi "Chưa có mã" #238.
- Xung đột phiên bản dùng `PT409`, **không** `40001` (PostgREST lặp vô hạn).
- Model thật: bịa loại nghỉ nếu không nạp danh mục; không tự gọi công cụ nhật ký → `forceTool`; **đọc "6.300" thành 6,3** từ ảnh → dặn số kiểu Việt + đối chiếu `thanh_tien`; cộng tiền sai → công cụ tự tính `tam_tinh/tong`.
- Bấm gợi ý sau lượt có tệp phải **gửi kèm lại tệp** (tệp chỉ đi theo lượt).
- Đổi `message.id` khi xong làm thẻ remount, mất dữ liệu đang gõ → giữ id hiển thị.
- Trang mở trước khi deploy không biết kind thẻ mới → thẻ "unknown" nhắc tải lại; sau mỗi đợt có kind mới nhắc chủ SP **F5**.
- Smoke SQL: khối chạy `set local role authenticated` không đọc được bảng RLS → đọc trước bằng postgres hoặc qua JSON của RPC; bảng tạm phải `grant select … to authenticated`.
- Test giờ: CI chạy **UTC** → `TZ=UTC npx vitest run`.
- CSS điện thoại toàn cục: `button` cảm ứng min 44px (công tắc phải bọc rãnh bên trong); `.text-xs` trong `.grid > div` bị ép một dòng ≤768px.
- `vitest --root /` quét cả máy → treo; chạy test thăm dò bên trong repo.
- Lời nhắc tự giới hạn phạm vi ("nhân sự của chính người hỏi") làm Admin bị từ chối xem phép người khác dù có quyền HR (18/10 tối) → phạm vi ghi "trong quyền xem", công cụ gọi RPC và để RPC chặn.
  Rà soát đủ 9 RPC × 3 vai 18/10: `docs/command-center/10-ra-soat-quyen-cong-cu-tro-ly-2026-10-18.md` — không RPC nào lộ / chặn quá tay; mọi 42501 ở `tools.ts` thành `outOfScope()`; tệp thử lại `supabase/tests/ai_tool_permissions_smoke.sql` (rollback, chỉ đọc).
- Mã hN của hồ sơ ô tìm ngay (SourceBook ở `index.ts`) **không** nằm trong `refBook` của vòng công cụ (`loop.ts`) → công cụ chi tiết nhận `ma: "h1"` tìm lại theo chữ "h1" và trượt. 19/10 thêm `SourceBook.find` làm nguồn dự phòng (`byRef` trong tools.ts) cho mọi công cụ chi tiết.
- Mức xem hồ sơ nhân viên thật trên Cloud (19/10, `ai_tool_permissions_smoke.sql`): Admin = HR_MANAGE (8 phần), HR = HR, nhân viên thường có Office = **DIRECTORY** (2 phần: tổng quan + công việc; hợp đồng 42501). Nghĩa là nhân viên thường vẫn thấy chức danh / phòng ban / quản lý của người khác — đó là quyền danh bạ hiện hành, không phải lỗi Trợ lý.
- Quy chuẩn "không dùng pdf.js để **xem** PDF": Trợ lý dùng `pdfjs-dist` 4.10.38 **legacy** chỉ để **đọc chữ**, tải lười khi ghim PDF, lỗi thì báo người dùng (không sập).

## 8. Việc còn mở / sẽ làm

1. **Chờ chủ SP**: đã gửi hướng dẫn vào nhóm Zalo chưa / có sửa không (`docs/command-center/huong-dan-tro-ly/tro-ly-ai-1-trang.html` → render lại PNG/PDF bằng Playwright, khung 1080px).
2. **Sau 1–2 tuần**: đọc tab Hoạt động (ai chưa dùng, thẻ gửi thật / bỏ, 👎 lý do, chạm trần, chi phí theo model) → đề xuất **T5 báo cáo theo lịch** (bản tin 7h push / Zalo; báo cáo tuần dự án cho BLĐ). Gợi ý chỉnh mẫu / trần theo số thật.
3. Việc tiếp cho ô hỏi hai tầng: mở rộng tầng tìm ngay sang trang / thao tác như ô Tìm kiếm. (`chi_tiet_ho_so` đã xong 19/10.)
4. ~~Việc nhỏ có thể chen~~ (xong 19/10): cảnh báo "Lệch thành tiền" ngay trên dòng thẻ đơn mua (nút "Giữ số này", chặn Gửi duyệt, không chặn nháp); bộ kiểm hồi quy chạy được với kết nối khác (`--model deepseek-v4.1-flash`, DeepSeek Flash đạt 26/26 — xem README); mã cũ rà ở `12-ma-cu-tro-ly-2026-10-19.md` — **đợt 1 chủ SP duyệt + #261 merged + `ai-assistant` deploy lại 19/10** (xóa ChibiBot, 2 tab Cài đặt, nhánh chat; giữ 7 action nghiệp vụ và quyền `ai.assistant.*`). **Đợt 2 còn mở** (cần migration, sau 1–2 tuần): gỡ `settings.chibi_bot.*` / `settings.ai_learning.*` khỏi catalog + registry, xóa `_shared/aiDatabaseContext.ts`, rà RPC `ai_tool_*`, drop bảng chat cũ sau khi sao lưu — xem doc 12 mục 4.
5. Trước 31/12/2026: hỏi chủ SP gia hạn / mở rộng thí điểm Trung tâm + nhóm AI.
6. **Jev J2** (sau 1 tuần chạy bóng, cần số từ `shadow-report.mjs` và chủ SP OK): dùng tầng auto để `forceTool`, tầng ask để hỏi lại bằng nút, Noul cấm ≥ 0,7 từ chối sớm; rồi J3 trọng tài khớp mã / NCC / dự án.
7. Lộ trình gốc còn: T5 báo cáo theo lịch; tri thức / gói skill (T4 mở rộng); OA Zalo cho nhật ký (để sau).
8. **Trợ lý "sống trong phần mềm"** (chủ SP 21/10, doc `14-tro-ly-song-trong-phan-mem-2026-10-21.md`): B1 đường đọc ảnh chung — XONG (#302, deployed 21/10);
   B2 phiếu sự cố — XONG (PR B2: dùng module Góp ý thay bảng mới; 4 câu doc 14 mục 5 em tự chốt, chủ SP duyệt "đề xuất rồi làm theo");
   A2 báo cáo 7 loại — XONG (#305); B3 sổ tay Vioo — XONG (#306); B4 bản tin Admin tuần — XONG (PR B4: luật có điểm, không gọi model; thêm tín hiệu = sửa ai_admin_digest_signals / picks); tiếp B5 OCR hợp đồng / văn bản. Chưa làm: tab Sự cố riêng ở Trung tâm AI (Admin dùng /feedback lọc nguồn Trợ lý); mục "Hoạt động" chưa đếm thẻ issue_report (hàm SQL ai_activity map theo tên công cụ).

## 9. Memory liên quan

`~/.claude/projects/-Users-admin-khotienthinh/memory/`: `assistant-v2-roadmap.md` (chi tiết từng đợt T0–T4b, T3), `ai-admin-center.md` (Trung tâm AI, nhóm 15 người, model), `feedback-clickable-options.md`, `feedback-assistant-brief-compact.md`, `integration-connections.md`, `ai-shared-memory-vision.md`, `vioo-ai-audit-2026-10-11.md`, `handoff-command-center.md`.
