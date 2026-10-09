# 0004. Chạy trên VPS bằng Docker Compose

- Trạng thái: Chấp nhận · 2026-10-09

## Quyết định
Django, Celery, PostgreSQL, Redis và nginx (phục vụ FE tĩnh, cùng origin với API) chạy trên một VPS bằng Docker Compose,
phía trước là Cloudflare proxy (ADR-0006). File lưu trên S3 hoặc R2, tùy `.env`.

## Lý do
- Cloudflare Workers không chạy được Django, Celery hay psycopg (Python Workers chạy trên Pyodide); D1 là SQLite, không có
  recursive CTE trên dữ liệu lớn, pg_trgm hay khóa dòng cho quota. Dùng Workers đồng nghĩa viết lại backend.
- VPS: chi phí cố định, kiểm soát hoàn toàn; khi cần thì nâng máy hoặc tách dịch vụ.

## Hệ quả
- Tự vận hành: cập nhật OS, backup, TLS giữa Cloudflare và VPS, giám sát.
