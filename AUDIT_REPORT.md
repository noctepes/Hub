# Báo cáo Audit toàn bộ dự án Hub
**Ngày:** 03/07/2026 · **Phạm vi:** 21 file dự án (12 tool HTML, scan.js, 2 file .command, 4 ảnh, .gitignore, 1 file .bak). Lưu ý: con số 65 file bạn nhắc đến bao gồm cả file nội bộ của thư mục `.git` — code thực tế chỉ có 21 file.

**Kết quả tổng quan:** Toàn bộ inline JS **không có lỗi cú pháp**, mọi link/ảnh nội bộ đều tồn tại, mọi element ID được JS tham chiếu đều có trong HTML. Tuy nhiên có **2 lỗi nghiêm trọng về bảo mật** và **một số bug logic gây mất dữ liệu** cần sửa trước khi đưa lên online.

---

## 🔴 NGHIÊM TRỌNG — phải sửa trước khi chạy online

### 1. Firestore không có xác thực (Banner_Tracker.html + Tasks_Tracking.html)
Cả 2 app dùng Firebase config hardcode và **không hề gọi `firebase.auth()`**. Nghĩa là security rules đang mở (`allow read, write: if true`):
- Bất kỳ ai biết project ID (nằm ngay trong source) có thể **đọc / sửa / xóa toàn bộ dữ liệu** của mọi account qua REST API, không cần mở app.
- Có thể bị lạm dụng quota → tốn tiền hoặc hết free-tier.
- **Khắc phục:** bật Anonymous Auth (1 dòng với compat SDK), viết rules giới hạn theo `request.auth.uid`, giới hạn API key theo HTTP referrer trong Google Cloud Console, bật App Check.

### 2. Stored XSS trong Tasks_Tracking.html (dòng 1110–1149)
`renderTable()` chèn `task.taskName`, `task.jobNumber`, `task.id` vào `innerHTML` **không escape**. Vì dữ liệu load từ Firestore (đang world-writable), kẻ xấu có thể ghi task name độc hại → **chạy script trên trình duyệt của bạn** khi mở app. Đây là XSS từ xa, không phải self-XSS.
- **Khắc phục:** thêm hàm `esc()` (như Banner_Tracker đã có) cho mọi giá trị, bỏ inline `onchange="updateTask(${id}...)"` → dùng `data-id` + event delegation.

---

## 🟠 BUG GÂY MẤT / HỎNG DỮ LIỆU

| # | File | Lỗi | Vị trí |
|---|------|-----|--------|
| 1 | Banner_Tracker | **Rename ngôn ngữ/sản phẩm làm hỏng dữ liệu**: `renameLang/renameProd` không gọi `render()` → các input còn giữ `data-lang` cũ, giá trị nhập sau đó ghi vào "ghost key" rồi biến mất; kèm TypeError ở dòng 2043 | 2169–2205 |
| 2 | Banner_Tracker | **Thêm/xóa ngôn ngữ, sản phẩm không được lưu** (không gọi `schedSave()`) → reload là mất | 2207–2255 |
| 3 | Banner_Tracker | **Đổi job rồi bấm Save sẽ ghi đè job mới bằng dữ liệu job cũ** — `switchJob` không load dữ liệu job được chọn, save là full-doc `set()` không merge | 2514, 2585 |
| 4 | Tasks_Tracking | **Báo "☁ Cloud saved" TRƯỚC khi ghi thật sự** — offline thì không có gì được lưu nhưng UI vẫn báo thành công | 850 |
| 5 | Tasks_Tracking | Race khi load: `addRow()` chạy trước khi cloud trả về → row phantom bị ghi đè | 1057–1066 |
| 6 | Data_mapper | **Range mapping ghi đè dữ liệu bằng chuỗi rỗng** khi giá trị matched không phải số (nhánh nomatch có guard, nhánh matched thì không) | 1997–2003 |
| 7 | Data_mapper | Schema Hama hardcode (`REQ_COLS`): file thiếu đúng các cột này → mọi dòng báo "no match" mà không có giải thích | 1896 |
| 8 | Image_Compressor | **ZIP trùng tên file bị ghi đè lặng lẽ** (a.jpg + a.gif→jpg chỉ còn 1 file trong ZIP) | 972 |
| 9 | File_finder | `_restoreState()` crash sau reload (`LS.scanHandle` luôn null) → mất luôn phần restore tab/keywords phía sau | 3284 |
| 10 | File_finder | Cache expand folder không reset giữa 2 lần scan → mở folder ở scan mới hiển thị rỗng | 2280–2374, 2516 |
| 11 | Cả 2 app Firestore | Account name dùng thẳng làm doc ID → tên chứa `/` sẽ crash; 2 người cùng account ghi đè lẫn nhau (last-write-wins, không merge) | 858 / 2422 |

