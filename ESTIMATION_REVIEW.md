# Review: Tasks_Estimation.html

**Ngày:** 28/08/2026 · **Backup bản cũ:** `Tasks_Estimation.html.bak-20260828` (git cũng có, xoá được sau khi xác nhận)

`AUDIT_REPORT.md` (03/07) đã cover phần kỹ thuật và các fix đó đã được áp dụng. Bản review này đi vào thứ audit trước không chạm tới: **logic nghiệp vụ**. Code chạy đúng — nhưng nó đang tính sai.

---

## 0. ĐÃ SỬA — đợt 1 (28/08/2026)

### Quyết định đã chốt

| Câu hỏi | Chốt | Lý do |
|---|---|---|
| Đơn vị nhập | **Phút** (2 slider: phút/master, phút/version) | Bạn ước lượng bằng phút. Giờ + ngày hiển thị song song ở summary, copy và Excel. |
| Suy giảm theo vòng | **Hardcode 0.7**, hiện hệ số `w` trên UI | Một slider nữa là thừa. Đổi 1 dòng `CORR_DECAY` nếu cần tuyến tính. |
| Buffer | Áp lên **base + sửa** | Vòng sửa cũng phát sinh ngoài dự tính. Mô hình 1 câu, dễ giải thích với PM. |
| PERT / khoảng p50–p80 | **Bỏ** | Est chỉ đi tới PM, không ra khách. Buffer slider đã là cơ chế khoảng rồi. |
| Rate card → tiền | **Bỏ** | Bạn deal với PM bằng giờ. |
| Nhiều estimate lưu tên | **Hoãn** | Chờ bạn dùng công thức mới rồi tính. |
| Hiệu chỉnh từ actuals | **Bỏ hẳn** | Không tồn tại dữ liệu giờ thực tế ở đâu cả. Xem mục 4.1. |

### Công thức mới

```js
const CORR_DECAY = 0.7;                    // vòng 1 = 100%, vòng 2 = 70%, vòng 3 = 49%…
w(R) = 1 + d + d² + … + d^(R-1)

corrMin   = w(R) × (SL master × phút/master + SL version × phút/version)
bufferMin = (baseMin + corrMin) × buffer%
totalMin  = baseMin + corrMin + bufferMin
```

Mọi phép cộng dồn làm bằng **phút** rồi mới đổi ra giờ — hết sai số làm tròn giữa màn hình và Excel.

### Danh sách thay đổi

| # | Thay đổi |
|---|---|
| 1 | **`computeTotals()`** — nguồn sự thật duy nhất. Summary, Copy, Export Excel đều gọi hàm này. Trước đây 3 nơi tự tính riêng. |
| 2 | Mô hình sửa đổi mới (công thức trên). Slider "Phút / Sửa" tách thành **Phút sửa / Master** và **Phút sửa / Version**. |
| 3 | Buffer áp lên base + sửa (label ghi rõ). |
| 4 | Thêm setting **Giờ / ngày** ở project bar (mặc định 8, dùng cho mọi chỗ quy đổi ngày). Hết hardcode `/8`. |
| 5 | Summary hiện **phút** cạnh giờ và ngày. Copy và Excel cũng vậy. |
| 6 | "Tổng Tasks" → **"Tổng đầu ra"**; `corrInfo` đổi thành `"N file · R vòng · hệ số w"`. Trước đây gọi số file là "tasks". |
| 7 | Export Excel **không cộng dồn số đã làm tròn** nữa — lấy thẳng từ `computeTotals()`. Thêm dòng "Grand Total (minutes)". |
| 8 | Đổi dropdown Loại **không còn ghi đè** số phút bạn tự nhập (chỉ ghi đè khi giá trị đang đúng bằng preset cũ hoặc = 0). |
| 9 | `applyPreset` bỏ biến global `event`, và giờ **áp preset lên các dòng chưa tự nhập** thay vì chỉ đổi slider. |
| 10 | Input số: `onchange` → **`oninput`** — tổng nhảy ngay khi gõ, không cần Tab ra. |
| 11 | Chặn số âm gõ tay (`Math.max(0, …)`). |
| 12 | `esc()` escape đủ 5 ký tự `& < > " '` (theo đề xuất chuẩn hoá của AUDIT_REPORT). |
| 13 | `saveState()` debounce 250ms — hết ghi localStorage mỗi keystroke / mỗi pixel kéo slider. |
| 14 | Thêm 3 Loại task: **QA / Test**, **Trafficking**, **Briefing / PM** — để công việc QA và trafficking hiện ra trong breakdown thay vì bị fake thành dòng khác. |
| 15 | Excel: vùng tô nền tự giãn theo số dòng (trước fix cứng 40 dòng). |

