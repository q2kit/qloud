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
- [x] Thu hồi share thì người nhận mất nguồn quyền đó ngay ở request tiếp theo; nếu còn grant khác thì quyền thực tế là mức cao nhất còn lại.
- [x] Link hết hạn hoặc đã bị thu hồi thì trả 404 ở API và có trang thông báo thân thiện.
- [ ] Gửi báo cáo từ trang link công khai thì admin nhận email, và báo cáo hiện trong admin.
- [ ] Admin gỡ link thì link ngừng hoạt động ngay; khóa user thì user không đăng nhập được và mọi link của user ngừng hoạt động.
- [x] Qua link của folder A, không thể truy cập node nằm ngoài A bằng cách đổi `node_id`.

## Tiến độ M5-01
- Model Share và lớp quyền chung hỗ trợ share trực tiếp/thừa kế nhiều tầng; queryset giữ được lọc và phân trang, không N+1.
- Breadcrumb của người nhận chỉ chứa đường dẫn liên tục mà họ xem được; upload session cũng không lưu tên tổ tiên ngoài quyền.
- Editor chỉ di chuyển node con trong cùng một folder được cấp editor (không chuyển giữa hai cây được chia sẻ riêng, không di chuyển chính gốc chia sẻ bằng grant trên gốc đó).
- Editor có thể đưa node vào thùng rác của owner; share ngừng cấp quyền ngay. Khôi phục thùng rác, liệt kê và xóa vĩnh viễn vẫn dành cho owner.
- API quản lý share/danh sách được chia sẻ, ShareLink, email, UI và bộ ma trận toàn milestone thuộc M5-02…M5-07.

## Tiến độ M5-02
- API liệt kê/tạo grant trực tiếp, đổi quyền/thu hồi và danh sách được chia sẻ đã triển khai; danh sách đều cursor pagination.
- Owner/editor quản lý mọi grant trực tiếp trên node còn sống; viewer không xem danh sách người nhận hoặc quản lý grant. Grant thừa kế không được sửa qua node con. `can_share` bật cho editor/owner ở node không phải folder gốc.
- Người nhận được tra bằng email chính không phân biệt hoa thường, phải có tài khoản active và không bị khóa. Không chia sẻ cho chính người thao tác, cho owner hoặc chia sẻ folder gốc. Tạo grant trùng trả 409; đổi role bằng PATCH.
- Grant do editor tạo là độc lập: thu hồi quyền editor không tự xóa các grant họ đã tạo; owner quản lý/thu hồi riêng. Quy tắc này và hợp đồng API được owner duyệt trong kế hoạch #34.
- "Được chia sẻ với tôi" chỉ liệt kê node có grant trực tiếp cho mình, không thuộc sở hữu của mình, còn sống; không bung hậu duệ. Grant trên cha và con thì cả hai xuất hiện. `effective_role` tính cả quyền thừa kế; thông tin owner chỉ id/display_name.
- Email thông báo thuộc M5-04, UI chia sẻ thuộc M5-05. M5-02 kiểm thử API stack thật và việc duyệt node được chia sẻ qua Drive hiện có.

## Tiến độ M5-03
- ShareLink có token ngẫu nhiên 256 bit, role chỉ viewer, tùy chọn hạn dùng và thông tin thu hồi. Owner quản lý nhiều link trên node còn sống, không phải folder gốc; editor không được tạo/thu hồi link.
- Public API đọc chi tiết, liệt kê folder, download và preview. Token chỉ mở root/cây con cùng owner còn sống; quyền session của caller không mở rộng phạm vi. Breadcrumb dừng ở root của link, parent_id của root là null.
- Link sai/hết hạn/thu hồi, owner inactive/suspended hoặc node trong thùng rác đều trả cùng 404. Không cache quyền qua request; node chuyển ra ngoài cây mất quyền qua token ngay.
- URL nguồn/thumbnail đi thẳng S3, tối đa 5 phút và không quá expires_at của link (làm tròn xuống theo giây). Thu hồi chặn cấp URL mới ngay; URL S3 đã cấp dùng được tới hạn chữ ký. Mật khẩu/quyền sửa qua token không thuộc MVP.
- Owner không bật lại link đã thu hồi; DELETE lại trả 204, giữ nguyên audit kể cả reason moderation. Công cụ kiểm duyệt/báo cáo/email thuộc M5-07; màn hình public S-12 thuộc M5-05.
- Hợp đồng chi tiết public (node_id tùy chọn) và preview bổ sung cùng giới hạn URL đã cấp được owner duyệt trong kế hoạch #35.

