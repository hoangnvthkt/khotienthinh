# Header bảo mật HTTP + Tailwind build-time (audit 20/10/2026, mục S4 + S5)

Trước PR này, bản prod trên Vercel chỉ có `Strict-Transport-Security` (Vercel tự thêm); không có CSP, X-Frame-Options,
nosniff, Referrer-Policy, Permissions-Policy. `index.html` tải Tailwind Play CDN (JIT trong trình duyệt, ~110 KB JS,
không khóa phiên bản, không SRI) và còn `importmap` trỏ `esm.sh` dù Vite đã bundle.

## 1. Header đang bật (`vercel.json`)

| Header | Giá trị | Mục đích |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | không đoán MIME |
| `X-Frame-Options` | `SAMEORIGIN` | chống clickjacking; vẫn cho khung nội bộ cùng nguồn |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | không lộ đường dẫn (mã phiếu, id) sang site khác |
| `Permissions-Policy` | `camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()` | chỉ app dùng camera/GPS/mic (chấm công, chụp phiếu, gọi) |
| `Content-Security-Policy` (**thực thi**) | `frame-ancestors 'self'; object-src 'none'; base-uri 'self'` | phần chắc chắn không gây vỡ |
| `Content-Security-Policy-Report-Only` (**chỉ báo**) | xem mục 2 | chạy thử trước khi thực thi |
| `/assets/*` `Cache-Control` | `public, max-age=31536000, immutable` | file đã hash, cache 1 năm |
| `/sw.js` `Cache-Control` | `no-cache` | service worker luôn kiểm bản mới |

## 2. CSP đầy đủ — đang ở chế độ Report-Only

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com;
img-src 'self' data: blob: https:;
media-src 'self' blob: https://*.supabase.co;
connect-src 'self' https://*.supabase.co wss://*.supabase.co;
worker-src 'self' blob:;
frame-src 'self' blob: https://*.supabase.co https://drive.google.com https://hoangnv.synology.me:5001;
manifest-src 'self'; form-action 'self'; upgrade-insecure-requests
```

Nguồn đã kiểm kê trong mã client: Supabase (REST, Realtime, Storage, Edge Functions), Google Fonts, ảnh bản đồ
`tile.openstreetmap.org` (trong `https:`), PDF xem bằng iframe `blob:`/URL ký Supabase, Kho dữ liệu nhúng Google Drive và
Synology, worker pdf.js là asset nội bộ (`?url`), không còn script inline nào trong `index.html`. AI gọi qua Edge Function,
không gọi thẳng từ trình duyệt.

**Cách bật thực thi (PR sau):** mở app trên prod bằng Chrome, bật Console, đi qua các màn: đăng nhập, Trung tâm, Kho (chụp
phiếu giao), Quy trình (in phiếu, xem PDF đính kèm), Dự án (3D công trường, nhật ký ảnh), Nhân sự (chấm công camera + GPS),
Kho dữ liệu, Chat (gọi). Nếu **không** có dòng `[Report Only] Refused to …` thì đổi header `Content-Security-Policy` thành
chuỗi ở mục 2 và bỏ header Report-Only. Nếu có, thêm nguồn bị chặn vào directive tương ứng trước.

## 3. Tailwind biên dịch lúc build

- `tailwind.config.js`: chép nguyên khối `tailwind.config` inline cũ (darkMode `class`, màu mint/leaf/semantic, keyframes,
  animation); `content` quét `pages/components/context/hooks/lib/routes/constants` + `index.html`; `safelist` cho class
  ghép lúc chạy ở `pages/Settings.tsx` (`bg-${color}-50/200/600`, 7 màu).
- `tailwind.css` (`@tailwind base/components/utilities`) link ở **cuối** `<head>`, sau `index.css` và khối `<style>` inline,
  vì Play CDN cũ chèn `<style>` vào cuối `<head>` → thứ tự ghi đè giữa utility và CSS tự viết không đổi. Vite gộp thành
  một `assets/index-*.css` giữ đúng thứ tự.
- Kích thước: CSS 460 KB raw / **65 KB gzip** (thay ~110 KB gzip JS CDN + biên dịch CSS mỗi lần mở trang, hết nháy giao
  diện lúc tải). `postcss.config.js` thêm autoprefixer.

**Kiểm chứng tương đương (20/10):** trên prod (đã đăng nhập) đi qua 9 màn (Trang chủ, Kho, Quy trình, Chấm công, Tài chính,
Mua hàng, Dự án, Cài đặt, Trung tâm), gom **901 selector** mà CDN sinh ra; nạp CSS build mới và đối chiếu: 891 trùng tên,
10 còn lại gồm 8 selector preflight (CSSOM in khác cách gộp, nội dung có trong build) và 2 biến thể `active:scale-95`,
`group-hover/header:opacity-100` có trong file build (grep) nhưng CSSOM in khác. Không thiếu utility nào.

## 4. Cách kiểm sau khi deploy

```bash
curl -sI https://khotienthinh.vercel.app | grep -iE 'content-security|x-frame|x-content|referrer|permissions'
curl -s https://khotienthinh.vercel.app | grep -c 'cdn.tailwindcss'   # 0
```