### Kết quả kiểm chứng

| Kịch bản (buffer 15%, 15′/master, 4′/version) | Base | Sửa CŨ | Sửa MỚI | Tổng MỚI |
|---|---:|---:|---:|---:|
| 1M + 5V · 2 vòng | 4.42h | 3.00h (68%) | **0.99h (22%)** | 6.22h |
| 5M + 25V · 2 vòng | 22.08h | 15.00h (68%) | **4.96h (22%)** | 31.10h |
| 8M + 72V · 3 vòng | 54.00h | 60.00h (111%) | **14.89h (28%)** | 79.23h |
| 8M + 72V · 10 vòng (max) | 54.00h | 800.00h (1481%) | **22.03h (41%)** | 87.43h |

Kiểm chứng ngược ở kịch bản B: 12.8 phút/master/vòng và 3.4 phút/version/vòng. Khớp production.

**Đã test:** syntax JS · `computeTotals` với 4 kịch bản + biên (0 task, 0 vòng, giờ/ngày = 0 → fallback 8, gõ số âm) · layout 4 slider ở 1440px · nội dung Copy · export Excel chạy được và **số trong Excel khớp đúng màn hình** (23.58 / 8.36 / 4.79 / 36.73h / 2204 phút / 60 file).

### Lưu ý khi dùng

- Dòng **QA / Trafficking** cũng ăn thời gian sửa (số file × phút/version × hệ số vòng). Đây là **đúng** — mỗi vòng sửa kéo theo một lượt re-QA / re-traffic. Nếu không muốn, để số lượng dòng đó = 0.
- Slider phút sửa là **global**, dùng chung cho mọi dòng. Estimate trộn nhiều loại rất khác nhau (banner + landing page trong cùng một sheet) sẽ lệch. Hiếm gặp; nếu bạn gặp thường xuyên thì thêm cột override từng dòng là ~20 dòng code.
- `CORR_DECAY = 0.7` nằm ngay đầu block `<script>`, có comment. Đặt `1.0` nếu muốn mọi vòng sửa tốn như nhau.

---

## Phần dưới: chẩn đoán gốc (giữ lại làm hồ sơ)

---

## 1. Lỗi chính — công thức "Sửa đổi"

Bạn đúng, và mức độ tệ hơn bạn nghĩ.

```js
// dòng 2183
totalTasks += t.masterQty + t.versionQty;

// dòng 2187
const corrH = (totalTasks * corrRounds * corrMin) / 60;
```

`totalTasks` **không phải số task** — nó là tổng số file đầu ra. Công thức đang khẳng định: mọi file, master hay version, đều tốn đúng `corrMin` phút cho **mỗi** vòng sửa.

### Số thực tế (buffer 15%, preset HTML5 Banner: 90'/master, 35'/version)

| Kịch bản | Base | Sửa đổi | % base | Tổng |
|---|---:|---:|---:|---:|
| 1 master + 5 version · 2 vòng × 15' | 4.42h | 3.00h | 68% | 8.08h |
| 5 master + 25 version · 2 vòng × 15' | 22.08h | 15.00h | 68% | 40.40h |
| 8 master + 72 version · 3 vòng × 15' | 54.00h | 60.00h | **111%** | 122.10h |
| 8 master + 72 version · 10 vòng × 60' *(max slider)* | 54.00h | 800.00h | **1481%** | 862.10h |

### Vì sao đây là lỗi cấu trúc, không phải lỗi chỉnh số

Tỉ lệ sửa/base **tăng theo số version**. Càng nhiều version, công thức càng thổi phồng.

Thực tế ngược lại hoàn toàn. Version là thứ **rẻ nhất** để sửa: fix master một lần, propagate qua shared CSS/JS, phần còn lại chỉ là QA + re-export ~2–3 phút/file. Sửa đổi có **lợi thế quy mô**, không phải bất lợi quy mô.

> Công thức hiện tại đang phạt đúng cái workflow mà tool này sinh ra để mô hình hóa.

Kéo slider tới max cho ra 862h ≈ 108 ngày công cho một bộ banner 80 file. Con số đó không dùng được vào việc gì.

### Lỗi kèm theo

