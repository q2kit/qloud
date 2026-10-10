# 0008. Tiếp tục upload bằng fingerprint lưu trên server

- Trạng thái: Chấp nhận · 2026-10-10
- Task: M2-08b · [Kế hoạch đã duyệt #24](https://github.com/q2kit/qloud/issues/24#issuecomment-6098540092)

## Quyết định
Dùng fingerprint đã lưu trong UploadSession và danh sách `GET /uploads?status=active`
để tiếp tục sau reload; không lưu ánh xạ session trong IndexedDB.
Người dùng chọn lại file cho từng session. Fingerprint dùng tên, kích thước,
lastModified và SHA-256 của 1 MiB đầu; băm JSON các giá trị này thành hex 64 ký tự
để luôn vừa giới hạn 128 ký tự của API. Chỉ khi khớp mới gắn file vào session cũ,
đọc ListParts và gửi các part thiếu.

## Lý do
Server đã có fingerprint và session được phân trang theo người tạo, nên không cần
đồng bộ thêm dữ liệu trình duyệt. Có thể tiếp tục ở trình duyệt khác, miễn file và
metadata vẫn khớp. Chỉ đọc 1 MiB nên không giữ toàn bộ file lớn trong bộ nhớ.

## Hệ quả
- Trình duyệt vẫn yêu cầu người dùng chọn lại file; không tự đọc file local.
- Session active nằm trong TanStack Query; engine chỉ giữ File và trạng thái hàng đợi.
- Thời gian chỉnh sửa khác thì không khớp. Đây là nhận diện file để resume, không phải checksum toàn file.
- Session từ M2-08a dùng fingerprint nhanh chưa có hash: hủy và tải lại nếu muốn dùng định dạng mới.
- Đăng xuất dừng request local, giữ session trên server để tiếp tục khi đăng nhập lại.
