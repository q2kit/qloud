# Yêu cầu

Chi tiết của từng tính năng nằm trong [features/](features/). File này là danh sách tổng hợp.

## Yêu cầu chức năng

| ID | Tính năng | Đặc tả | Ưu tiên |
|---|---|---|---|
| F-AUTH | Đăng ký, đăng nhập, OAuth, quên mật khẩu | [auth.md](features/auth.md) | MVP |
| F-NODE | Folder và file: tạo, liệt kê, đổi tên, di chuyển | [files-folders.md](features/files-folders.md) | MVP |
| F-UPLOAD | Upload chia chunk, tiếp tục khi lỗi | [upload.md](features/upload.md) | MVP |
| F-VIEW | Download, xem trước ảnh/PDF/video, thumbnail | [download-preview.md](features/download-preview.md) | MVP |
| F-SHARE | Chia sẻ cho người dùng khác và qua link công khai | [sharing.md](features/sharing.md) | MVP |
| F-TRASH | Thùng rác, khôi phục, xóa vĩnh viễn | [trash.md](features/trash.md) | MVP |
| F-SEARCH | Tìm kiếm theo tên và bộ lọc | [search.md](features/search.md) | MVP |
| F-QUOTA | Giới hạn và hiển thị dung lượng | [quota.md](features/quota.md) | MVP |
| F-VERSION | Lịch sử phiên bản của file | [versioning.md](features/versioning.md) | MVP |
| F-I18N | Giao diện tiếng Việt và tiếng Anh | [ui-ux.md](ui-ux.md) | MVP |
| F-THEME | Light mode, dark mode, theo hệ thống | [ui-ux.md](ui-ux.md) | MVP |

## Yêu cầu phi chức năng

| ID | Yêu cầu |
|---|---|
| NF-01 | **Hiệu năng:** API danh sách trả về dưới 300ms (p95) với folder có 10.000 node. Trang đầu hiển thị dưới 2 giây. |
| NF-02 | **File lớn:** hỗ trợ file tối đa 50GB (giới hạn này cấu hình được). Upload tiếp tục được sau khi mất mạng, reload trang hoặc đóng trình duyệt. |
| NF-03 | **Mở rộng:** server ứng dụng stateless; byte của file không đi qua server ứng dụng; tăng tải bằng cách thêm instance. |
| NF-04 | **Bảo mật (cơ bản):** HTTPS; mật khẩu băm bằng Argon2; cookie HttpOnly/Secure/SameSite; CSRF; rate limit cho đăng nhập và các endpoint nhạy cảm; presigned URL có hạn ngắn; kiểm tra quyền phía server. |
| NF-05 | **Toàn vẹn dữ liệu:** quota không bị vượt khi upload đồng thời; không để lại object mồ côi trên S3 lâu dài (có job dọn dẹp). |
| NF-06 | **Sao lưu:** backup PostgreSQL hằng ngày. Bật versioning hoặc chính sách giữ lại trên bucket (xem open-questions). |
| NF-07 | **Khả dụng:** chấp nhận downtime ngắn khi deploy ở giai đoạn 1. |
| NF-08 | **Quan sát:** log có cấu trúc (JSON); theo dõi lỗi (Sentry hoặc tương đương); healthcheck endpoint. |
| NF-09 | **Trợ năng:** điều khiển được bằng bàn phím, đủ độ tương phản (WCAG AA), có nhãn ARIA. |
| NF-10 | **Trình duyệt:** 2 phiên bản mới nhất của Chrome, Firefox, Safari, Edge. |
