# 0007. LocalStack để giả lập S3 cho dev và CI

- Trạng thái: Chấp nhận
- Ngày: 2026-10-09

## Bối cảnh
Cần một S3 chạy cục bộ để dev và chạy test tích hợp: presigned URL, multipart, ListParts, CORS, lifecycle.
Docs ban đầu chọn MinIO, nhưng MinIO bản cộng đồng đã ngừng phát hành image (repo `minio/minio` trên Docker Hub không còn tag nào).

## Quyết định
Dùng **LocalStack** (`localstack/localstack`, chỉ bật dịch vụ `s3`).
`infra/localstack/init-s3.sh` tạo bucket, CORS và lifecycle khi container sẵn sàng.

## Các phương án đã cân nhắc
- **RustFS, SeaweedFS** (Apache-2.0, không cần tài khoản): không chọn.
- **LocalStack:** giả lập rất sát AWS S3. Đã kiểm tra đạt: CORS preflight (chặn đúng origin lạ), presigned PUT part, `ExposeHeaders: ETag`, ListParts, complete multipart, presigned GET có Range (206) và `ResponseContentDisposition`, lifecycle abort multipart.

## Hệ quả
- **Bắt buộc auth token** (`LOCALSTACK_AUTH_TOKEN`). Không có token thì container thoát với mã 55.
  Mỗi dev đặt token trong `.env` ở gốc repo; CI dùng GitHub secret cùng tên.
- Cần kiểm tra điều khoản của gói LocalStack đang dùng khi dự án thương mại hóa.
- Code không phụ thuộc LocalStack: chỉ khác `S3_ENDPOINT_URL` và `S3_ADDRESSING_STYLE=path`.
