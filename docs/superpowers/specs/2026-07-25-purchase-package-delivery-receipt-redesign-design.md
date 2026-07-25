# Cai tien quy trinh Goi mua hang, dot giao va nhan kho

Ngay: 2026-07-25

Trang thai: Da thong nhat nghiep vu, cho review tai lieu

Pham vi: MR, Goi mua hang, phe duyet chu truong, dot giao, WMS/QR, nhan kho, chi phi vat tu, cong no NCC va thanh toan.

Tai lieu nay la dac ta uu tien cho quy trinh mua hang theo MR. No thay the cac
diem khong con phu hop trong tai lieu ngay 2026-07-23, dac biet la thao tac
thu cong **Tao WMS/QR**, viec bat buoc nguoi dung lap lich giao khi tao PO, va
viec dung thanh toan lam thoi diem ghi nhan chi phi.

## 1. Muc tieu

1. Giu du chieu sau du lieu de truy vet MR, chu truong mua, tung lan mua,
   thuc nhan, chi phi va cong no.
2. Toi uu cho truong hop pho bien: mot don mua mot lan va giao mot lan.
3. Van ho tro truong hop sat thep mua, giao va thay doi gia theo nhieu dot.
4. Cong truong chi can theo doi nhu cau goc, thuc nhan dat chat luong va phan
   du/thieu; khong phai van hanh cac lop ke hoach mua.
5. Khong dung chenh lech so luong/gia tri lam khoa cung. He thong canh bao,
   ghi ly do va luu audit nhung van cho phep nghiep vu tiep tuc.
6. Khi xac nhan nhap kho, ton kho, chi phi, MR, Goi mua hang va cong no phai
   cap nhat nguyen tu, khong de trang thai do dang.

## 2. Nguyen tac hoc tu thuong mai dien tu

Vioo ap dung cau truc cua mot Order Management System nhung dieu chinh cho
nghiep vu mua hang xay dung:

| Thuong mai dien tu | Vioo | Trach nhiem |
| --- | --- | --- |
| Customer demand | MR | Nhu cau goc cua cong truong |
| Order | Goi mua hang | Moc khoi luong, gia va gia tri chu truong |
| Fulfillment | Dot giao | Lan cam ket mua/giao thuc te co gia rieng |
| Shipment/receipt | WMS/QR | Kiem nhan va nhap kho vat ly |
| Return/refund | Dieu chinh/hoan NCC | Nghiep vu dao sau khi da nhap |
| Payment state | Cong no/thanh toan | Nghia vu NCC va dong tien |

Bon nguyen tac duoc giu:

- Don hang thuong mai, thuc hien vat ly va tai chinh co trang thai doc lap.
- Moi lan giao co danh tinh rieng; QR khong dai dien cho toan bo Goi mua hang.
- He thong tu tao cac doi tuong van hanh pho bien, nguoi dung chi lam viec
  tiep theo can thiet.
- Giao thieu, giao du va hoan hang la su kien phat sinh; khong ghi de duong
  co so da duoc duyet.

Vioo khac thuong mai dien tu o hai diem:

- Goi mua hang la chung tu phe duyet chu truong noi bo, khong phai hoa don ban
  hang.
- Chi phi du an duoc ghi nhan ngay khi nhap kho hoac nhan giao thang, bao gom
  VAT, theo chinh sach quan tri cua doanh nghiep.

## 3. Thuat ngu va mo hinh nghiep vu

### 3.1. MR

MR la nhu cau goc cua cong truong. MR luu:

- vat tu va khoi luong yeu cau;
- kho nhan, ngay can;
- cong viec, BOQ va khoan muc chi phi lien quan;
- ly do ngoai dinh muc/vuot dinh muc neu co.

MR khong chua gia mua thuc te, hoa don hoac cong no NCC. Khoi luong MR la duong
co so tham chieu, khong phai tran chan giao dich.

### 3.2. Goi mua hang

Goi mua hang lay du lieu tu MR va la chung tu gui lanh dao duyet chu truong.
Ma hien thi vi du `PO01`.

Goi luu:

