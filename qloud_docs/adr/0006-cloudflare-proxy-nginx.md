# 0006. Cloudflare proxy (Full strict + Origin Certificate) và nginx trên VPS

- Trạng thái: Chấp nhận · 2026-10-09

## Quyết định
- DNS trên Cloudflare bật proxy, SSL mode **Full (strict)**.
- VPS mở cổng 443 với **Cloudflare Origin Certificate**; firewall chỉ cho các dải IP của Cloudflare.
- **nginx** phục vụ bản build FE và `/static/`, reverse proxy `/api/`, `/admin/` sang gunicorn. IP thật của client lấy từ `CF-Connecting-IP`.

## Lý do
- Cloudflare Tunnel thêm một daemon và phụ thuộc vào tunnel. TLS tự động của Caddy là thừa khi đã có Origin Certificate.
- Django + WhiteNoise phục vụ luôn FE thì gắn việc build FE vào image BE.

## Hệ quả
- Phải cập nhật danh sách IP Cloudflare cho firewall và `set_real_ip_from` (lấy từ `https://www.cloudflare.com/ips-v4` và `ips-v6`).
- Origin Certificate là secret, không commit.
- Request API phải ngắn (dưới 100 giây) và body dưới 100 MB, giới hạn của Cloudflare. Byte file không đi qua proxy (ADR-0003).
