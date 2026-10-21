# Vioo Work — Kế hoạch Đợt 1: giao việc số hóa + hạ tầng AI (20/10/2026)

Nguồn: chỉ đạo TGĐ (chủ SP gửi 20/10), mockup v1 đã duyệt (Artifact `LxSRjzHhwXZ7Ayv2ktDSbh`, tệp `.superpowers/review/work-giao-viec/giao-viec-v0.html`), audit Vioo Work R1A (20/10), hạ tầng AI hiện có (`docs/command-center/HANDOFF-TRO-LY-AI.md`).

## 1. Đã chốt

| # | Quyết định |
|---|---|
| 1 | Mức **A Trọng điểm / B Quan trọng / C Thường** do người giao chọn; độ gấp máy tự tô theo hạn (đỏ quá hạn, cam sắp hạn). Lưu bằng `priority` sẵn có: A = `urgent`, B = `important`, C = `normal` (chỉ đổi nhãn, giữ SLA). |
| 2 | Việc BLĐ giao trong họp: **thư ký ghi Sổ chỉ đạo**; việc giao miệng: **người nhận tự ghi, BLĐ xác nhận một chạm**. |
| 3 | Việc tự ghi chưa được xác nhận vẫn ghi nhận, **chỉ tính KPI khi đã xác nhận**. |
| 4 | Thí điểm: **BLĐ, Thư ký – Trợ lý, QLDA, TCKT, HCNS** (30 người, quyền đã áp 20/10). |
| 5 | Điểm hiệu suất / KPI / P3: quyết sau 1 tháng chạy thật. |
| 6 | **Chốt tuần thứ 7, báo cáo sáng thứ 2.** |
| 7 | BLĐ xem **theo phòng + Sổ chỉ đạo**; khi cần đi tiếp phòng → người → việc. |
| 8 | **AI dùng nhiều trong Vioo Work**: quản lý, giao việc, tạo việc, soạn thảo, tổng hợp báo cáo (chủ SP 20/10 tối). Với Vioo Work, quyết định "không tạo phiếu bằng câu" (doc 13 mục 6) **không áp dụng**: AI được soạn nháp việc từ câu nói, người giao vẫn bấm Giao. |

## 2. Hiện trạng (audit 20/10)

Giữ nguyên phía máy chủ R1A: vòng đời 10 trạng thái có xác nhận nhận việc, SLA theo lịch, chuyển việc, đồng thực hiện, việc con, checklist có người, đính kèm riêng tư, nhãn, theo dõi, thảo luận `@`, lịch sử bất biến, mã `VW-2026-…`, lệnh tạo việc có **xem trước người nhận + vân tay + chống gửi trùng** (`work_create_task`), sự kiện `work_task_events`.

Thiếu (Đợt 1 bù): giao nhanh; cập nhật có cấu trúc Đã / Đang / Sẽ làm; dòng thời gian gộp; "lâu chưa cập nhật"; màn Phòng tôi, Toàn công ty, Sổ chỉ đạo; xác nhận việc giao miệng; màu A/B/C; thanh nút điện thoại tràn; thông báo Work đang tắt (hàng chờ đã sạch từ 12/09).

## 3. Nguyên tắc AI trong Vioo Work

1. **AI chỉ soạn nháp.** Người giao bấm Giao, người làm bấm Gửi cập nhật / Nộp, người duyệt bấm Duyệt. AI không tự giao, duyệt, trả lại, đổi hạn, đóng việc.
2. **Số do máy chủ tính** (RPC); AI chỉ diễn giải và viết lời. Báo cáo ghi rõ số lấy từ đâu.
3. **Quyền do RPC quyết.** AI đọc bằng phiên của người dùng; ai không thấy việc nào thì AI cũng không thấy. Lời nhắc không tự thu hẹp (doc 10).
4. **Có dấu vết.** Lượt AI (`ai_runs`) → nháp → người gửi → sự kiện việc ghi `ai_run_id` ("AI soạn, Lê Minh Tuấn gửi"). Trung tâm AI đo tỷ lệ dùng nháp theo skill.
5. **Tên người và ngày do máy khớp.** AI chỉ đề xuất "Hà", "thứ 6"; máy khớp người được giao (bỏ dấu, biệt danh đã học) và đổi thành ngày cụ thể; không chắc thì hỏi bằng nút bấm.
6. **Chi phí có trần.** Chữ dùng model nhanh; chỉ khi có ảnh mới dùng model đọc ảnh. Hạn mức theo người ở Trung tâm AI.

