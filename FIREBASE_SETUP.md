# Hướng dẫn bảo mật Firebase — BẮT BUỘC làm để app hoạt động sau bản vá

Code đã được thêm **Anonymous Auth**. App vẫn chạy local bình thường, nhưng để lưu cloud hoạt động và dữ liệu được bảo vệ, cần làm các bước sau cho **CẢ 2 project**:

- `banner-tracker` (Banner_Tracker.html)
- `task-manager-personal-f543e` (Tasks_Tracking.html)

---

## Bước 1 — Bật Anonymous Auth (bắt buộc)

1. Mở https://console.firebase.google.com → chọn project.
2. **Authentication** → tab **Sign-in method** → **Add new provider** (hoặc danh sách providers).
3. Chọn **Anonymous** → bật **Enable** → Save.

> Nếu chưa bật: app hiện thông báo "auth off / Auth not enabled" và tự chuyển sang lưu local — không mất dữ liệu, nhưng không sync cloud.

## Bước 2 — Dán Security Rules (bắt buộc)

**Firestore Database** → tab **Rules** → thay toàn bộ bằng nội dung dưới → **Publish**.

### Project `task-manager-personal-f543e`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /taskAccounts/{account} {
      allow read, write: if request.auth != null
                         && account.matches('^[a-zA-Z0-9_-]{3,50}$');
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Project `banner-tracker`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /bannerTracker/{account} {
      allow read, write: if request.auth != null
                         && account.matches('^[a-zA-Z0-9_-]{2,50}$');
      match /jobs/{job} {
        allow read, write: if request.auth != null;
      }
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

> **Lưu ý về giới hạn:** rules này chặn truy cập REST ẩn danh tùy tiện, nhưng vì app dùng chung "account name" (không gắn dữ liệu với từng UID), bất kỳ ai dùng app và biết account name vẫn đọc/ghi được account đó. Muốn chặt hơn nữa cần chuyển sang mô hình đăng nhập thật (email/Google) và lưu theo UID — thay đổi lớn, làm sau nếu cần.

## Bước 3 — Giới hạn API key theo domain (khuyến nghị mạnh nếu host online)

1. Mở https://console.cloud.google.com/apis/credentials → chọn đúng project.
2. Click vào API key (Browser key).
3. **Application restrictions** → **Websites** → thêm domain bạn host (vd: `https://your-domain.com/*`, `http://localhost:*` để dev).
4. **API restrictions** → Restrict key → chỉ chọn: Identity Toolkit API, Cloud Firestore API, Token Service API.
5. Save.

> Nếu chỉ mở file local (file://) thì restriction theo website có thể chặn chính bạn — khi đó bỏ qua bước này hoặc chạy qua `localhost`.

## Bước 4 — App Check (tùy chọn, chống abuse quota)

Firebase Console → **App Check** → đăng ký web app với **reCAPTCHA v3** → bật enforcement cho Firestore. Cần thêm SDK App Check vào 2 file HTML — báo tôi nếu muốn làm bước này, tôi sẽ thêm code.

## Kiểm tra sau khi setup

1. Mở Banner_Tracker → status hiển thị connected (không phải "auth off").
2. Tạo/sửa dữ liệu → bấm Save → thấy "SAVED" (chỉ hiện sau khi ghi thành công thật).
3. Thử gọi REST không auth để xác nhận đã khóa:
   ```
   curl "https://firestore.googleapis.com/v1/projects/banner-tracker/databases/(default)/documents/bannerTracker"
   ```
   Phải trả về lỗi `403 PERMISSION_DENIED`.
