# 0003. Upload thẳng lên S3 bằng multipart + presigned URL

- Trạng thái: Chấp nhận
- Ngày: 2026-10-09

## Bối cảnh
Cần hỗ trợ file rất lớn, upload chia chunk, tiếp tục khi lỗi ("up đến đâu lưu đến đấy"), và mở rộng được cho nhiều người dùng.

## Quyết định
Dùng S3 Multipart Upload. Backend tạo multipart upload và cấp presigned URL cho từng part; trình duyệt PUT từng part thẳng lên S3.
Trạng thái các part lấy từ S3 (`ListParts`). Backend chỉ hoàn tất upload và ghi metadata.
Mọi kích thước file đều dùng chung một luồng này (file 0 byte là ngoại lệ, xem upload.md).

## Lý do và các phương án đã cân nhắc
- **Upload đi qua server Django:** tốn băng thông và RAM của VPS, request bị giữ rất lâu, khó mở rộng. Loại.
- **Giao thức tus (tusd):** chuẩn hóa tốt, nhưng phải chạy thêm một service và lưu trạng thái riêng. S3 multipart đã đủ dùng mà đơn giản hơn.
- **Ưu điểm của S3 multipart:** server không phải gánh băng thông; part nào đã lên thì nằm sẵn trên S3, nên resume được tự nhiên; hỗ trợ file tới 5 TB.

## Hệ quả
- Bucket phải cấu hình CORS và expose header `ETag`.
- Phải dọn các multipart upload bị bỏ dở (Celery cùng với lifecycle rule của bucket).
- Mọi nhà cung cấp tương thích S3 (AWS, R2, MinIO) đều dùng được; dev dùng MinIO.
