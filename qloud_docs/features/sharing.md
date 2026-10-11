# Chia sẻ (F-SHARE)

**Trạng thái:** Đang làm · **Milestone:** M5 · **Màn hình:** S-07, S-11, S-12

## User stories
- Tôi muốn chia sẻ một file hoặc folder cho người khác qua email, với quyền xem hoặc sửa.
- Tôi muốn tạo link công khai để ai có link cũng xem và tải được, có thể kèm hạn dùng.
- Tôi muốn xem ai đang có quyền, rồi đổi quyền hoặc thu hồi.
- Tôi muốn xem những gì người khác đã chia sẻ cho mình.

## Ma trận quyền

| Thao tác | viewer | editor | owner |
|---|:-:|:-:|:-:|
| Xem, liệt kê, tải về, xem trước | ✅ | ✅ | ✅ |
| Upload vào folder, tạo folder con | | ✅ | ✅ |
| Đổi tên, di chuyển trong phạm vi được chia sẻ | | ✅ | ✅ |
| Đưa vào thùng rác | | ✅ | ✅ |
| Tạo phiên bản mới, khôi phục phiên bản | | ✅ | ✅ |
| Chia sẻ tiếp cho người khác | | ✅ (tối đa bằng quyền của mình) | ✅ |
| Tạo hoặc thu hồi share link | | | ✅ |
| Xóa vĩnh viễn | | | ✅ |

## Quy tắc
- Quyền **được thừa kế** xuống cây con. Quyền thực tế là mức cao nhất trong các nguồn (xem architecture.md).
  MVP không có khái niệm "chặn thừa kế".
- Chỉ chia sẻ được cho email **đã có tài khoản**. Nếu email chưa có tài khoản thì gửi lời mời đăng ký (có thể để sau MVP).
- Người nhận được báo qua email, và mục được chia sẻ xuất hiện trong "Được chia sẻ với tôi". Mục này nằm ngoài cây của người nhận; MVP chưa có "Thêm lối tắt vào Drive".
- Share link: token ngẫu nhiên ít nhất 256 bit, chỉ có quyền xem, có tùy chọn `expires_at`, thu hồi được. Một node có thể có nhiều link.
  Trang `/s/:token` không cần đăng nhập. Nếu node là folder thì chỉ duyệt được bên trong cây con của nó.
- Node trong thùng rác thì không truy cập được qua bất kỳ hình thức chia sẻ nào.
- Truy cập không có quyền thì trả **404**, không trả 403.

### Báo cáo vi phạm và kiểm duyệt
- Trang link công khai (S-12) có nút **"Báo cáo vi phạm"**, ai cũng dùng được, không cần đăng nhập.
  Form gồm: lý do (bắt buộc), mô tả, email liên hệ (không bắt buộc), và Cloudflare Turnstile.
- Rate limit: 5 báo cáo mỗi giờ trên mỗi IP. Báo cáo trùng (cùng IP, cùng link, trong 24 giờ) thì bỏ qua nhưng vẫn trả thành công.
- Khi có báo cáo mới: email cho admin (địa chỉ `MODERATION_EMAIL` trong `.env`).
- Admin xử lý trong Django admin:
  - **Gỡ link:** gán `revoked_at`, `revoke_reason = moderation`.
  - **Gỡ mọi link của một node.**
  - **Khóa user:** chặn đăng nhập và vô hiệu mọi share link của user đó.
  - **Bỏ qua** báo cáo.

  Mỗi thao tác phải được ghi lại (ai, lúc nào, ghi chú).
- Owner được email thông báo khi link bị gỡ vì kiểm duyệt. Owner không thể bật lại link đó, nhưng có thể tạo link mới (trừ khi đang bị khóa).
- Truy cập một link đã bị gỡ vì kiểm duyệt thì trả 404 với thông báo "Nội dung không còn khả dụng".

## Tiêu chí chấp nhận
- [ ] Có bộ test ma trận đầy đủ: mỗi role × mỗi thao tác × (node trực tiếp, node con được thừa kế).
- [ ] Thu hồi share thì người nhận mất quyền ngay ở request tiếp theo.
- [ ] Link hết hạn hoặc đã bị thu hồi thì trả 404 kèm trang thông báo thân thiện.
- [ ] Gửi báo cáo từ trang link công khai thì admin nhận email, và báo cáo hiện trong admin.
- [ ] Admin gỡ link thì link ngừng hoạt động ngay; khóa user thì user không đăng nhập được và mọi link của user ngừng hoạt động.
- [ ] Qua link của folder A, không thể truy cập node nằm ngoài A bằng cách đổi `node_id`.

## Tiến độ M5-01
- Model Share và lớp quyền chung hỗ trợ share trực tiếp/thừa kế nhiều tầng; queryset giữ được lọc và phân trang, không N+1.
- Breadcrumb của người nhận chỉ chứa đường dẫn liên tục mà họ xem được; upload session cũng không lưu tên tổ tiên ngoài quyền.
- Editor chỉ di chuyển node con trong cùng một folder được cấp editor (không chuyển giữa hai cây được chia sẻ riêng, không di chuyển chính gốc chia sẻ bằng grant trên gốc đó).
- Editor có thể đưa node vào thùng rác của owner; share ngừng cấp quyền ngay. Khôi phục thùng rác, liệt kê và xóa vĩnh viễn vẫn dành cho owner.
- API quản lý share/danh sách được chia sẻ, ShareLink, email, UI và bộ ma trận toàn milestone thuộc M5-02…M5-07.

## Ngoài phạm vi
Mật khẩu cho share link, quyền sửa qua share link, mời người chưa có tài khoản (có thể làm sau MVP), chặn thừa kế quyền.