## 4. Hạ tầng tích hợp AI

```
Màn Vioo Work · Trung tâm · Trợ lý
   │ nút ✨ (skill)                    │ hội thoại (công cụ)
   ▼                                   ▼
ai-gateway — quyền, hạn mức, model, nhật ký (ai_gateway_begin_v1 · Trung tâm AI)
   │ đọc gọn bằng phiên người dùng:
   │   work_task_brief_v1 · work_team_board_v1 · work_company_board_v1 · work_assignable_people_v1
   ▼
Nháp AI (JSON của skill / thẻ assistant_commands) → khớp tên + ngày trên máy → form cho người sửa
   ▼ người bấm
Lệnh Vioo Work sẵn có (tạo: xem trước người nhận → tạo, chống gửi trùng · progress_report · review …) + aiRunId
   ▼
work_task_events (ai_run_id) · work_task_updates · ai_runs.accepted → dòng thời gian, báo cáo, KPI, Trung tâm AI
```

Bốn lớp, làm một lần, mọi tính năng AI sau chỉ cắm vào:

| Lớp | Thành phần | Ghi chú |
|---|---|---|
| Dữ liệu | `work_task_updates` (Đã / Đang / Sẽ / Vướng, % trước → sau, tệp, `ai_run_id`); `work_tasks.last_progress_at`, `origin` (thường / chỉ đạo / tự ghi), `meeting_id`; `work_meetings` (Sổ chỉ đạo); `work_task_claims` (việc giao miệng chờ xác nhận) | AI đọc lịch sử cập nhật để tóm tắt và viết báo cáo |
| Đọc gọn | `work_task_brief_v1` (một việc: trường chính, 5 cập nhật gần, sự kiện chính), `work_team_board_v1` (Phòng tôi theo sơ đồ tổ chức), `work_company_board_v1` (đơn vị + Sổ chỉ đạo), `work_assignable_people_v1` (người giao được + tải + biệt danh) | Dùng chung cho màn và AI; kiểm quyền; việc "hạn chế" chỉ đếm, không lộ tên |
| Nháp + dấu vết | Mọi lệnh Work nhận `aiRunId` tùy chọn → `work_task_events.ai_run_id`; `ai_gateway_mark_used_v1`; thẻ Trợ lý kind `work_task`, `work_tasks_batch`, `work_update` | Đo AI có ích thật không |
| Skill | `work_task_draft`, `work_meeting_tasks`, `work_update_draft`, `work_task_writer`, `work_task_brief` (Đợt 1); `work_week_report` (Đợt 2) | Mỗi skill: dòng `ai_skills` + `SKILL_INFO` (tab Skill "Xem bên trong") + ca hồi quy theo vai |

