# 0010. Lưu ý định dọn object S3 trong database

- Trạng thái: Chấp nhận · 2026-10-11
- Task: M4-01/M4-02 · [Kế hoạch M4 đã duyệt #30](https://github.com/q2kit/qloud/issues/30#issuecomment-6106220857)

## Quyết định

Ghi mỗi storage key cần dọn vào `drive_objectdeletion` trong cùng transaction
xóa Node/FileVersion và giảm quota. Sau commit, enqueue Celery để xóa object S3,
rồi xóa Blob không còn tham chiếu và ý định dọn đã hoàn tất. Key là unique;
worker xử lý batch 1.000 có khóa hàng và retry. M4-02 quét lại hàng đợi mỗi giờ.

## Lý do

Database và S3/broker không dùng chung transaction. Chỉ enqueue sau commit
có thể bỏ sót việc dọn khi broker lỗi hoặc process dừng trước enqueue; xóa S3
trước commit có thể làm mất byte trong khi database rollback. Ý định dọn bền vững
cho phép phục hồi độc lập, không cần thêm dịch vụ và giữ server stateless.

## Hệ quả

- Broker lỗi không đổi kết quả của API đã commit; hàng đợi vẫn có thể được quét lại.
- S3 lỗi giữ nguyên Blob/ý định dọn. Xóa object thiếu là idempotent để retry an toàn.
- Blob còn phiên bản tham chiếu được giữ lại; quota giảm theo phiên bản bị xóa,
  độc lập thời điểm xóa byte vật lý. Thumbnail cũng được ghi vào hàng đợi.
- Worker thumbnail khóa Node trước khi ghi output để phối hợp với xóa vĩnh viễn,
  tránh worker ghi lại object sau khi node đã bị xóa.
- Cần migration tạo bảng, Celery worker và một beat process cho lịch quét phục hồi.
  Hàng đợi chỉ lưu metadata storage key, không lưu byte file hay dữ liệu trên đĩa local.
