# Thùng rác (F-TRASH)

**Trạng thái:** Đang làm · **Milestone:** M4 · **Màn hình:** S-08

## User stories
- Tôi muốn xóa file mà không sợ mất ngay, và có thể hoàn tác.
- Tôi muốn khôi phục hoặc xóa vĩnh viễn các mục trong thùng rác.

## Quy tắc
- Đưa vào thùng rác: gán `trashed_at`, `trashed_by` cho node đó **và toàn bộ cây con**, với `trashed_root_id` = node được chọn.
  Việc này phải chạy trong một transaction; cây lớn thì dùng một câu UPDATE với recursive CTE.
- Trang Thùng rác chỉ liệt kê các `trashed_root` mà mình là owner, hoặc mình đã xóa (nếu là editor).
- Khôi phục: bỏ đánh dấu cho toàn bộ cây có cùng `trashed_root_id`.
  - Nếu folder cha không còn (đã bị xóa vĩnh viễn hoặc đang trong thùng rác) thì khôi phục về **folder gốc** của owner.
  - Nếu trùng tên thì tự thêm hậu tố.
- Xóa vĩnh viễn (chỉ owner): xóa các bản ghi Node, FileVersion; xóa Blob và object trên S3 bằng Celery **sau khi commit**; giảm `used_bytes`.
- Tự động xóa vĩnh viễn sau `trash_retention_days` (theo plan của owner, mặc định **30 ngày**) kể từ `trashed_at` (Celery beat chạy hằng ngày).
- Node trong thùng rác **vẫn tính vào quota**.
- Trong Drive, phím **Delete** đưa các mục đang chọn vào thùng rác như nút/menu; không kích hoạt khi nhập liệu, có menu/dialog, giữ modifier hoặc request đang chạy. Không chọn mục thì không làm gì.
- Sau khi xóa, UI hiện toast "Đã chuyển vào thùng rác" kèm nút **Hoàn tác** trong khoảng 8 giây.

## Tiêu chí chấp nhận
- [x] Xóa một folder có 1.000 node con chỉ tốn một request, và chạy dưới 1 giây.
- [x] Xóa file con X, sau đó xóa folder cha A, rồi khôi phục A: X vẫn nằm trong thùng rác (vì có `trashed_root` riêng).
- [x] Xóa vĩnh viễn thì quota giảm và object trên S3 bị xóa.
- [x] Mục quá 30 ngày bị tự động xóa vĩnh viễn.

## Triển khai M4

Đặc tả và kế hoạch M4 được owner duyệt ngày 11/10/2026 trong phiên làm việc;
[kế hoạch trên #30](https://github.com/q2kit/qloud/issues/30#issuecomment-6106220857).

- M4-01: API thùng rác theo nhóm, hiện hỗ trợ owner; quyền editor theo chia sẻ nối vào M5.
- Khi chọn cả folder và con còn sống trong một request, chỉ folder ngoài cùng là nhóm xóa.
  Nhóm đã nằm trong thùng rác giữ nguyên root và thời điểm xóa.
- Khôi phục/xóa vĩnh viễn chỉ nhận ID root của nhóm; chọn đồng thời các nhóm lồng nhau thì
  khôi phục cha trước. Xóa vĩnh viễn folder bao gồm cả nhóm xóa cũ còn ở bên trong.
- Xóa bản ghi và trừ quota (tổng size của mọi FileVersion bị xóa) trong transaction.
  Lưu ý định dọn S3 trong `drive_objectdeletion`; Celery dọn sau commit, giữ Blob tới khi
  S3 xác nhận. Blob còn phiên bản tham chiếu được giữ lại. Thumbnail các phiên bản cũng được dọn.
  Broker lỗi không làm API báo thất bại cho thao tác đã commit; ý định dọn vẫn trong database.
- M4-02: Celery beat quét quá hạn hằng ngày theo plan hiện tại của owner (kể cả tài khoản bị khóa),
  mỗi batch tối đa 200 root; lấy khóa owner và kiểm tra lại trạng thái/hạn trước khi xóa từng nhóm.
  Quét lại hàng đợi dọn S3 mỗi giờ để phục hồi sau lỗi broker hoặc hết retry.
  Xóa/retry an toàn khi chạy nhiều worker, hoặc nhóm đã được khôi phục/xóa bởi request khác.
- M4-03: `/trash` dùng FileBrowser/NodeCollection cho lưới/danh sách, sắp xếp, cursor,
  chọn nhiều và menu theo ngữ cảnh. Khôi phục/xóa nhóm đã chọn; xác nhận trước xóa vĩnh viễn/dọn sạch,
  focus ban đầu ở Hủy. Drive hỗ trợ đưa một hoặc nhiều mục vào thùng rác, cập nhật optimistic và rollback khi lỗi.
  Toast Hoàn tác khoảng 8 giây tồn tại qua chuyển trang; dùng ID root server trả về.
  Các file trash hiện thumbnail ảnh/PDF/MP4 trong viewport (grid/list); thiếu/lỗi dùng icon. Owner dùng API preview với `trashed_thumbnail=true`, chỉ cấp URL thumbnail, không cấp URL nguồn hay download. Cache thumbnail Trash riêng và refresh theo hạn thumbnail; không polling chờ tạo thumbnail. Đủ bản dịch vi/en và light/dark 360px.
- Code M4 đã triển khai đủ trong ba PR nối tiếp; chờ owner review/merge để hoàn tất milestone.
