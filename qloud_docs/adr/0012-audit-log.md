# ADR-0012 — Audit log cho file, folder và chia sẻ

- Trạng thái: Chấp nhận
- Ngày: 2026-10-18
- Phạm vi: M8-11 (#167), kế hoạch đã duyệt trên issue

## Bối cảnh

Panel chi tiết cần tab Hoạt động, nhưng hệ thống chưa ghi lại thao tác nào trên node. Chỉ có audit riêng của kiểm duyệt (`moderation_action`, ADR-0011), dành cho superuser và chứa dữ liệu khác hẳn. Lịch sử phải đúng với transaction (thao tác lỗi không để lại dấu vết), vẫn đọc được khi node, folder hoặc người thực hiện đã bị xóa, và không cho người xem biết thêm điều gì ngoài phần cây họ có quyền.

## Quyết định

- App `audit` với một bảng `audit_event`, chỉ thêm, ghi qua service `audit.services` **trong transaction của chính thao tác**. Không dùng signal, để mỗi điểm ghi hiện rõ trong service và gom được nhiều mục thành một INSERT.
- Mỗi sự kiện giữ snapshot tên/loại node và tên người thực hiện. FK tới node, folder chứa (`parent`), folder nguồn khi di chuyển (`source_parent`) và người thực hiện đều `SET_NULL`; FK owner `CASCADE` (xóa tài khoản thì xóa lịch sử của họ).
- Thao tác hàng loạt ghi một sự kiện cho mỗi mục được chọn (node gốc), không ghi cho con cháu. Job dọn thùng rác và dọn phiên bản ghi `actor_kind=system`. Kiểm duyệt gỡ link ghi `actor_kind=moderator` mà không lưu danh tính quản trị viên; `moderation_action` vẫn giữ riêng.
- Không ghi download/preview. Không lưu key S3, URL presigned, token link, IP hay user agent.
- Đọc qua `GET /nodes/{id}/activity` với quyền viewer trở lên, qua lớp phân quyền chung. Folder trả sự kiện có node, folder chứa hoặc folder nguồn nằm trong cây con của nó, kể cả mục trong thùng rác. Vì quyền tính từ node được mở, người chỉ có quyền ở nhánh con không đọc được phần trên.
- Dữ liệu nhạy cảm được ẩn khi trả về: email của người thực hiện và người nhận chia sẻ chỉ trả cho editor/owner; tên folder trong sự kiện di chuyển chỉ trả khi người đọc là owner hoặc mở được folder đó.
- Giữ 365 ngày, cố định, không tính vào plan; beat `expire-audit-events` xóa theo lô hằng ngày.

## Hệ quả

Mỗi thao tác ghi thêm một INSERT (một câu cho cả lô). Xóa node kích hoạt `SET_NULL` trên các sự kiện tham chiếu. Đọc hoạt động của folder dùng một CTE cây con và ba index theo `node`/`parent`/`source_parent`, số query cố định theo trang; cây rất lớn có thể chậm hơn danh sách thường (theo dõi cùng NF-01). Upload thư mục ghi một sự kiện cho mỗi file vì mỗi file là một request riêng.