- khoi luong tham chieu;
- don gia tham chieu;
- VAT tham chieu;
- gia tri chu truong gom VAT;
- NCC mac dinh neu da biet;
- kho nhan va ngay du kien;
- cach dat hang `single` hoac `multiple`;
- nguon MR, du an, cong truong, BOQ va khoan muc chi phi.

Goi mua hang khong truc tiep lam tang ton kho, chi phi hoac cong no. Goi chi
duoc gui lanh dao duyet mot lan. Cac dot giao sau do khong gui duyet lai.

### 3.3. Dot giao

Dot giao la lan mua/giao thuc te nam duoi Goi mua hang. Ma dot duoc sinh theo
Goi, vi du `PO01-01`, `PO01-02`.

Moi dot luu snapshot:

- NCC;
- vat tu va khoi luong cua dot;
- don gia thuc te;
- VAT;
- kho nhan;
- ngay giao du kien, co the de trong;
- ghi chu/dieu khoan;
- WMS transaction va QR duy nhat;
- khoi luong thuc nhan dat chat luong;
- ly do chenh lech va chung tu thuc nhan.

Gia va khoi luong tai dot giao la co so thuc te de tinh chi phi tam tinh va
cong no. Gia tham chieu cua Goi khong ghi de gia dot giao.

### 3.4. WMS/QR

Moi dot giao co toi da mot WMS nhap kho dang hieu luc va mot QR dan den WMS
do. WMS/QR duoc tao tu dong cung giao dich tao dot giao. Khong co nut rieng
**Tao WMS** hoac **Tao QR**.

### 3.5. Cong no va thanh toan

Moi lan nhap kho tao mot phat sinh cong no theo NCC va cong trinh. Module tai
chinh hien huu tiep tuc tong hop nhieu phat sinh, nhieu Goi va nhieu dot giao
cua cung NCC de thanh toan mot lan hoac nhieu lan.

## 4. Luong mac dinh: mua va giao mot lan

Day la luong mac dinh vi chiem da so don hang.

1. Cong truong tao va gui duyet MR.
2. Bo phan mua hang tao Goi mua hang tu MR.
3. Form mac dinh cach dat hang la **Mua va giao mot lan**.
4. Nguoi mua nhap NCC, gia tham chieu/thuc te du kien, VAT, kho nhan, ngay
   giao neu biet va gui lanh dao duyet.
5. Khi Goi duoc duyet, he thong tu dong va nguyen tu:
   - tao dot `POxx-01` bang toan bo khoi luong Goi;
   - sao chep NCC, gia, VAT va kho nhan cua Goi xuong dot;
   - tao WMS nhap kho trang thai cho nhan;
   - sinh QR cua dot;
   - chuyen Goi sang trang thai cho giao.
6. Thu kho quet QR, Duyet SL/CL va Xac nhan nhap kho tren cung mot man hinh.
7. He thong ghi ton kho, chi phi gom VAT va cong no NCC.

Sau khi Goi duoc duyet, nguoi mua duoc sua NCC, gia, VAT, ngay giao va ghi chu
cua dot truoc khi Duyet SL/CL. Moi thay doi duoc audit va hien canh bao chenh
so voi chu truong, khong tao vong duyet lanh dao moi.

## 5. Luong nang cao: chia nhieu dot

Lua chon **Chia nhieu dot** chi dung khi can, chu yeu cho sat thep.

1. Goi van duoc duyet mot lan theo khoi luong va gia tri tham chieu tong.
2. He thong khong tu tao mot dot bang toan bo khoi luong.
3. Bo phan mua hang tao `POxx-01`, `POxx-02`... theo tung lan chot mua.
4. Moi dot co khoi luong, gia, VAT, NCC va ngay giao rieng.
5. Ngay giao co the de trong neu chua biet lich.
6. Luu dot thanh cong tu dong tao WMS va QR cua dot do.
7. Tong khoi luong/gia tri cac dot co the thap hon, bang hoac cao hon Goi.
   He thong canh bao, khong khoa luu va khong yeu cau duyet bo sung.

Neu ban dau du kien giao mot lan nhung NCC giao tung phan:

- ket thuc dot dau theo so thuc nhan;
- tao dot tiep theo cho phan con lai;
- neu cung don gia, cho phep sao chep nhanh NCC, gia, VAT va kho tu dot truoc;
- neu khac don gia, nhap gia moi tren dot tiep theo.

Moi dot giao chi co mot lan nhan vat ly/WMS hieu luc. Khong phan bo so nhan
cua mot QR vao tat ca cac dot dang mo cua Goi.

## 6. Luong Duyet SL/CL va Xac nhan nhap

Chi can vai tro **Thu kho cong truong**. Van giu hai moc nghiep vu nhung nam
tren cung mot man hinh:

### Buoc 1: Duyet SL/CL

Thu kho nhap:

- khoi luong thuc nhan dat chat luong;
- ket qua kiem tra chat luong;
- ly do chenh lech neu so nhan khac so cua dot;
- phieu can, bien ban, hinh anh hoac tep chung minh.

Khi bam **Duyet SL/CL**:

- he thong kiem tra quyen, trang thai va tinh toan ven;
- luu so thuc nhan va chenh lech;
- khoa so lieu va tep chung minh;
- ghi nguoi duyet va thoi gian;
- hien ngay ban tom tat de thu kho tiep tuc.

### Buoc 2: Xac nhan nhap kho

Cung thu kho bam **Xac nhan nhap kho** tren man hinh dang mo. He thong thuc
hien mot RPC/giao dich nguyen tu:

1. post WMS va tang ton kho neu la hang nhap kho;
2. cap nhat thuc nhan cua dot;
3. cap nhat tong thuc nhan cua Goi va MR;
4. tao giao dich chi phi du an gom VAT;
5. tao/cap nhat phat sinh cong no NCC gom VAT;
6. cap nhat trang thai lien quan;
7. ghi audit va document trace.

Khong dong modal roi mo lai giua hai buoc. Khong cho phep sua so luong da
Duyet SL/CL; sai sot sau do dung chung tu dieu chinh/dao phu hop.

## 7. Chat luong khong dat

Thu kho chi nhap kho phan dat chat luong.

Vi du dot giao 100, chi 90 dat:

- thuc nhan va nhap kho: 90;
- chenh lech so voi dot: -10;
- chi phi va cong no: tinh tren 90;
- 10 khong dat khong vao ton kho;
- khong tao de nghi tra NCC va khong tao WMS xuat tra.

Dot va Goi hien trang thai nhan thieu. Phan nhu cau con thieu co the duoc dap
ung boi dot sau hoac duoc nguoi mua ket thuc thieu voi ly do.

Chi khi hang da duoc xac nhan nhap kho, sau do moi phat sinh tra NCC, he thong
moi tao chung tu dao: giam ton, giam chi phi va giam cong no/ghi khoan can tru.

## 8. Quy tac so luong, gia tri va canh bao

He thong luu va hien ro ba mau so:

### Theo MR/Goi

```text
need_qty = khoi luong nhu cau goc
received_net_qty = tong thuc nhan da nhap - tong tra sau nhap
need_variance_qty = received_net_qty - need_qty
remaining_need_qty = max(0, need_qty - received_net_qty - closed_need_qty)
```

### Theo cac dot giao

```text
released_qty = tong khoi luong cac dot dang hieu luc
released_variance_qty = released_qty - package_reference_qty
actual_received_qty = tong thuc nhan da nhap cua cac dot
```

### Theo gia tri

```text
package_reference_gross =
  package_reference_qty * package_reference_unit_price * (1 + reference_vat)

released_gross =
  tong(batch_qty * batch_unit_price * (1 + batch_vat))

received_gross =
  tong(accepted_received_qty * batch_unit_price * (1 + batch_vat))
```

Canh bao gom:

- tong dot vuot khoi luong Goi;
- gia tri cac dot vuot gia tri chu truong;
- thuc nhan dot du/thieu so voi dot;
- tong thuc nhan du/thieu so voi MR/Goi;
- gia hoa don chenh so voi gia tri cong no tam tinh.

