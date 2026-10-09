# Phiên bản file (F-VERSION)

**Trạng thái:** Nháp · **Milestone:** M7 · **Vị trí trên UI:** tab "Phiên bản" trong panel chi tiết

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

## Tiêu chí chấp nhận
- [ ] Upload trùng tên, chọn *Thay thế*: file có 2 phiên bản; xem trước và tải về đều lấy bản mới.
- [ ] Khôi phục v1: tạo ra v3 có nội dung giống v1; quota không tăng.
- [ ] Tải được bất kỳ phiên bản nào.
