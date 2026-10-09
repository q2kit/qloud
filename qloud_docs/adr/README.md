# Architecture Decision Records (ADR)

Mỗi quyết định kiến trúc quan trọng được ghi thành một file `NNNN-ten-ngan.md`. File không bao giờ bị xóa:
nếu quyết định thay đổi thì tạo ADR mới, và đánh dấu ADR cũ là `Bị thay thế bởi NNNN`.

## Mẫu

```markdown
# NNNN. Tiêu đề

- Trạng thái: Đề xuất | Chấp nhận | Bị thay thế bởi NNNN
- Ngày: YYYY-MM-DD

## Bối cảnh
## Quyết định
## Lý do và các phương án đã cân nhắc
## Hệ quả
```

## Danh sách
| # | Tiêu đề | Trạng thái |
|---|---|---|
| [0001](0001-backend-django.md) | Backend dùng Django + DRF | Chấp nhận |
| [0002](0002-frontend-react-vite.md) | Frontend dùng React + Vite + shadcn/ui | Chấp nhận |
| [0003](0003-direct-to-s3-multipart-upload.md) | Upload thẳng lên S3 bằng multipart + presigned URL | Chấp nhận |
| [0004](0004-hosting-vps.md) | Hosting backend trên VPS, không dùng Cloudflare Workers | Chấp nhận |
| [0005](0005-storage-plans.md) | Giới hạn theo plan, gán cố định cho user lúc đăng ký | Chấp nhận |
| [0006](0006-cloudflare-proxy-nginx.md) | Cloudflare proxy (Full strict + Origin Certificate) và nginx trên VPS | Chấp nhận |
| [0007](0007-localstack-for-s3-dev.md) | LocalStack để giả lập S3 cho dev và CI | Chấp nhận |
