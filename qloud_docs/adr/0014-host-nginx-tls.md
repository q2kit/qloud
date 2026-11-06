# 0014. TLS và chặn IP ở nginx của host; nginx của Qloud chỉ chạy HTTP

- Trạng thái: Chấp nhận · 2026-11-05 · Thay thế [0006](0006-cloudflare-proxy-nginx.md)

## Quyết định
- DNS trên Cloudflare bật proxy, SSL mode **Full (strict)** (giữ như ADR-0006).
- **nginx của host** (cài trên VPS, ngoài Docker) giữ cổng 443 với **Cloudflare Origin Certificate**, chỉ nhận request từ dải IP của Cloudflare,
  rồi proxy HTTP tới `127.0.0.1:<QLOUD_HTTP_PORT>`. Đây là cấu hình của server, không nằm trong repo; `deploy.md` có đoạn mẫu.
- **nginx của Qloud** (container `web`) chỉ chạy HTTP, chỉ publish trên `127.0.0.1`. Nó phục vụ bản build FE và `/static/`, proxy `/api/`, `/admin/` sang gunicorn.
  Nó không giữ cert và không biết danh sách IP Cloudflare.
- IP thật của client: Django đọc header `CF-Connecting-IP` do Cloudflare đặt, nginx của host và của Qloud chuyển nguyên. Scheme: nginx của Qloud đặt `X-Forwarded-Proto: https`.

## Lý do
- VPS dùng chung một nginx cho nhiều site trên cổng 443, nên container của Qloud không giữ được 443. Hai lớp TLS (host → container) thì thừa.
- Chặn IP và cert là việc của server: mọi site trên VPS dùng chung, cập nhật một chỗ.

## Hệ quả
- Header `CF-Connecting-IP` chỉ đáng tin vì cổng của Qloud chỉ mở trên loopback và nginx của host chỉ nhận Cloudflare. Không publish cổng `web` ra ngoài `127.0.0.1`.
- Request API vẫn phải ngắn (dưới 100 giây) và body dưới 100 MB, giới hạn của Cloudflare. Byte file không đi qua proxy (ADR-0003).