## Tiến độ M5-04
- Tạo Share trực tiếp thành công gửi email text/HTML qua Celery sau transaction commit. Rollback, request lỗi/không có quyền, grant trùng, PATCH role, DELETE share và ShareLink không gửi email; thu hồi rồi tạo grant mới gửi thông báo mới. Không gửi riêng cho hậu duệ thừa kế.
- Nội dung dùng locale vi/en của người nhận, gồm người thực hiện chia sẻ (display_name, fallback email), tên/loại mục, role đã dịch và link APP_BASE_URL. HTML escape dữ liệu; subject cố định đã dịch, không có tên người dùng/file tùy ý.
- Email giữ snapshot khi tạo grant; đổi tên/quyền/email/locale hoặc thu hồi sau đó không sửa thông báo đã xếp hàng. Link folder `/drive/folders/<UUID compact>`, file `/drive/files/<UUID compact>`; truy cập luôn kiểm tra quyền hiện tại và đăng nhập bằng tài khoản nhận email.
- Tái sử dụng `accounts.tasks.send_email` và retry SMTP/OSError hiện có; không thêm outbox hoặc bảo đảm exactly-once. Worker Celery cần chạy như email auth.
- M5-08: link file chia sẻ riêng mở viewer độc lập nếu folder cha trả 404; không hiển thị folder cha/file cùng cấp, không tải danh sách cha, tắt chuyển file. Đóng viewer về Drive của người nhận. Thu hồi grant khiến mở lại link, preview và download bị từ chối bởi API.

## Tiến độ M5-05
- S-11: action Chia sẻ trong toolbar/menu Drive và panel chi tiết cho một mục có `can_share`. Hộp thoại liệt kê grant trực tiếp (cursor), thêm email viewer/editor, đổi role, thu hồi; thông báo quyền thừa kế phải quản lý ở mục nguồn. Không hiển thị email/tên lỗi thô từ server.
- Owner tạo nhiều link có hạn dùng (nhập giờ local, gửi ISO) hoặc không hết hạn, sao chép URL `/s/:token`, xem trạng thái hết hạn/thu hồi và thu hồi. Editor chỉ quản lý grant người dùng; API links trả 404 thì hiển thị chỉ owner quản lý link. Link thu hồi không bật lại.
- S-07 `/shared` dùng FileBrowser/NodeCollection với cursor/sắp xếp/grid/list, hiển thị owner và quyền thực tế; chỉ liệt kê grant trực tiếp, không tự bung cây. Folder mở trong Drive; file mở route canonical (kể cả chia sẻ file riêng). Có loading/rỗng/lỗi/thử lại.
- Drive lấy capabilities cho mục đang chọn để hiện action ghi/chia sẻ. Folder viewer không nhận upload/drop hay mở tạo folder; header tạo mới bị vô hiệu. Breadcrumb/back trong cây được chia sẻ dùng UUID của mục, chỉ gọi “Drive của tôi” khi đúng root của người nhận.
- S-12 `/s/:token` dùng layout công khai, không yêu cầu session. Root file tự mở viewer; đóng vẫn ở trang link và mở lại được. Folder có breadcrumb trong cây, grid/list, cursor/sắp xếp, viewer chuyển file và tải trực tiếp S3. Không có action ghi hoặc đường về tổ tiên ngoài phạm vi link.
- Query/cache node, danh sách và preview/thumbnail public tách theo token; public viewer luôn dùng API token dù visitor đã đăng nhập. Preview dùng cơ chế refresh URL và component ảnh/PDF/media/text hiện có. Link sai/hết hạn/thu hồi hoặc folder ngoài cây có thông báo nội dung không còn khả dụng; các lỗi khác cho thử lại.
- Nút/form báo cáo vi phạm và moderation thuộc M5-07 (#39); S-12 chưa hiện action chưa có API.

## Ngoài phạm vi
Mật khẩu cho share link, quyền sửa qua share link, mời người chưa có tài khoản (có thể làm sau MVP), chặn thừa kế quyền.