---

## 🟡 BUG CHỨC NĂNG (không mất dữ liệu)

- **index.html:** Không có guard khi GSAP CDN fail → background + toggle Geo/Flow chết hẳn (ReferenceError). Animation 900 particle vẫn chạy ngầm khi mở tool (tốn CPU/pin). Iframe của cả 10 tool được cache vĩnh viễn trong RAM. Code slider dots là dead code.
- **Tasks_Estimation.html:** `exportXLSX` không có guard `typeof ExcelJS` và không có try/catch → offline/CDN bị chặn thì nút Export chết im lặng. `saveState` không try/catch (Safari private mode sẽ throw liên tục). Tab-navigation mất focus sau mỗi lần sửa (do re-render toàn bộ).
- **Overview_Qa_PDF_builder.html:** `onDrop`/`onFinalDrop` dùng `await` trong vòng lặp `dataTransfer.items` → drop nhiều item chỉ nhận item đầu (hàm `onAddDrop` đã fix đúng pattern, 2 hàm kia chưa). 1 ảnh lỗi làm hỏng cả PDF export (không có skip). `canvas.toBlob` null với ảnh quá lớn → lỗi khó hiểu. Lưu ý tốt: 683KB là do nhúng sẵn pdf-lib inline (chạy offline được) — không phải bloat.
- **HTML5_banner_guideline:** Nút Copy dán thừa chữ "Copy" vào cuối mọi snippet (logic strip sai vì badge là CSS `::before`). Phím tắt Alt+1–6 chết trên macOS. Deep-link `#section` không hoạt động. Nút copy không đổi label khi switch tiếng Việt.
- **base64-converter:** Copy không có `.catch()` → fail im lặng trên plain HTTP. Drag-drop không lọc file không phải ảnh. Không giới hạn size (ảnh 20MB → ~100MB DOM).
- **Image_Compressor:** TIFF được quảng cáo hỗ trợ nhưng `createImageBitmap` không decode được TIFF → luôn lỗi. Nén tất cả file đồng thời không giới hạn → 200 ảnh = 200 canvas cùng lúc.
- **banner-preview/open-preview.command:** **Hỏng như hiện tại** — chạy `scan.js` với ROOT_DIR là chính folder tool (không có banner nào) → luôn báo "Không tìm thấy banner". Cần truyền `--dir=`.
- **banner-preview:** Logic detect banner bị **duplicate 2 nơi** (scan.js và banner-builder.html) và đã lệch nhau (SKIP_TOKENS, extractLang, variant label) → cùng 1 folder cho kết quả khác nhau.

---

## 🔐 BẢO MẬT KHÁC (quan trọng nếu host online)

1. **Iframe banner không có `sandbox`** (scan.js:658, banner-builder:1346): banner ZIP từ khách hàng/ad-tech chạy same-origin với trang preview → script trong banner có thể điều khiển cả trang. Fix 1 dòng: `sandbox="allow-scripts allow-popups"`.
2. **scan.js server có path traversal** (dòng 768): `curl --path-as-is /../../...` đọc được file ngoài ROOT_DIR (chỉ bind 127.0.0.1 nên rủi ro thấp, nhưng nên fix bằng `path.resolve` + `startsWith`). `decodeURIComponent` không try/catch → request `/%zz` làm crash server.
3. **XSS qua tên file** (self-XSS, mức thấp): base64-converter:319, Image_Compressor:808, File_finder:2996+2304, Overview_Qa_PDF_builder (renderList/renderGrid/renderFinal), preview HTML do scan.js/builder sinh ra (kể cả `</script>` breakout qua tên folder ở `SCAN_DATA`). Data_mapper và Tasks_Estimation escape tốt — dùng làm mẫu.
4. **xlsx 0.18.5 (File_finder, Data_mapper) dính CVE-2023-30533 (prototype pollution) + CVE-2024-22363 (ReDoS)** khi parse file untrusted. cdnjs dừng ở 0.18.5 — nên chuyển sang CDN chính thức của SheetJS ≥0.20.2.
5. **CSV/formula injection** khi export (cả 2 app tracking): giá trị bắt đầu bằng `=`, `+`, `-`, `@` sẽ chạy công thức khi mở bằng Excel. Banner_Tracker export CSV còn không escape dấu `"` bên trong.
6. **Không có SRI (`integrity`) trên mọi thẻ CDN** — nếu host online nên thêm.
7. Tasks_Tracking `exportToExcel` xuất bytes CSV nhưng đặt đuôi `.xlsx` → Excel cảnh báo.
8. Video nền CloudFront (nhiều tool) là URL generated cá nhân — sẽ 404 một ngày nào đó và leak usage nếu host public.