Canh bao khong khoa tao dot, Duyet SL/CL hoac Xac nhan nhap. Cac rang buoc
toan ven van bat buoc: khong so am, khong vat tu la, khong QR trung, khong post
hai lan va khong sua chung tu da khoa.

## 9. Trang thai va phep chieu giao dien

### 9.1. Goi mua hang

Trang thai du lieu:

- `draft`;
- `pending_approval`;
- `approved`;
- `waiting_delivery`;
- `partially_received`;
- `fulfilled`;
- `over_received`;
- `closed_short`;
- `cancelled`.

Trang thai duoc suy ra tu chung tu va so lieu khi co the; khong bat nguoi dung
cap nhat bang tay.

### 9.2. Dot giao

- `waiting_delivery`;
- `receiving`;
- `quality_approved`;
- `received`;
- `received_short`;
- `received_over`;
- `cancelled`.

### 9.3. Man hinh cong truong

Cong truong khong can xem toan bo trang thai mua hang. Chi hien:

- nhu cau goc;
- da thuc nhan rong;
- con thieu hoac du;
- lan nhan gan nhat;
- trang thai `Cho hang`, `Da nhan mot phan`, `Da dap ung`, `Da nhan du`.

## 10. Vai tro va quyen

| Vai tro | Trach nhiem |
| --- | --- |
| Cong truong/nguoi de xuat | Tao MR, theo doi nhu cau va thuc nhan |
| Nguoi duyet MR | Duyet nhu cau theo workflow hien huu |
| Bo phan mua hang | Tao Goi, chon cach mua, tao/sua/huy dot truoc khi nhan |
| Lanh dao | Duyet Goi mua hang mot lan |
| Thu kho cong truong | Duyet SL/CL va Xac nhan nhap tren cung man hinh |
| Ke toan/tai chinh | Bo sung hoa don, doi soat, thanh toan va dao thanh toan |

Lanh dao khong duyet lai dot giao. Thu kho khong sua gia mua. Bo phan mua hang
khong sua thuc nhan sau Duyet SL/CL.

## 11. Chi phi, cong no va hoa don

### 11.1. Chi phi

Chi phi duoc ghi nhan khi Xac nhan nhap kho hoac Xac nhan nhan hang giao
thang:

```text
material_cost =
  accepted_received_qty * batch_unit_price * (1 + batch_vat)
```

- Hang nhap kho: vua tang ton kho van hanh, vua ghi chi phi du an.
- Hang giao thang: khong tang ton, van ghi chi phi du an.
- Thanh toan NCC khong tao chi phi lan hai.
- Tra hang sau nhap tao giao dich dao giam chi phi gom VAT.

Giao dich chi phi ke thua du an, cong truong, BOQ/khoan muc chi phi va vat tu
tu MR/Goi; khong de `cost_item` trong neu nguon MR da co mapping.

### 11.2. Cong no NCC

Moi lan nhan thanh cong tao/cap nhat mot phat sinh idempotent theo nguon
dot/WMS. So tien gom VAT va dung NCC snapshot cua dot.

Module tai chinh hien huu:

- tong hop nhieu phat sinh cua cung NCC trong cung cong trinh;
- cho phep thanh toan nhieu don trong mot dot;
- cho phep mot cong no duoc thanh toan nhieu dot;
- theo doi tong phat sinh, da tra va con phai tra;
- giu allocation va duong dao thanh toan hien huu.

Khong con nut **Tao cong no NCC** tren PO/Goi. Xac nhan nhap kho la nguon tao
cong no tu dong.

### 11.3. Hoa don

Hoa don den sau duoc gan vao mot hoac nhieu phat sinh cung NCC. Ke toan bo sung:

- so va ngay hoa don;
- file chung tu;
- gia tri truoc thue, VAT va tong thanh toan;
- chenh lech voi cong no tam tinh.

So hoa don phai duy nhat trong pham vi NCC. Chenh lech hoa don tao dieu chinh
chi phi/cong no, khong sua nguoc WMS hoac thuc nhan.

## 12. Yeu cau du lieu va kien truc

Huong trien khai uu tien tan dung cac thuc the hien huu:

