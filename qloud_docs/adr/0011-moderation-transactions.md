# ADR-0011 — Transaction và audit kiểm duyệt

- Trạng thái: Chấp nhận
- Ngày: 2026-10-11
- Phạm vi: M5-07 (#39), theo kế hoạch và quyết định owner trên issue

## Bối cảnh

Báo cáo công khai có quota 5 báo cáo mới/IP/giờ và dedup cùng IP/link trong 24 giờ. Nhiều process backend có thể nhận cùng lúc; kiểm tra rồi ghi riêng lẻ dễ vượt quota hoặc gửi nhiều email. Kiểm duyệt phải giữ audit dù node/link bị purge và tránh hai moderator xử lý cùng report.

## Quyết định

Dùng HMAC-SHA256 IP bằng secret ứng dụng, không lưu IP gốc. PostgreSQL transaction advisory lock lấy từ 64 bit đầu của hash tuần tự hóa kiểm tra quota/dedup và ghi report trên mọi instance. Xung đột hash khóa chỉ làm chờ thêm; quota vẫn truy vấn bằng đầy đủ hash. Không thêm dependency/công nghệ.

Tạo report trong transaction, khóa owner và kiểm tra lại link/phạm vi bằng lớp quyền public chung. Khi resolve, khóa actor/owner/các superuser theo thứ tự UUID giống service suspension hiện có, rồi khóa report và các link được sửa. Report chỉ xử lý một lần. Report, trạng thái link/user và audit được commit nguyên tử; email enqueue bằng on_commit, dùng task email với retry hiện có.

Audit là một bản ghi cho mỗi report, chỉ thêm từ service, không có API/Django admin sửa/xóa. FK nullable SET_NULL cùng snapshot UUID/tên giữ lịch sử khi đích bị xóa. Màn hình React `/moderation` và các API chỉ dành cho superuser; `/me.is_superuser` chỉ đọc để hiển thị điều hướng. Django `/admin/` đọc report/audit, các thao tác xử lý thực hiện qua màn hình mới.

## Hệ quả

Khóa IP được tự giải phóng khi transaction kết thúc; không dựa vào cache/process để quyết định quota. Resolver là thao tác ít thường xuyên nên việc khóa các superuser phù hợp MVP. Đổi secret làm đổi hash và bắt đầu cửa sổ quota/dedup mới cho IP đó. Audit giữ UUID và tên snapshot, cần xác định chính sách lưu trữ nếu sản phẩm bổ sung yêu cầu retention sau MVP. Không có endpoint mở lại report.
