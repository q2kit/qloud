# 0003. Upload thẳng lên S3 bằng multipart + presigned URL

- Trạng thái: Chấp nhận · 2026-10-09

## Quyết định
S3 Multipart Upload. Backend tạo multipart upload và cấp presigned URL cho từng part; trình duyệt PUT từng part thẳng lên S3.
Trạng thái các part lấy từ S3 (`ListParts`), không lưu trong DB. Backend chỉ hoàn tất upload và ghi metadata.
Mọi kích thước file dùng chung luồng này (file 0 byte là ngoại lệ, xem [upload.md](../features/upload.md)).

## Lý do
- Upload qua Django tốn băng thông, RAM và giữ request rất lâu. tus (tusd) phải chạy thêm service và lưu trạng thái riêng.
- Với multipart, part nào đã lên thì nằm sẵn trên S3 nên resume tự nhiên; hỗ trợ file tới 5 TB.

## Hệ quả
- Bucket phải có CORS và expose header `ETag`.
- Phải dọn multipart upload bỏ dở (Celery + lifecycle rule của bucket).
- Dùng được mọi dịch vụ tương thích S3 (AWS, R2…); dev và CI dùng LocalStack (ADR-0007).
