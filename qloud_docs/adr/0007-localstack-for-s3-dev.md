# 0007. LocalStack để giả lập S3 cho dev và CI

- Trạng thái: Chấp nhận · 2026-10-09

## Quyết định
**LocalStack** (`localstack/localstack`, chỉ bật `s3`). `infra/localstack/init-s3.sh` tạo bucket, CORS và lifecycle khi container sẵn sàng.

## Lý do
- MinIO bản cộng đồng đã ngừng phát hành image.
- LocalStack giả lập sát AWS S3; đã kiểm tra: CORS preflight, presigned PUT part, `ExposeHeaders: ETag`, ListParts,
  complete multipart, presigned GET có Range (206) và `ResponseContentDisposition`, lifecycle abort multipart.

## Hệ quả
- **Bắt buộc auth token** (`LOCALSTACK_AUTH_TOKEN`; thiếu thì container thoát với mã 55). Dev đặt trong `.env` ở gốc repo; CI dùng GitHub secret cùng tên.
- Code không phụ thuộc LocalStack: chỉ khác `S3_ENDPOINT_URL` và `S3_ADDRESSING_STYLE=path`.
