# Qloud

Ứng dụng web lưu trữ, sắp xếp, xem và chia sẻ file — cùng loại với Google Drive, với thiết kế riêng.
Dự án được phát triển bởi AI agent dưới sự giám sát của chủ dự án.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| [`qloud_docs/`](qloud_docs/README.md) | Tài liệu: sản phẩm, kiến trúc, API, tiến độ — **bắt đầu đọc từ đây** |
| `qloud_backend/` | API — Python, Django, DRF, Celery |
| `qloud_frontend/` | Web app — React, TypeScript, Vite |

- Tiến độ: [qloud_docs/ROADMAP.md](qloud_docs/ROADMAP.md)
- Kiến trúc: [qloud_docs/architecture.md](qloud_docs/architecture.md)
- Luật làm việc cho AI agent: [AGENTS.md](AGENTS.md)

## Chạy dự án (dev)

```bash
cp .env.example .env                              # điền LOCALSTACK_AUTH_TOKEN
cp qloud_backend/.env.example qloud_backend/.env
docker compose up -d --wait                       # Postgres, Redis, LocalStack (S3), Mailpit
```

> Phần chạy backend và frontend sẽ được bổ sung ở M0-05, M0-06 và M0-11.

## Giấy phép

[MIT](LICENSE)
