# Qloud

Ứng dụng web lưu trữ, sắp xếp, xem và chia sẻ file — cùng loại với Google Drive, với thiết kế riêng.
Dự án được phát triển bởi AI agent, có người review và duyệt mọi thay đổi.

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

**Chỉ làm một lần** — tạo file cấu hình. Lệnh chỉ tạo khi file chưa có, nên chạy lại cũng không mất token đã điền:

```bash
[ -f .env ] || cp .env.example .env                                     # rồi điền LOCALSTACK_AUTH_TOKEN
[ -f qloud_backend/.env ] || cp qloud_backend/.env.example qloud_backend/.env
```

Cài git hooks (kiểm tra format, lint, secret, commit message trước khi commit/push):

```bash
brew install lefthook gitleaks
lefthook install
```

Hạ tầng (Postgres, Redis, LocalStack S3, Mailpit):

```bash
docker compose up -d --wait
```

Mỗi khối lệnh dưới đây chạy từ **thư mục gốc của repo**, mỗi khối một terminal.

Backend (cần [uv](https://docs.astral.sh/uv/)):

```bash
cd qloud_backend
uv sync
uv run python manage.py migrate
uv run python manage.py runserver     # http://localhost:8000/api/v1/health
```

Frontend (cần [pnpm](https://pnpm.io/)):

```bash
cd qloud_frontend
pnpm install
pnpm dev
```

Vite chạy tại `http://localhost:5173` và chuyển tiếp `/api`, `/admin` tới backend tại
`http://localhost:8000`.

## Giấy phép

[MIT](LICENSE)
