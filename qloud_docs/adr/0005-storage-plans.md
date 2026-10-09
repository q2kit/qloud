# 0005. Giới hạn theo plan, gán cố định cho user lúc đăng ký

- Trạng thái: Chấp nhận
- Ngày: 2026-10-09

## Bối cảnh
Giới hạn của user (quota, kích thước file tối đa, số phiên bản giữ lại…) phải thay đổi được theo thời gian
mà không ảnh hưởng user đã đăng ký, và admin phải cấp được giới hạn khác nhau cho từng nhóm user.

## Quyết định
Dùng bảng `Plan`, mỗi plan gồm: quota, kích thước file tối đa, số phiên bản giữ lại, thời gian giữ thùng rác. Mỗi user trỏ tới một plan,
được gán bằng plan đang là mặc định **tại thời điểm đăng ký**. Ngoài ra có `quota_override_bytes` để admin cấp riêng cho từng người.
Muốn đổi giới hạn cho user mới thì tạo plan mới và đặt nó làm mặc định.

## Lý do và các phương án đã cân nhắc
- **Đặt giới hạn trong biến môi trường (`DEFAULT_QUOTA`):** đổi giá trị thì ảnh hưởng mọi user, và phải deploy lại. Không đáp ứng yêu cầu.
- **Chép quota vào từng user lúc đăng ký:** user cũ không bị ảnh hưởng, nhưng các giới hạn bị rải rác ở từng user,
  khó quản lý theo nhóm, và không có khái niệm gói.
- **Plan:** đáp ứng yêu cầu, đổi được ngay trong admin không cần deploy, và thêm gói mới chỉ là thêm một dòng.

## Hệ quả
- Mọi chỗ cần giới hạn đều đọc qua một hàm chung `get_limits(user)`, không đọc thẳng từ plan.
- Plan đã có người dùng thì không xóa, chỉ đặt `is_active = false`.
