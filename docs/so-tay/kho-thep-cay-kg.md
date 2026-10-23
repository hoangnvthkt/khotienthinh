---
title: Mua theo kg, kho tính theo cây (đơn vị khác nhau)
module: Mua hàng
routes: /procurement|Mua hàng;/material-code-requests|Danh mục vật tư
keywords: thep cay kg don vi mua don vi kho quy doi he so quy doi mua theo don vi khac kg cay tan thep d16 thep hinh sl mua sl kho dvt dv mua
questions: Thép mua theo kg mà kho tính cây thì làm sao? | quy đổi kg sang cây | đơn vị mua khác đơn vị kho | NCC báo giá theo tấn | sửa hệ số quy đổi vật tư | phiếu giao ghi kg mà đơn tính cây
permission: Lập đơn: Mua hàng · Quản trị; đổi hệ số: Danh mục kho · Sửa mã vật tư
---
**Khi nào:** NCC bán theo kg / tấn nhưng kho theo dõi theo cây (hoặc ngược lại).
**Các bước:**
1. Lập đơn: ở dòng vật tư bấm **+ Mua theo đơn vị khác** (đơn từ Cần mua ghi thêm "VD kg ↔ cây").
2. Nhập **SL mua** và **ĐV mua** (VD kg); **Đơn giá** tính theo đơn vị mua. Dòng hiện **SL kho** (cây) và "1 kg = … cây".
3. SL mua tự quy đổi theo hệ số của mã; cân thực tế khác thì gõ tay, bấm **Tự quy đổi** để về số tính sẵn.
4. Thủ kho nhận bằng phiếu chụp: dòng ghi "đơn tính theo …" khi phiếu khác đơn vị với đơn → nhập số theo đơn vị của đơn.
**Không làm được?**
- Lưu đơn báo SL hoặc đơn giá chưa hợp lệ → kiểm ô SL mua / ĐV mua của dòng đổi đơn vị.
- Hệ số của mã sai → người có quyền Sửa mã vật tư mở mã ở Danh mục vật tư → **Sửa** ô **ĐV mua** và **1 ĐV mua = ? ĐVT kho** (ghi lý do).
- Báo "Mã đã có chứng từ nên không đổi được đơn vị tính kho" → giữ ĐVT kho, chỉ đổi đơn vị mua / hệ số.
**Lưu ý:**
- Báo giá (Excel / chụp) ghi cả số cây và kg không khớp hệ số: đơn giữ SL mua theo báo giá để tiền đúng.
