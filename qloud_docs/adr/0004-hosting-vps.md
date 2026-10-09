# 0004. Hosting backend trên VPS, không dùng Cloudflare Workers

- Trạng thái: Chấp nhận
- Ngày: 2026-10-09

## Bối cảnh
Có cân nhắc dùng Cloudflare Pages + Workers thay cho VPS.

## Quyết định
Backend (Django, Celery, PostgreSQL, Redis) chạy trên **VPS bằng Docker Compose**.
Frontend (file tĩnh) cũng do nginx trên **cùng VPS** phục vụ (phía trước là Cloudflare proxy, xem ADR-0006), cùng origin với API (chốt 2026-10-09). File lưu trên S3 hoặc R2, tùy `.env`.

## Lý do
- **Cloudflare Workers không chạy được Django:** Python Workers chạy trên Pyodide, không hỗ trợ Django, Celery hay psycopg.
  Muốn dùng Workers thì phải viết lại backend bằng JS/TS.
- **D1 là SQLite:** không phù hợp với yêu cầu PostgreSQL (recursive CTE trên dữ liệu lớn, pg_trgm, khóa dòng cho quota).
  Workers có thể kết nối tới PostgreSQL bên ngoài qua Hyperdrive, nhưng khi đó vẫn phải có một nơi chạy PostgreSQL và vẫn phải bỏ Django.
- Workers không có tác vụ nền dài kiểu Celery (tạo thumbnail chẳng hạn), chỉ có Queues và Cron với giới hạn CPU.
- **VPS:** chi phí cố định, rẻ, kiểm soát được hoàn toàn. Đủ dùng cho giai đoạn 1, và sau này nâng cấp hoặc tách dịch vụ dễ dàng.

## Hệ quả
- Phải tự lo vận hành: cập nhật OS, backup, TLS giữa Cloudflare và VPS (Origin Certificate, xem ADR-0006), giám sát.
- Vẫn có thể dùng Cloudflare cho DNS/proxy và R2 cho storage. Lưu ý giới hạn body 100 MB của proxy không ảnh hưởng, vì file đi thẳng lên R2/S3.
