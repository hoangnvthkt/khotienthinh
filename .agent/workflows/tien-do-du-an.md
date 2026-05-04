---
description: tien do du an
---

**Task Triển Khai Header Tiến Độ Thi Công**

1. **Chuẩn hóa dữ liệu task tiến độ**
   
   Bổ sung/kiểm tra các field trong `ProjectTask`:
   - `code` hoặc `wbsCode`: mã WBS
   - `plannedStartDate`: nếu hiện đang dùng `startDate` thì giữ là ngày KH
   - `plannedEndDate`: nếu hiện đang dùng `endDate` thì giữ là ngày KH
   - `actualStartDate`
   - `actualEndDate`
   - `unit`
   - `status` nên tính động, không cần lưu cứng

2. **Tách khái niệm kế hoạch và thực tế**
   
   Quy ước:
   - `startDate` = `Bắt đầu kế hoạch`
   - `endDate` = `Kết thúc kế hoạch`
   - `duration` = tự tính từ `startDate/endDate`
   - `actualStartDate/actualEndDate` lấy từ nhật ký thi công đã verified hoặc nhập thủ công nếu chưa có nhật ký
   - `progress` = % tiến độ, theo `manual` hoặc `derived_from_acceptance`

3. **Cập nhật database migration**
   
   Thêm migration cho `project_tasks`:
   - `code text`
   - `actual_start_date date`
   - `actual_end_date date`
   - `unit text` nếu quyết định lưu fallback trên task
   
   Nếu `unit` lấy từ BOQ liên kết thì không cần lưu ở `project_tasks`.

4. **Cập nhật type mapping**
   
   Sửa:
   - `types.ts`
   - `lib/projectService.ts`
   - mapping snake/camel nếu cần
   
   Đảm bảo `fromDb/toDb` map đúng:
   - `actual_start_date` ↔ `actualStartDate`
   - `actual_end_date` ↔ `actualEndDate`

5. **Cập nhật bảng Gantt**
   
   Trong `pages/project/GanttTab.tsx`, đổi header table thành:
   - `STT`
   - `Mã WBS`
   - `Công việc`
   - `Người thực hiện`
   - `Thời gian KH`
   - `Bắt đầu KH`
   - `Kết thúc KH`
   - `Bắt đầu thực tế`
   - `Kết thúc thực tế`
   - `Tiến độ`
   - `Đơn vị`
   - `Trạng thái`

6. **Cập nhật form tạo/sửa công việc**
   
   Thêm field:
   - `Mã WBS`
   - `Bắt đầu thực tế`
   - `Kết thúc thực tế`
   
   Không thêm `Đơn giá/Thành tiền` vào form tiến độ.

7. **Tự động lấy ngày thực tế từ nhật ký**
   
   Logic đề xuất:
   - `actualStartDate`: ngày verified daily log đầu tiên có liên kết task
   - `actualEndDate`: ngày verified daily log cuối cùng hoặc ngày task được gate approved
   - Nếu user nhập tay thì ưu tiên manual override hoặc hiển thị cảnh báo nguồn dữ liệu

8. **Hiển thị đơn vị**
   
   Ưu tiên:
   - Nếu task liên kết 1 BOQ item: lấy `unit` từ BOQ
   - Nếu liên kết nhiều BOQ item: hiển thị `Nhiều ĐV` hoặc tooltip danh sách
   - Nếu không liên kết BOQ: `-`

9. **Cập nhật import/export Excel**
   
   Import Excel nhận các cột mới:
   - `Mã WBS`
   - `Bắt đầu KH`
   - `Kết thúc KH`
   - `Bắt đầu thực tế`
   - `Kết thúc thực tế`
   - `Người thực hiện`
   - `Công việc cha`
   - `Đơn vị` chỉ dùng fallback nếu chưa có BOQ
   
   Export Excel dùng đúng header mới.

10. **Kiểm tra**
   
   Chạy:
   ```bash
   npx tsc --noEmit
   npm run build
   npm run smoke:project
   ```

**Ưu tiên triển khai**
Làm theo 3 pha:

1. Pha 1: UI header + type + migration tối thiểu.
2. Pha 2: actual dates tự động từ nhật ký verified.
3. Pha 3: import/export Excel và đơn vị từ BOQ tooltip.