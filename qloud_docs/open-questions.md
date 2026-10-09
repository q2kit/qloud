# Câu hỏi mở và quyết định chờ duyệt

> Khi một câu hỏi đã được trả lời: ghi câu trả lời, chuyển sang mục "Đã giải quyết", và nếu là quyết định kiến trúc thì tạo ADR.

## Đang mở

| # | Câu hỏi | Đề xuất của agent | Cần trước |
|---|---|---|---|
| — | (Hiện không có câu hỏi mở) | | |

## Việc chủ dự án cần chuẩn bị (không phải câu hỏi)
- Tạo OAuth app trên Google Cloud Console và GitHub Developer Settings (agent sẽ hướng dẫn khi làm M1-03).
- Thông tin SMTP cho production.
- Bucket S3/R2 cùng access key cho production (khi làm M8).

## Đã giải quyết

| # | Câu hỏi | Quyết định | Ngày |
|---|---|---|---|
| Q-11 | Domain? | Cấu hình qua `.env` (`APP_DOMAIN`). Lưu ý: production cần một domain thật trỏ về VPS (Google OAuth và Let's Encrypt không dùng được với IP trần) | 2026-10-09 |
| Q-02 | Frontend phục vụ từ đâu? | Cùng VPS, nginx phục vụ file tĩnh, cùng origin với API, phía trước là Cloudflare proxy ([ADR-0006](adr/0006-cloudflare-proxy-nginx.md)) | 2026-10-09 |
| Q-13 | Chống lạm dụng khi mở đăng ký | Xác thực email trước khi upload + Cloudflare Turnstile + plan mặc định `free-2026` 5 GB; bạn bè được admin gán `friends-2026` 50 GB | 2026-10-09 |
| Q-14 | Xử lý nội dung xấu qua link công khai | Có nút báo cáo vi phạm; admin gỡ link, gỡ mọi link của một node, khóa user ([sharing.md](features/sharing.md)) | 2026-10-09 |
| Q-01 | S3 hay R2? | Code dùng API S3 chung; dùng AWS S3 hay Cloudflare R2 là do `.env` quyết định | 2026-10-09 |
| Q-03 | Quota mặc định? | Giới hạn theo **Plan**, gán lúc đăng ký; đổi plan mặc định không ảnh hưởng user cũ ([ADR-0005](adr/0005-storage-plans.md)). Xem Q-13 về các plan ban đầu | 2026-10-09 |
| Q-04 | Upload vào folder được chia sẻ thì tính quota cho ai? | Tính cho owner của folder đích; file thuộc về owner đó | 2026-10-09 |
| Q-05 | Đăng ký tự do? | Có, bằng email/mật khẩu và OAuth. Có cờ `SIGNUP_ENABLED`. Email gửi qua SMTP riêng | 2026-10-09 |
| Q-06 | Giữ phiên bản cũ? | Theo plan: `free-2026` giữ 100 phiên bản / 30 ngày, có tùy chọn "Giữ mãi" | 2026-10-09 |
| Q-07 | Màu nhấn, font? | Teal, Be Vietnam Pro | 2026-10-09 |
| Q-08 | Kích thước file tối đa? | Theo plan: `free-2026` 5 GB, `friends-2026` 50 GB (S3 cho phép tới 5 TB) | 2026-10-09 |
| Q-09 | Share link có mật khẩu hoặc quyền sửa không? | MVP: chỉ quyền xem, có tùy chọn hạn dùng; mật khẩu để sau | 2026-10-09 |
| Q-10 | Bật versioning trên bucket? | Chưa; dựa vào thùng rác + backup DB | 2026-10-09 |
| Q-12 | Thư viện thumbnail PDF? | **pypdfium2** (Apache-2.0/BSD), hợp với giấy phép MIT. Không dùng PyMuPDF (AGPL) | 2026-10-09 |
| — | Backend framework | Django + DRF ([ADR-0001](adr/0001-backend-django.md)) | 2026-10-09 |
| — | Database | PostgreSQL | 2026-10-09 |
| — | Frontend | React + TS + Vite + Tailwind + shadcn ([ADR-0002](adr/0002-frontend-react-vite.md)) | 2026-10-09 |
| — | Upload file lớn | S3 multipart + presigned URL, có resume ([ADR-0003](adr/0003-direct-to-s3-multipart-upload.md)) | 2026-10-09 |
| — | Hosting backend | VPS + Docker Compose ([ADR-0004](adr/0004-hosting-vps.md)) | 2026-10-09 |
| — | Ngôn ngữ | Docs tiếng Việt; code tiếng Anh; UI có `vi` và `en` | 2026-10-09 |
| — | Giấy phép | MIT; chỉ dùng dependency có giấy phép permissive | 2026-10-09 |