---

## 🚀 ĐỀ XUẤT NÂNG CẤP / TỐI ƯU

**Ưu tiên 1 — trước khi đưa online:**
1. Firebase: Anonymous Auth + security rules + restrict API key + App Check (mục 🔴1).
2. Escape toàn bộ innerHTML nhận dữ liệu người dùng — chuẩn hóa 1 hàm `esc()` dùng chung (escape đủ `& < > " '`).
3. Thêm `sandbox` cho iframe banner preview.
4. Host bằng **HTTPS** (bắt buộc: File System Access API, clipboard chỉ chạy trên secure context — plain HTTP sẽ chết File_finder, PDF builder, nút Copy).

**Ưu tiên 2 — độ tin cậy:**
5. Sửa nhóm bug mất dữ liệu ở bảng 🟠 (đặc biệt Banner_Tracker #1–3 và Data_mapper #6).
6. Thêm guard `typeof <lib>` + try/catch + thông báo lỗi cho mọi tool phụ thuộc CDN (ExcelJS, XLSX, Papa, GSAP, JSZip). Cân nhắc vendor lib vào folder `libs/` như PDF builder đã làm — cả Hub sẽ chạy offline 100%.
7. Firestore: dùng `set(..., {merge:true})` hoặc field-level update; hiện "saved" chỉ sau khi promise resolve; validate account name `[a-zA-Z0-9_-]`.

**Ưu tiên 3 — hiệu năng & UX:**
8. index.html: pause animation khi mở tool; giới hạn iframe cache; bỏ `?v=Date.now()` khi host online (phá HTTP cache); thêm keyboard access cho tool cards.
9. File_finder: render kết quả theo chunk/virtual scroll (100k file hiện đang freeze tab); dùng Map cho exact search; đổi `mode:'readwrite'` → `'read'` cho folder chỉ đọc.
10. Image_Compressor: giới hạn ~3 job nén đồng thời; thêm option resize max-dimension; bỏ TIFF khỏi danh sách hỗ trợ.
11. Data_mapper: chunked parsing cho file lớn; thêm dropdown chọn encoding (CSV Windows-1252 tiếng Đan Mạch đang bị lỗi ø/å/æ).
12. Tasks_Estimation: chỉ update row + summary thay vì re-render toàn bảng (fix luôn lỗi mất focus).
13. banner-preview: gộp logic detect về 1 nguồn duy nhất; sửa open-preview.command; xóa `banner-builder.html.bak` (đã diff — chỉ là bản CSS cũ, không có logic riêng, an toàn để xóa).
14. Xóa dead code: slider dots (index.html), fake loading spinner + object `translations` không dùng (guideline), `.hidden` class thiếu CSS rule (PDF builder).

---

## ✅ Điểm tốt đáng giữ

- Không có lỗi cú pháp JS nào trên toàn bộ 13 file code.
- Không có link/ảnh/element ID nào bị gãy.
- Data_mapper và Tasks_Estimation escape XSS chuẩn; Banner_Tracker có `esc()` (chỉ thiếu `>` và `'`).
- PDF builder nhúng pdf-lib inline → chạy offline; Image_Compressor quản lý memory (revoke URL, `bm.close()`) tốt; `traverseEntry` xử lý đúng giới hạn 100-entry của Chrome.
- `.command` files quote đúng, không hardcode absolute path; server bind 127.0.0.1 an toàn.
- Banner_Tracker xử lý CDN-fail tốt (tách 2 script block, catch ReferenceError).
