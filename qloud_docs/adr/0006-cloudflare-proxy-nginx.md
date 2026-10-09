# 0006. Cloudflare proxy (Full strict + Origin Certificate) và nginx trên VPS

- Trạng thái: Chấp nhận
- Ngày: 2026-10-09

## Bối cảnh
Hệ thống chạy trên VPS (ADR-0004). Yêu cầu: Cloudflare proxy đứng trước VPS.
Trên VPS vẫn cần một thành phần phục vụ file tĩnh của frontend và chuyển `/api` sang Django.

## Quyết định
- DNS trên Cloudflare bật proxy. SSL mode **Full (strict)**.
- VPS **mở cổng 443** với **Cloudflare Origin Certificate**, và firewall chỉ cho phép các dải IP của Cloudflare.
- **nginx** phục vụ bản build FE và reverse proxy `/api/`, `/admin/` sang gunicorn. IP thật của client lấy từ `CF-Connecting-IP`.

## Các phương án đã cân nhắc
- **Cloudflare Tunnel (cloudflared):** không cần mở cổng, nhưng thêm một daemon nữa và phụ thuộc vào tunnel. Đã chọn mở cổng 443.
- **Caddy:** tính năng TLS tự động của Caddy trở nên thừa khi đã có Cloudflare Origin Certificate. (Agent đã từng ghi Caddy vào docs mà chưa hỏi; nay bỏ.)
- **Django + WhiteNoise phục vụ luôn FE:** ít container hơn, nhưng gắn chặt việc build FE vào image BE. Không chọn.

## Hệ quả
- Phải cập nhật danh sách IP của Cloudflare cho firewall và `set_real_ip_from` (có script tải từ `https://www.cloudflare.com/ips-v4` và `ips-v6`).
- Origin Certificate có hạn dài (tối đa 15 năm) nhưng vẫn phải lưu như secret, không commit vào repo.
- Request API phải ngắn (dưới 100 giây, giới hạn của Cloudflare). Byte file không đi qua proxy (ADR-0003).