- `requests` tiep tuc la MR;
- `purchase_orders` duoc trinh bay va van hanh nhu Goi mua hang;
- `purchase_order_delivery_batches/lines` la dot giao co gia thuc te;
- `transactions` la WMS/QR;
- `supplier_payable_documents/allocations/payment_batches` tiep tuc la cong
  no va thanh toan;
- `project_transactions` nhan giao dich chi phi tu receipt.

Can bo sung/chuan hoa:

- `purchase_mode = single | multiple` tren Goi;
- gia tri tham chieu gom VAT tach biet voi tong gia tri dot;
- NCC snapshot va WMS transaction duy nhat tren dot;
- metadata `orderedQty`, `acceptedQty`, `varianceQty`, `varianceReason`;
- source reference duy nhat cho giao dich chi phi va phat sinh cong no;
- lien ket trace MR -> Goi -> Dot -> WMS -> Chi phi/Cong no -> Thanh toan.

Moi command nghiep vu quan trong dung RPC/server transaction:

1. `approve_purchase_package_and_prepare_single_batch`;
2. `create_delivery_batch_with_wms_qr`;
3. `approve_receipt_quality`;
4. `finalize_purchase_receipt`;
5. `cancel_unreceived_delivery_batch`.

Ten ham cu the co the dieu chinh khi trien khai, nhung ranh gioi giao dich la
bat buoc.

## 13. Giao dien can thay doi

### MR

- Doi nhan `Tao dot cap / PO` thanh trang thai tong quat `Cho mua/cap hang`.
- Hien nhu cau goc, thuc nhan rong va du/thieu.
- An gia, lich dot va cong no khoi giao dien cong truong mac dinh.

### Goi mua hang

- Form lay san du lieu MR.
- Dieu khien cach dat hang mac dinh **Mua va giao mot lan**.
- **Chia nhieu dot** la tuy chon nang cao.
- Tach ro khoi luong/gia tri chu truong va tong thuc te cac dot.
- Canh bao vuot khong dung ngon ngu loi hoac khoa luu.

### Dot giao

- Tao dot la mot command duy nhat, tra ve ngay QR.
- Khong hien nut Tao WMS, Tao QR hoac gui duyet dot.
- Hien dat theo dot, thuc nhan, chenh lech va gia tri gom VAT.

### WMS/QR

- QR mo dung dot giao.
- Duyet SL/CL va Xac nhan nhap nam tren cung modal/workspace.
- Sau Duyet SL/CL, hien tom tat da khoa va nut Xac nhan nhap ngay.

### Tai chinh

- Giu man tong hop cong no theo NCC hien huu.
- Tu dong nhan phat sinh tu receipt.
- Cho truy nguoc den Goi, dot va WMS.
- Thanh toan khong sinh them expense.

## 14. Loi, huy va tinh nguyen tu

- Tao dot, WMS va QR la mot giao dich. Loi o bat ky buoc nao thi khong de dot
  hoac WMS mo coi.
- Command tao dot co idempotency key; bam lai tra ve cung dot/WMS/QR.
- Unique guard ngan hai WMS hieu luc cho cung mot dot.
- Huy dot truoc Duyet SL/CL tu dong huy WMS/QR va giai phong tong dot.
- Sau Duyet SL/CL, dot khong duoc xoa/sua; dung nghiep vu dao.
- Xac nhan nhap khoa WMS/dot, cap nhat ton, MR, Goi, chi phi va cong no trong
  cung mot transaction.
- Quy doi don vi mua/ton dung snapshot va ham chuan; khong cong truc tiep kg
  vao so cay/cuon.
- So luong la numeric, khong ep integer; cho phep so thap phan.
- QR va command nhan luon mang `delivery_batch_id`, khong suy dien theo toan PO.

## 15. Chuyen doi du lieu hien huu

1. Giu nguyen ID va ma PO cu; tren giao dien, PO tu MR duoc goi la Goi mua hang.
2. Dot giao hien huu duoc chuan hoa thanh dot cua Goi, khong tao ban sao.
3. Goi dang hoat dong khong co dot khong bi tu dong tao dot khi migrate; nguoi
   mua chon tao dot mac dinh de tranh sinh WMS ngoai y muon.
