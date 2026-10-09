# 0005. Giới hạn theo plan, gán cố định cho user lúc đăng ký

- Trạng thái: Chấp nhận · 2026-10-09

## Quyết định
Bảng `Plan` gồm quota, kích thước file tối đa, số phiên bản giữ lại, thời gian giữ thùng rác. Mỗi user trỏ tới plan đang là mặc định
**tại thời điểm đăng ký**; `quota_override_bytes` cho phép admin cấp riêng từng người. Đổi giới hạn cho user mới = tạo plan mới và đặt làm mặc định.

## Lý do
- Giới hạn phải đổi được mà không ảnh hưởng user đã đăng ký, và cấp được khác nhau theo nhóm user.
- Biến môi trường (`DEFAULT_QUOTA`) ảnh hưởng mọi user và phải deploy lại. Chép quota vào từng user thì giới hạn rải rác, khó quản lý theo nhóm.

## Hệ quả
- Mọi chỗ cần giới hạn đều đọc qua `get_limits(user)`, không đọc thẳng từ plan.
- Plan đã có người dùng thì không xóa, chỉ đặt `is_active = false`.
