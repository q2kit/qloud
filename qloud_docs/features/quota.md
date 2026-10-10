# Quota dung lượng (F-QUOTA)

**Trạng thái:** Đang làm (phần model M1 đã duyệt; phần M2 đã duyệt ở [#17](https://github.com/q2kit/qloud/issues/17); phần M8 chờ duyệt) · **Milestone:** M1 (model Plan), M2 (kiểm tra quota), M8 (giao diện) · **Màn hình:** S-14, thanh dung lượng ở sidebar
Xem thêm [ADR-0005](../adr/0005-storage-plans.md)

Phần User/Plan/quota M1 được [chủ repo duyệt](https://github.com/q2kit/qloud/issues/10#issuecomment-6088713465).
M1-01 cung cấp `accounts.selectors.get_limits(user)` trả quota, kích thước file tối đa và chính sách giữ phiên bản/thùng rác.
Hàm đọc lại user và plan trong một truy vấn, nên thay đổi của admin có hiệu lực ngay, kể cả quota override bằng 0.
Chưa có API upload hay giao diện quota ở M1-01.

Django admin đổi mặc định bằng action "Dùng gói này cho tài khoản đăng ký mới", chọn đúng một plan active.
Tạo user đọc plan mặc định không khóa dòng: `set_default_plan()` đổi mặc định trong một transaction, nên lượt đăng ký thấy trạng thái trước hoặc sau khi đổi, không thấy trạng thái giữa chừng.
Khi insert user, kiểm tra foreign key của PostgreSQL tự lấy [`FOR KEY SHARE`](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS) trên plan, nên plan không bị xóa trong lúc tạo user.
`set_default_plan()` khóa các plan bằng `FOR NO KEY UPDATE` theo thứ tự UUID: hai lượt đổi mặc định chạy lần lượt, còn đăng ký không phải chờ.
Không xóa plan mặc định hoặc plan đã được gán cho user; plan inactive vẫn giữ giới hạn cho user cũ.
Đơn vị seed: 1 GB = 1.000.000.000 byte.

M2-04: tạo upload session giữ chỗ quota (`reserved_bytes`) trong transaction có khóa dòng User của owner; hoàn tất chuyển sang `used_bytes`, hủy thì trả lại.
Test tranh chấp: 10 session đồng thời mà tổng vượt quota thì chỉ những session còn vừa được nhận.

## User stories
- Tôi muốn biết mình đã dùng bao nhiêu dung lượng và phần nào chiếm nhiều nhất.
- Tôi muốn được cảnh báo trước khi hết dung lượng.
- (Admin) Tôi muốn đổi giới hạn cho user đăng ký mới mà không ảnh hưởng user cũ, và cấp thêm dung lượng cho từng người.

## Quy tắc
- Giới hạn của user lấy từ **plan** được gán lúc đăng ký. Riêng quota có thể bị ghi đè bằng `quota_override_bytes`.
  Mọi chỗ cần giới hạn đều gọi `get_limits(user)`.
- Dung lượng tính cho owner gồm: mọi phiên bản của file, kể cả trong thùng rác. Thumbnail không tính. Phần đang giữ chỗ cho upload dở dang cũng tính.
- Kiểm tra khi tạo upload session: phải thỏa `used + reserved + size <= quota`, nếu không thì trả 413 `quota_exceeded`;
  và `size <= max_file_size`, nếu không thì trả 413 `file_too_large`.
- Cảnh báo trên UI khi dùng từ 80% (vàng) và từ 95% (đỏ). Khi hết dung lượng thì chặn upload nhưng **vẫn cho xem, tải và xóa**.
- Nếu quota bị giảm xuống dưới mức đã dùng: không xóa gì, chỉ chặn upload mới.
- Đối soát: Celery chạy hằng đêm để tính lại `used_bytes` từ dữ liệu thật. Nếu lệch thì ghi log cảnh báo rồi sửa lại.
- Admin (Django admin): tạo plan, đổi plan mặc định, đổi plan của một user, đặt quota riêng.

## Tiêu chí chấp nhận
- [ ] Đổi plan mặc định: user đăng ký sau đó nhận plan mới; user cũ giữ nguyên giới hạn.
- [ ] Đặt `quota_override_bytes` cho một user thì có hiệu lực ngay.
- [ ] Sidebar hiển thị đúng "x GB / y GB".
- [ ] Trang dung lượng chia theo loại file, và liệt kê các file lớn nhất.
- [ ] Gửi 10 upload đồng thời mà tổng vượt quota thì chỉ những upload còn vừa quota được chấp nhận.