4. Legacy delivery groups chi con phuc vu doc/trace trong giai doan chuyen doi;
   moi command chi ghi vao delivery batches chuan.
5. Cong no va thanh toan cu giu nguyen. Receipt moi chi ghi qua mot co che
   idempotent, khong tao trung AP hien huu.
6. Chay doi soat va gan co cac ban ghi: WMS completed nhung dot chua received,
   PO delivered/partial chua co cong no, status thanh toan PO lech AP.

## 16. Lo trinh trien khai

### Giai doan 0: Sua tinh dung du lieu

- QR theo dung dot;
- dong bo receipt mua chu dong;
- quy doi don vi va decimal;
- command finalize receipt nguyen tu;
- AP tu dong dong bo theo receipt/return.

### Giai doan 1: Goi mua hang va luong mot lan

- doi ngu nghia PO tu MR thanh Goi;
- them `purchase_mode`;
- auto dot + WMS + QR khi Goi single duoc duyet;
- bo nut Tao WMS/QR thu cong.

### Giai doan 2: Nhan hang mot man hinh

- Duyet SL/CL va Xac nhan nhap lien tiep;
- khoa du lieu sau buoc dau;
- ho tro chung tu, chenh lech va chat luong khong dat.

### Giai doan 3: Tai chinh

- ghi chi phi gom VAT khi receipt;
- tu dong tao cong no theo NCC;
- ngan thanh toan ghi chi phi trung;
- bo sung trace va doi soat hoa don.

### Giai doan 4: Don legacy va bao cao

- ngung ghi delivery groups cu;
- doi soat/backfill trang thai;
- bao cao Goi, dot, receipt, chi phi va cong no theo cung mot nguon.

## 17. Tieu chi nghiem thu

1. MR 1.000 kg tao Goi 1.000 kg va gui lanh dao duyet mot lan.
2. Goi `single` duoc duyet tu sinh `POxx-01`, WMS va QR ma khong co thao tac
   thu cong bo sung.
3. Goi `multiple` khong tu sinh dot tong; moi dot tao sau do tu sinh WMS/QR.
4. Dot co the co gia va VAT khac gia tham chieu ma khong can duyet lai.
5. Tong dot 1.010 kg tren Goi 1.000 kg luu thanh cong va canh bao +10 kg.
6. QR chi ghi nhan cho dung dot, khong phan bo vao cac dot dang mo khac.
7. Thu kho Duyet SL/CL va Xac nhan nhap tren cung man hinh, cung vai tro.
8. Dot 100 nhung chi 90 dat chat luong chi nhap, ghi chi phi va cong no tren
   90; khong tao phieu tra NCC cho 10 khong dat.
9. Xac nhan nhap tao chi phi gom VAT va phat sinh cong no dung mot lan.
10. Nhieu Goi/dot cua cung NCC duoc module tai chinh tong hop va thanh toan
    mot lan hoac nhieu lan.
11. Thanh toan khong tao expense vat tu lan hai.
12. Tra NCC sau nhap dao ton, chi phi va cong no dung mot lan.
13. Mua theo don vi cay/cuon va nhan theo kg quy doi dung ca ton, chi phi va
    cong no.
14. Tao/huy dot, Duyet SL/CL va finalize receipt co test concurrency,
    idempotency va rollback.
15. Du lieu cu van xem va truy vet duoc; migration khong tao WMS, chi phi hoac
    cong no ngoai y muon.

## 18. Ngoai pham vi

- Khong thay doi workflow duyet MR hien huu ngoai viec doi nhan trang thai.
- Khong xay lai man cong no/thanh toan theo NCC; chi tich hop nguon receipt.
- Khong tu dong chuyen tien hoac doi soat sao ke ngan hang.
- Khong tao de nghi tra NCC cho hang bi loai ngay tai Duyet SL/CL.
- Khong bat buoc lap nhieu dot cho tat ca vat tu.
- Khong dung chenh lech de tu dong sua khoi luong MR/Goi da duyet.
