---
description: Thành phần của 1 dự án
---

1. Hiện tại bây giờ Dự án đang được lấy từ Dữ liệu gốc HRM - Công trường. 
Theo anh nên tách hẳn Dự án ra, vì dự án có thể là có công trường hoặc không, Em tạo thêm 1 dòng liên kết với công trường hiện có 

2. Thành phần của 1 dự án:
 2.1. Tổng giám đốc 
 2.2. Giám đốc dự án
 2.3. Giám đốc vật tư
 2.4. Chỉ huy trưởng công trình
 2.5. Chỉ huy phó công trình
 2.6. Kỹ thuật trưởng
 2.7. Nhân viên kỹ thuật, QS, QC, trắc đạc
 2.8. Nhân viên kế toán
 2.9. Nhân viên thủ kho
 2.10. Bảo vệ nội bộ

2.11. Tạo 1 Tab mới vị trí đầu tiên tại module Dự án , Thể hiện phân bổ vị trí các thành viên phân cấp chức vụ theo dạng tree, Lấy avatar nhân viên làm đại diện cho nhân viên khi được tag vào vị trí, có thể kéo thả vị trí và avartar.
2.12. Tất cả các vị trí đều là tuỳ chọn và không bắt buộc vì mỗi công trường sẽ có các vị trí công việc khác nhau, CRUD các vị trí
2.13. Mỗi 1 vị trí cũng sẽ được tạo những quyền riêng tuỳ chỉnh: Ví dụ: Tại công trường A, không có kỹ thuật trưởng vì vậy nhân viên kỹ thuật có quyền verifed các kết quả, yêu cầu, và cả confirm. Nhưng tại công trường B có kỹ thuật trưởng thì nhân viên kỹ thuật chỉ có quyền verifed các kết quả, yêu cầu, còn confirm là việc của kỹ thuật trưởng.
Anh nói để em hiểu tổng quan là: Công trường , dự án có vị trí, các vị trí này sẽ được tạo lần đầu bởi  list tại mục số 2. , Mỗi vị trí sẽ có các quyền nghiệp vụ tuỳ chỉnh linh hoạt theo từng thời điểm, từng công trường .
2.14. Nhân viên có quyền verifed kết quả, yêu cầu, 
- Các thành phần kỹ thuật trưởng phó ,chỉ huy confirm, Giám đốc duyệt đồng thời. Tất cả khi gửi yêu cầu đều có thể tag trực tiếp hoặc tag theo vị trí
