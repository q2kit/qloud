# Phiên bản file (F-VERSION)

**Trạng thái:** Đang làm · **Milestone:** M7 · **Vị trí trên UI:** tab "Phiên bản" trong panel chi tiết

Đặc tả M7 và kế hoạch M7-01 được owner duyệt ngày 12/10/2026, xem [kế hoạch #42](https://github.com/q2kit/qloud/issues/42#issuecomment-6123665511).

## User stories
- Khi upload một file trùng tên, tôi muốn thay thế nó mà vẫn giữ được bản cũ.
- Tôi muốn xem lịch sử phiên bản, tải hoặc khôi phục một phiên bản cũ.

## Quy tắc
- Mỗi file có một hoặc nhiều `FileVersion`, với `version_number` tăng dần. Node trỏ tới `current_version`.
- Tạo phiên bản mới bằng cách: upload với `target_node_id`, hoặc chọn *Thay thế* khi upload trùng tên. Cần quyền `editor`.
- Khôi phục phiên bản cũ: tạo một **phiên bản mới** có nội dung giống phiên bản cũ. Hai phiên bản dùng chung Blob nên không tốn thêm dung lượng.
  Khi đó Blob cần đếm số tham chiếu (reference count), hoặc chỉ được xóa khi không còn version nào trỏ tới.
- Xóa một phiên bản: chỉ owner, không xóa được phiên bản hiện tại. Dung lượng chỉ được giảm khi Blob không còn ai tham chiếu.
- Chính sách giữ lại phiên bản theo plan của owner: giữ tối đa `max_versions_per_file` phiên bản cũ, và phiên bản cũ quá `version_retention_days` thì bị dọn
  (plan mặc định: 100 phiên bản, 30 ngày). Phiên bản được đánh dấu **"Giữ mãi"** (`keep_forever`) không bị dọn tự động. Celery dọn hằng ngày.
- Mọi phiên bản đều tính vào quota của owner.

## M7-01 — Upload phiên bản mới
- `POST /uploads` nhận `target_node_id` hoặc `on_conflict=replace`. `parent_id` vẫn bắt buộc, phải là cha của target lúc tạo session. Target là file còn sống; không thay thế folder hoặc file không còn tồn tại (`invalid_target`, 400).
- Target tường minh cần editor trên file; editor được chia sẻ riêng file không cần quyền trên folder cha. Thay thế theo tên cần editor trên folder và file, khớp tên không phân biệt hoa thường. UUID được chốt vào session; `on_conflict=replace` đánh dấu upload phiên bản cả khi FK target bị xóa thành null.
- Kiểm tra email đã xác thực, giới hạn file/quota theo owner. Bản cũ vẫn tính quota; không trừ dung lượng bản cũ để nhận upload mới.
- Complete giữ UUID/tên/vị trí/share/link; thêm Blob và FileVersion, tăng số thứ tự theo version cao nhất dưới khóa owner rồi node. Hai upload cạnh tranh tạo hai version khác nhau; gọi lại cùng session không tạo thêm version.
- File đổi tên/di chuyển trong lúc upload vẫn nhận version theo UUID nếu còn quyền. Target trash/purge hoặc mất quyền thì hủy session, trả reservation, dọn object đã ghép và trả 409 `target_unavailable`; không tạo file mới hoặc tự chọn file khác cùng tên.
- Current version, size, MIME và updated_at đổi nguyên tử; reset thumbnail cũ, enqueue thumbnail cho bản mới sau commit. Preview/download/link chia sẻ lấy nội dung mới. Blob/version cũ được giữ nguyên.
- UI trùng tên có **Thay thế**, **Giữ cả hai**, **Bỏ qua**, cùng áp dụng cho các file còn lại. Upload dở dang resume vào cùng target qua session cũ. Hoàn tất làm mới chi tiết node, folder ban đầu/folder hiện tại, Gần đây và danh sách Được chia sẻ.
- Migration `uploads.0002` thêm FK nullable và mở rộng on_conflict. Khi rollback, session thay thế đang active bị hủy và trả quota; Blob/version đã hoàn tất vẫn giữ nguyên. Multipart dở dang còn trên S3 được lifecycle 8 ngày dọn.
- API lịch sử/restore/delete ở M7-02; tab Phiên bản ở M7-03; dọn theo plan/“Giữ mãi” ở [M7-04 #159](https://github.com/q2kit/qloud/issues/159).

## Tiêu chí chấp nhận
- [x] Upload trùng tên, chọn *Thay thế*: file có 2 phiên bản; xem trước và tải về đều lấy bản mới.
- [ ] Khôi phục v1: tạo ra v3 có nội dung giống v1; quota không tăng.
- [ ] Tải được bất kỳ phiên bản nào.