- Card **"Tổng Tasks"** hiển thị `totalTasks` — đó là số **file**, không phải số task. Sub-label "N master + M version" xác nhận điều này.
- Chuỗi `corrInfo`: `"N tasks × R vòng × M phút"` — sai chữ "tasks", phải là "file".
- Logic sửa đổi bị **viết lại lần thứ hai** ở `exportXLSX` (dòng 2453). Hai nguồn sự thật, cùng một bug, sẽ lệch nhau khi bạn fix một chỗ.

---

## 2. Ba mô hình thay thế

### Mô hình A — % của base (đơn giản nhất)
```
corrH = baseH × rate × R          // rate mặc định ~10%/vòng
```
Tự chuẩn hóa theo độ phức tạp. Nhưng under-weight master: ở kịch bản C ra ~6.5 phút/master/vòng — quá thấp cho việc sửa một master thật.

### Mô hình B — tách phút/sửa master vs version
```
corrH = w(R) × (masterQty × corrMinMaster + versionQty × corrMinVersion) / 60
```
Sửa được mất cân đối master/version, nhưng vẫn bỏ qua độ phức tạp: một landing page master (480') và một banner master (90') bị tính cùng một `corrMin`.

### ✅ Mô hình C — % theo thời gian build của chính hạng mục đó + suy giảm theo vòng **(khuyến nghị)**

```js
const w = R => { let s = 0; for (let n = 0; n < R; n++) s += DECAY ** n; return s; };
// DECAY = 0.7 mặc định  ·  DECAY = 1.0 → tuyến tính như cũ

corrH = w(corrRounds) * (masterH * rateMaster + versionH * rateVersion);
// rateMaster  mặc định 20%
// rateVersion mặc định  8%
```

Xử lý cả hai bất đối xứng bằng đúng hai tham số: master đắt hơn version, và hạng mục phức tạp đắt hơn hạng mục đơn giản — vì cả hai đều đã nằm trong `masterH` / `versionH`.

**Hệ số vòng** `w(R)` với decay 0.7:

| R | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|
| w | 1.00 | 1.70 | 2.19 | 2.53 | 2.77 | 2.94 | 3.14 | 3.24 |

Vòng 1 sửa concept, vòng 5 sửa 2px padding. Tính chúng bằng nhau là sai. `DECAY = 1.0` cho ra hành vi tuyến tính nếu bạn muốn quay về.

### Kết quả so sánh

| Kịch bản | Base | Sửa (cũ) | Sửa (mới) | % base | Tổng mới | phút/master/vòng | phút/version/vòng |
|---|---:|---:|---:|---:|---:|---:|---:|
| A · 1M+5V · 2 vòng | 4.42h | 3.00h | **0.91h** | 21% | 5.99h | 15.3 | 2.4 |
| B · 5M+25V · 2 vòng | 22.08h | 15.00h | **4.53h** | 21% | 29.93h | 15.3 | 2.4 |
| C · 8M+72V · 3 vòng | 54.00h | 60.00h | **12.61h** | 23% | 74.71h | 13.1 | 2.0 |
| D · 8M+72V · 10 vòng | 54.00h | 800.00h | **18.66h** | 35% | 80.76h | 5.8 | 0.9 |

Hai cột cuối là kiểm chứng ngược: mô hình mới quy về **15 phút/master/vòng** và **2.4 phút/version/vòng** — khớp với thực tế production. Và ở max slider nó dừng ở 35% base thay vì 1481%.

**Tiêu chí quan trọng nhất: mô hình phải không nổ ở hai đầu slider.** Mô hình hiện tại nổ. Mô hình C thì không.

### UI cần đổi theo

| Hiện tại | Đề xuất |
|---|---|
| Slider "Phút / Sửa" (0–60, step 5) | Slider "% sửa / master" (0–50%) + "% sửa / version" (0–25%) |
| — | Slider "Độ suy giảm mỗi vòng" (0.5–1.0), mặc định 0.7 |
| Card "Tổng Tasks" | "Tổng đầu ra (file)" |
| `"N tasks × R vòng × M phút"` | `"N file · R vòng · hệ số w=X.XX"` |

---

## 3. Bug và điểm yếu khác

### 🔴 Cần sửa

