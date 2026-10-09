# Thùng rác (F-TRASH)

**Trạng thái:** Nháp · **Milestone:** M4 · **Màn hình:** S-08

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
- Sau khi xóa, UI hiện toast "Đã chuyển vào thùng rác" kèm nút **Hoàn tác** trong khoảng 8 giây.

## Tiêu chí chấp nhận
- [ ] Xóa một folder có 1.000 node con chỉ tốn một request, và chạy dưới 1 giây.
- [ ] Xóa file con X, sau đó xóa folder cha A, rồi khôi phục A: X vẫn nằm trong thùng rác (vì có `trashed_root` riêng).
- [ ] Xóa vĩnh viễn thì quota giảm và object trên S3 bị xóa.
- [ ] Mục quá 30 ngày bị tự động xóa vĩnh viễn.
