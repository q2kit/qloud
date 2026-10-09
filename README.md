# Qloud

Ứng dụng web mã nguồn mở để lưu trữ, sắp xếp, xem trước và chia sẻ file: upload chia nhỏ tự tiếp tục khi gián đoạn,
chia sẻ cho người dùng khác hoặc qua link công khai, thùng rác, lịch sử phiên bản, giao diện tiếng Việt và tiếng Anh.

Code do AI agent viết; mọi thay đổi đều được review trước khi merge.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| [`qloud_docs/`](qloud_docs/README.md) | Tài liệu: sản phẩm, kiến trúc, API, tiến độ — **bắt đầu đọc từ đây** |
| `qloud_backend/` | API — Python, Django, DRF, Celery |
| `qloud_frontend/` | Web app — React, TypeScript, Vite |

- Tiến độ: [qloud_docs/ROADMAP.md](qloud_docs/ROADMAP.md)
- Kiến trúc: [qloud_docs/architecture.md](qloud_docs/architecture.md)
- Luật làm việc cho AI agent: [AGENTS.md](AGENTS.md)

## Chạy dự án

Cần Docker, [uv](https://docs.astral.sh/uv/), [pnpm](https://pnpm.io/) và Homebrew (cho lefthook, gitleaks).
Cài đặt lần đầu, chạy dev, chạy test: [AGENTS.md mục 8](AGENTS.md#8-lệnh-thường-dùng).

## Giấy phép

[MIT](LICENSE)