| # | Vị trí | Vấn đề |
|---|---|---|
| 1 | 2187 + 2453 | Logic `corrH` viết 2 lần. Gom về một hàm `computeTotals()` duy nhất, dùng chung cho `recalc` / `copySummary` / `exportXLSX`. |
| 2 | `copySummary` | Đọc số từ **DOM** (`sumTotal.textContent`) thay vì từ state. Kế thừa luôn sai số làm tròn hiển thị. |
| 3 | 2445 `exportXLSX` | `baseTotal += sub` cộng dồn giá trị **đã làm tròn 2 số lẻ** từng dòng. 20 dòng → Excel lệch vài phút so với màn hình. Ngồi trước mặt khách thì rất khó xử. |
| 4 | 2189, 2192, 2461 | Hardcode `8h/ngày` ở 3 chỗ. Ngày design thực tế ~6–6.5h sau họp/mail. Phải thành setting. |
| 5 | `updateField` case `type` | Đổi dropdown Loại **ghi đè im lặng** `minMaster`/`minVersion` bạn đã tự nhập. Mất dữ liệu không cảnh báo. |
| 6 | `applyPreset` | Dùng biến global `event` (deprecated) → sẽ throw nếu gọi từ code. Và click preset chip **không áp dụng gì lên các dòng đã có** — chỉ đổi slider corrMin. Người dùng tưởng nó áp dụng. |

### 🟠 Nên sửa

| # | Vấn đề |
|---|---|
| 7 | `parseFloat(value) \|\| 0` không clamp âm. `min="0"` trên input **không** chặn gõ tay `-5` → giờ âm. Cần `Math.max(0, ...)`. |
| 8 | Toàn bộ input dùng `onchange` (commit khi blur) chứ không phải `oninput`. Gõ 300 vào Phút/Master mà tổng không nhúc nhích cho tới khi Tab. Với tool tự nhận "Built for speed" thì đây là ma sát thật. |
| 9 | `saveState()` chạy mỗi keystroke của Dự án/Khách hàng và mỗi pixel kéo slider. Không debounce. |
| 10 | `esc()` thiếu `>` và `'`. Rủi ro thực tế thấp (attribute đều dùng nháy kép) nhưng `AUDIT_REPORT.md` đã đề xuất chuẩn hóa một `esc()` dùng chung cho cả Hub — file này nên theo. |
| 11 | `corrMinRange` step 5 → không đặt được 12 phút. Buffer max 50%, vòng sửa max 10 đều là số tùy tiện. |
| 12 | Xóa dòng task không có undo, không confirm. |
| 13 | Buffer chỉ áp lên base, **không** áp lên phần sửa đổi. Có thể chấp nhận được, nhưng đang ngầm định — nên ghi rõ trên UI để không tranh cãi khi review estimate. |

---

## 4. Khoảng trống chiến lược — trần thực sự của tool

Bốn mục dưới đây quan trọng hơn toàn bộ mục 3 cộng lại.

### 4.1 ~~Hiệu chỉnh từ actuals~~ — ĐÃ HUỶ, sai tiền đề

**Bản đầu của tài liệu này đề xuất import "thời gian thực tế" từ `Tasks_Tracking.html`. Đề xuất đó sai.**

`Tasks_Tracking` không đo thời gian. Nó theo dõi việc **điền timesheet**: task được duyệt 10h → ghi `estimate = 10h` → mỗi hôm điền được bao nhiêu thì cộng vào `filled` → `filled` chạm 10h là xong.

Nghĩa là `filled` **luôn hội tụ đúng bằng `estimate` theo thiết kế**. Variance vĩnh viễn bằng 0. Không phải dữ liệu bẩn — mà là dữ liệu đo một thứ khác hoàn toàn: mức độ tuân thủ timesheet, không phải thời gian làm việc thật.

**Hệ quả:** không có nguồn dữ liệu nào trong Hub — hay bất cứ đâu — nói được estimate đúng hay sai. `minMaster: 90` là số phán đoán, và nó sẽ **mãi mãi** là số phán đoán trừ khi bắt đầu bấm giờ thật, việc mà không đáng làm chỉ để nuôi một cái calculator.

**Vậy giá trị thật của tool là gì?** Không phải độ chính xác — mà là **tính nhất quán**. Cùng một dạng job phải luôn ra cùng một con số, để không tự bán rẻ mình hôm thứ Ba rồi hét giá hôm thứ Sáu, và để khi PM hỏi "sao lâu vậy" thì có một bảng phân rã chỉ vào được chứ không phải một con số từ trên trời. Việc đó tool làm được ngay, không cần actuals.

