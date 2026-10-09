# Tổng quan

Qloud là ứng dụng web mã nguồn mở để **lưu trữ, sắp xếp, xem trước và chia sẻ file**, chạy trên trình duyệt desktop và mobile.
Mỗi người dùng có không gian lưu trữ riêng, giới hạn theo gói dung lượng. File và folder chia sẻ được cho người dùng khác
(quyền xem hoặc sửa) hoặc qua link công khai. Upload chia nhỏ và tự tiếp tục khi gián đoạn, nên dùng được với file rất lớn.

## Phạm vi MVP

| ID | Tính năng | Đặc tả |
|---|---|---|
| F-AUTH | Đăng ký, đăng nhập (email/mật khẩu, Google, GitHub), quên mật khẩu | [auth.md](features/auth.md) |
| F-NODE | Folder lồng nhau và file: tạo, liệt kê, đổi tên, di chuyển | [files-folders.md](features/files-folders.md) |
| F-UPLOAD | Upload chia chunk, tiếp tục khi lỗi | [upload.md](features/upload.md) |
| F-VIEW | Download, xem trước ảnh/PDF/video, thumbnail | [download-preview.md](features/download-preview.md) |
| F-SHARE | Chia sẻ cho người dùng khác và qua link công khai | [sharing.md](features/sharing.md) |
| F-TRASH | Thùng rác, khôi phục, xóa vĩnh viễn | [trash.md](features/trash.md) |
| F-SEARCH | Tìm kiếm theo tên và bộ lọc | [search.md](features/search.md) |
| F-QUOTA | Giới hạn và hiển thị dung lượng | [quota.md](features/quota.md) |
| F-VERSION | Lịch sử phiên bản của file | [versioning.md](features/versioning.md) |
| F-I18N, F-THEME | Tiếng Việt và tiếng Anh; light, dark, theo hệ thống | [ui-ux.md](ui-ux.md) |

**Ngoài phạm vi MVP:** app native, desktop sync, sửa tài liệu trực tuyến, nhiều người cùng sửa, thanh toán, mã hóa đầu cuối, quét virus.

## Yêu cầu phi chức năng

| ID | Yêu cầu |
|---|---|
| NF-01 | **Hiệu năng:** API danh sách dưới 300ms (p95) với folder 10.000 node. Trang đầu hiển thị dưới 2 giây. |
| NF-02 | **File lớn:** tối đa 50 GB (theo plan). Upload tiếp tục được sau khi mất mạng, reload trang hoặc đóng trình duyệt. |
| NF-03 | **Mở rộng:** server ứng dụng stateless; byte của file không đi qua server ứng dụng; tăng tải bằng cách thêm instance. Không làm microservice, sharding hay đa vùng khi chưa cần. |
| NF-04 | **Bảo mật:** HTTPS; mật khẩu băm bằng Argon2; cookie HttpOnly/Secure/SameSite; CSRF; rate limit cho đăng nhập và endpoint nhạy cảm; presigned URL có hạn ngắn; kiểm tra quyền phía server. |
| NF-05 | **Toàn vẹn dữ liệu:** quota không bị vượt khi upload đồng thời; không để object mồ côi trên S3 lâu dài (có job dọn dẹp). |
| NF-06 | **Sao lưu:** backup PostgreSQL hằng ngày. Bucket không bật versioning; file được bảo vệ bởi thùng rác và lịch sử phiên bản. |
| NF-07 | **Khả dụng:** chấp nhận downtime ngắn khi deploy. |
| NF-08 | **Quan sát:** log có cấu trúc (JSON); theo dõi lỗi (Sentry hoặc tương đương); healthcheck endpoint. |
| NF-09 | **Trợ năng:** điều khiển được bằng bàn phím, đủ độ tương phản (WCAG AA), có nhãn ARIA. |
| NF-10 | **Trình duyệt:** 2 phiên bản mới nhất của Chrome, Firefox, Safari, Edge. |

## Thuật ngữ

| Thuật ngữ | Nghĩa |
|---|---|
| **Node** | Một mục trong cây thư mục: là *folder* hoặc *file* |
| **Folder** | Node chứa các node khác |
| **File** | Node trỏ tới một hoặc nhiều *version* |
| **Version** | Một lần upload nội dung cho một file. File luôn có đúng một *current version* |
| **Blob** | Object thật nằm trên S3 (key, size, checksum) |
| **Upload session** | Một phiên upload chia chunk (S3 multipart upload), có thể tiếp tục khi bị gián đoạn |
| **Owner** | Người sở hữu node. Dung lượng của node được tính vào quota của owner |
| **Share** | Quyền truy cập trên một node được cấp cho một người dùng khác |
| **Share link** | Link công khai, ai có link cũng truy cập được node |
| **Role** | Mức quyền: `viewer` (xem, tải) hoặc `editor` (thêm, sửa, xóa). Owner có toàn quyền |
| **Trash** | Thùng rác: node bị xóa mềm, có thể khôi phục trong thời hạn quy định |
| **Quota** | Dung lượng tối đa của một người dùng |
| **Plan** | Gói giới hạn (quota, kích thước file, số phiên bản, thời gian giữ thùng rác) gán cho user lúc đăng ký |