Biệt danh người: thêm loại `person` vào `ai_memory_aliases` ("anh Đô", "Hà KH" → tài khoản), chỉ học từ việc đã giao thật (như nhật ký #228).

## 5. Bản đồ AI theo việc người dùng

| Người dùng làm gì | AI giúp gì | Skill / công cụ | Người bấm | Đợt |
|---|---|---|---|---|
| Trưởng phòng giao việc | Gõ tự nhiên "Hà rà soát HĐ cốp pha SMB thứ 6, quan trọng" → điền sẵn người, hạn, mức, checklist | `work_task_draft` (nút ✨ trên ô Giao nhanh) | Giao | 1 |
| Viết yêu cầu dài | Từ tên việc → yêu cầu + checklist + bằng chứng cần nộp | `work_task_writer` (✨ Viết yêu cầu) | Giao | 1 |
| Thư ký ghi họp | Dán biên bản / tin Zalo / ảnh sổ họp → danh sách việc (người, hạn, mức) | `work_meeting_tasks` (✨ Dán biên bản) | Giao n việc | 1 |
| Nhân viên cập nhật tiến độ | Ghi chú lộn xộn / ảnh hiện trường → Đã / Đang / Sẽ / Vướng + % gợi ý | `work_update_draft` (✨ Viết giúp) | Gửi cập nhật | 1 |
| Trưởng phòng / BLĐ xem nhanh một việc | Tóm tắt 2–3 câu: đang ở đâu, vướng gì, có kịp hạn không | `work_task_brief` | — | 1 |
| Hỏi Trợ lý | "Việc của Hà tuần này", "giao cho Đô …", "tóm tắt việc VW-…214" | công cụ `viec_giao`, `chuan_bi_giao_viec`, `tom_tat_viec` | Giao trên thẻ | 1 |
| Trưởng phòng chốt tuần thứ 7 | Từ số đã chốt → Đánh giá + Giải pháp nháp (4 phần) | `work_week_report` | Chốt tuần | 2 |
| BLĐ sáng thứ 2 | Bản tin + trình chiếu tự dựng từ số đã chốt | bản tin theo lịch (T5) | — | 2 |
| Hỏi số liệu | "Phòng nào trễ nhiều nhất tuần này" → biểu đồ | `bao_cao` loại công việc | — | 2 |
| Cảnh báo nguy cơ trễ | Quy tắc: tiến độ thấp so với thời gian còn lại; AI chỉ giải thích | quy tắc + `work_task_brief` | — | 2 |
| Nói thay gõ | Giọng nói → chữ → các skill trên | Web Speech (thử iPhone) / kết nối chuyển giọng nói | — | 2 |

## 6. Đợt 1 — 4 PR, làm lần lượt (xong PR → lên prod → anh thử → OK mới sang PR sau)

### PR-1 · Nền giao việc + hạ tầng AI (máy chủ, chưa đổi màn)
- Migration: bảng và cột ở mục 4; lệnh `progress_report` trong `command_work_task_collaboration` (người làm đã nhận việc; cập nhật `progress_percent`, `last_progress_at`; có Vướng thì `blocked` + lý do; sự kiện `task.progress_reported`); lệnh `claim_confirm` / `claim_edit` cho việc giao miệng.
- `aiRunId` trên mọi lệnh Work + `ai_gateway_mark_used_v1`.
- 4 RPC đọc gọn ở mục 4. Quyền: chính mình · **trưởng đơn vị theo sơ đồ tổ chức** (câu 1 mục 9) · BLĐ có `work.task.view_scope` global.
- 5 dòng `ai_skills` cho skill Work (tắt, PR-3 bật); `ai_memory_aliases` thêm loại `person`.
- Kiểm: smoke SQL theo 4 vai (nhân viên, trưởng phòng, BLĐ, người ngoài thí điểm) trên Cloud bằng giao dịch rollback; vitest cho kiểu dữ liệu client. App cũ chạy bình thường (chỉ thêm, không đổi chữ ký RPC cũ).

### PR-2 · Giao nhanh + Chi tiết việc (giao diện theo mockup v1)
- Ô **Giao nhanh**: người (kèm tải), hạn Hôm nay / Mai / Thứ 7 / Ngày khác, A/B/C, "+ Chi tiết" (yêu cầu, checklist, thẻ, bằng chứng khi nộp), dòng xem trước "người giao → người làm · hạn"; phạm vi tự suy theo phòng người giao. Dùng lệnh tạo việc sẵn có.
- **Chi tiết việc**: dải người giao → làm → duyệt → hạn; tiến độ + "cập nhật x trước"; ô cập nhật Đã / Đang / Sẽ / Vướng + % một chạm + ảnh / tệp; dòng thời gian gộp (cập nhật, bình luận, nộp, duyệt, trả lại, quá hạn, nhắc); checklist; việc con; bằng chứng; nút theo vai; điện thoại thanh nút không tràn.
- **Việc của tôi**: nhóm Quá hạn / Hôm nay / Tuần này / Chờ xác nhận, vạch màu A/B/C, nút một chạm, "lâu chưa cập nhật".
- **Bật thông báo Work** (câu 4 mục 9): giao, nhận, nộp, duyệt, trả lại, sắp hạn, quá hạn; nhắc 08:00 việc A/B quá 2 ngày chưa cập nhật (câu 2).
- Kiểm: vitest; Playwright desktop + `mobile-safari`; 1440 / 820 / 390 nền sáng.

### PR-3 · AI giao việc + soạn thảo
- Bật 5 skill Work (mục 5, đợt 1) + nút ✨ trên Giao nhanh, Chi tiết việc, Ghi chỉ đạo, ô cập nhật.
- Trợ lý: `viec_giao` (đọc theo người / phòng / trạng thái, theo quyền), `chuan_bi_giao_viec` (thẻ `work_task` → form trong chat → lệnh tạo việc), `tom_tat_viec`.
- Bộ khớp tên + ngày trên máy; chip chọn khi trùng / không chắc; học biệt danh từ việc đã giao.
- Thêm khoảng 15 ca hồi quy model thật vào `scripts/assistant-evals` (theo vai; tên trùng; "thứ 6 tuần sau"; câu ngoài công việc), phải đạt hết trước khi deploy `ai-gateway`.

### PR-4 · Phòng tôi + Toàn công ty + Sổ chỉ đạo
- Trưởng bộ phận: 6 ô số (đúng hạn, quá hạn, lâu chưa cập nhật, chờ tôi duyệt, chưa nhận việc, chỉ đạo BLĐ), bảng người, Chờ tôi duyệt, nhắc.
- BLĐ: theo khối / đơn vị, Sổ chỉ đạo (Trễ / Đang làm / Chờ xác nhận / Xong), phòng → người → việc có Quay lại; đơn vị chưa gán trưởng hiện rõ.
- Ghi chỉ đạo trong họp (thư ký) + ✨ Dán biên bản; việc giao miệng: nhân viên ghi → BLĐ xác nhận / sửa hạn một chạm.
- Trung tâm điều hành: "Việc của tôi" đã gộp Work; thêm nút nhanh "Giao việc".

## 7. Sau Đợt 1

- **Đợt 2 — nhịp tuần + báo cáo** (sau 1–2 tuần có dữ liệu thật): chốt tuần thứ 7 (chụp số tuần, khóa), báo cáo sáng thứ 2 (trình chiếu + PDF), mục tiêu tháng 4 phần; AI `work_week_report`, bản tin thứ 2 tự gửi BLĐ, `bao_cao` loại công việc, cảnh báo nguy cơ trễ, nhập bằng giọng nói.
- **Đợt 3 — KPI + mở rộng**: điểm hiệu suất → KPI kỳ → P3 (sau 1 tháng); Jev nhãn "công việc" (J2); thêm phòng; Zalo OA.

## 8. Thí điểm và đo lường

- 30 người; mốc đánh giá: 1 tuần sau PR-2, rồi sau PR-4.
- Đo: việc giao / ngày; % việc có cập nhật trong 48 giờ; % đúng hạn; số chỉ đạo BLĐ được ghi; tỷ lệ dùng nháp AI theo skill; chi phí AI / người / tháng.
- Hướng dẫn 1 trang (như Trợ lý) gửi nhóm Zalo khi PR-2 lên.
- Chi phí AI ước tính: 30 người × khoảng 6 lượt / ngày × 22 ngày ≈ 4.000 lượt / tháng; nếu toàn bộ chạy Claude Sonnet (0,008 USD / lượt) ≈ 32 USD / tháng, trong trần chung 80 USD; chữ chạy DeepSeek Flash thì thấp hơn nhiều.

## 9. Cần anh chốt

1. Trưởng đơn vị (theo sơ đồ tổ chức) xem được **mọi việc của người trong đơn vị**, trừ việc đánh dấu "hạn chế"? — đề xuất: **có**.
2. **Nhắc 08:00** khi việc A/B quá 2 ngày chưa cập nhật (gửi người làm, sau 1 ngày nữa gửi trưởng phòng); việc C không nhắc? — đề xuất: **có**.
3. AI Vioo Work cho **cả 30 người thí điểm**, 20 lượt / người / ngày, chữ dùng model nhanh, ảnh dùng Claude? — đề xuất: **có**.
4. **Bật thông báo Vioo Work** (trong app + đẩy trên điện thoại) khi PR-2 lên? — đề xuất: **có**.