Cách chỉnh preset duy nhất còn lại: dùng công thức mới vài job, thấy lệch thì kéo slider. Phán đoán 15 năm nghề vẫn là nguồn tốt nhất đang có — miễn là ý thức rõ rằng đó là phán đoán.

### 4.2 Một con số duy nhất là độ chính xác giả
"40.40h" mời khách hàng coi đó là cam kết. Estimate thật phải là **khoảng**:
```
PERT = (O + 4M + P) / 6      ·      σ = (P - O) / 6
```
Xuất ra "34–52h, p80 = 47h". Lúc đó **buffer trở nên có nghĩa** thay vì là slider tùy hứng — vì buffer chính là khoảng cách giữa p50 và p80. Đây là thứ biến tool từ máy tính thành công cụ đàm phán.

### 4.3 Thiếu hẳn các hạng mục công việc có thật
Không có dòng nào cho: briefing/kickoff, gom asset, QA cross-browser, **trafficking + check spec CM360 / TTD / Adnami**, đóng gói & bàn giao, PM overhead.

Với banner production, riêng QA + trafficking thường là **15–25% job**. Hiện phải fake thành một dòng task, nghĩa là chúng vô hình trong breakdown và là thứ đầu tiên bị cắt khi deadline ép.

Đề xuất: thêm trường `phase` (Design / Build / QA / Traffic / PM) và tách breakdown theo phase. Vừa cho estimate đúng hơn, vừa cho lý lẽ khi khách hỏi "sao lâu vậy".

### 4.4 Một ô localStorage duy nhất
```js
const STORAGE_KEY = 'taskEstimation_v1';
```
Mở project mới = mất project cũ. Không so sánh được v1/v2 của cùng một quote, không mở lại estimate tháng trước để đối chiếu với thực tế.

Cần: danh sách estimate có tên + ngày, duplicate-as-new-version, và (vì Firebase đã có sẵn trong Hub) đồng bộ cloud. Không có cái này thì mục 4.1 không thể thực hiện — không lưu estimate thì không có gì để so với actual.

### 4.5 Phụ (cân nhắc)
- **Rate card → chi phí.** Tool estimate cho client work mà không xuất tiền là mới xong một nửa. Chỉ nên thêm nếu bạn thật sự báo giá từ đây.
- **Timeline/capacity.** "40h = 5 ngày" không trả lời được *bao giờ xong*. Với 2 designer + ngày làm 6.5h + trừ cuối tuần thì ra một ngày khác hẳn.

---

## 5. Thứ tự thực hiện đề xuất

**Đợt 1 — sửa phép tính (nửa ngày)**
1. Gom `computeTotals()` một nguồn duy nhất → fix luôn mục 3.1, 3.2, 3.3
2. Áp mô hình sửa đổi C + UI slider mới
3. Đổi label "Tổng Tasks" → "Tổng đầu ra"
4. `hoursPerDay` thành setting
5. Clamp âm + đổi `onchange` → `oninput`

**Đợt 2 — bỏ độ chính xác giả (1 ngày)**
6. PERT 3 điểm + xuất khoảng p50/p80
7. Trường `phase` + breakdown theo phase
8. Nhiều estimate có tên, lưu được

~~**Đợt 3 — vòng lặp hiệu chỉnh**~~ — huỷ, xem mục 4.1.

Đợt 1 làm cho tool **đúng và nhất quán**. Đó là toàn bộ những gì tool này cần làm.

---

## 6. Cần chốt trước khi code

1. **Mô hình sửa đổi**: C (% theo build time) hay B (tách phút master/version)? C đúng hơn về mặt mô hình, nhưng B giữ được đơn vị "phút" mà bạn đang quen ước lượng.
2. **`rateMaster` / `rateVersion` = 20% / 8% có khớp thực tế Spring CC không?** Đây là số tôi suy ra ngược từ 15 phút/master/vòng. Bạn có số thật thì đè lên.
3. **Estimate này có đi ra ngoài cho khách xem không, hay chỉ nội bộ?** Quyết định việc có cần khoảng p50/p80 hay không — nội bộ thì một con số là đủ, đưa khách thì một con số là tự bắn vào chân.
4. **Ai ngoài bạn đang dùng tool này?** Ảnh hưởng tới việc PRESETS nên là global hay per-user, và có cần cloud sync không.
5. ~~Actuals trong Tasks_Tracking~~ — đã trả lời: `Tasks_Tracking` đo việc điền timesheet, không đo thời gian làm. Không có actuals. Xem mục 4.1.
