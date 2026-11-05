# Deploy production

Chạy Qloud trên một VPS bằng Docker Compose, phía trước là Cloudflare proxy và nginx của host
([ADR-0004](adr/0004-hosting-vps.md), [ADR-0014](adr/0014-host-nginx-tls.md)).
Image được build trên GitHub Actions và lưu ở GHCR ([ADR-0013](adr/0013-container-images-ghcr.md)); VPS chỉ pull rồi chạy.

```
Người dùng ──HTTPS──▶ Cloudflare (Full strict)
           ──HTTPS:443──▶ nginx của host (Origin Certificate, chỉ nhận IP Cloudflare)
           ──HTTP──▶ 127.0.0.1:8080 ▶ web (nginx của Qloud)
                                         ├─ /              SPA (index.html, /assets/)
                                         ├─ /static/       file tĩnh của Django admin
                                         └─ /api/ /admin/ ──▶ api (gunicorn)
api, worker, beat ──▶ postgres, redis (mạng nội bộ)      api, worker ──▶ S3/R2, SMTP, Turnstile, OAuth
Trình duyệt ──presigned URL──▶ S3/R2 (byte file không đi qua VPS)
```

| File | Vai trò |
|---|---|
| `infra/docker/Dockerfile` | Target `backend`: Django, gunicorn, Celery, FFmpeg LGPL. Target `web`: nginx với bản build FE và `/static/` |
| `infra/production/compose.yml` | Service `web`, `migrate` (chạy một lần trước `api`), `api`, `worker`, `beat` (đúng một bản), `postgres`, `redis` |
| `infra/production/.env.example` | Mọi biến của compose và Django, dùng chung một file `.env` |
| `infra/nginx/` | Cấu hình nginx của Qloud: chỉ HTTP, chia request sang FE và BE |
| `.github/workflows/images.yml` | Build image ở PR; build và push `ghcr.io/q2kit/qloud-{backend,web}` khi push lên `master` |

Chỉ `web` mở cổng, và chỉ trên `127.0.0.1` (`QLOUD_HTTP_PORT`, mặc định 8080). Postgres và Redis nằm trong mạng `internal`, không có đường ra ngoài.
Redis chưa đặt mật khẩu vì chỉ truy cập được từ mạng này.

## Cần có trước

- **VPS** chạy Linux, đã cài Docker Engine kèm plugin Compose, và có **nginx trên host** giữ cổng 443.
- **Domain trên Cloudflare.** OAuth và proxy không dùng được với IP trần.
- **Bucket S3 hoặc R2** cùng access key. CORS của bucket cho origin `https://<APP_DOMAIN>`:
  method `GET`, `PUT`, `HEAD`; expose header `ETag`, `Accept-Ranges`, `Content-Range`, `Content-Length`.
- **Tài khoản SMTP**, Turnstile key thật, và OAuth app Google/GitHub với callback
  `https://<APP_DOMAIN>/api/auth/oauth/<google|github>/login/callback/`.
- **Token GitHub** (classic) chỉ có quyền `read:packages`, để VPS pull image private từ GHCR.

## Cloudflare

1. DNS: bản ghi `A` (và `AAAA` nếu có IPv6) trỏ về VPS, bật **Proxied**.
2. SSL/TLS: chế độ **Full (strict)**; bật **Always Use HTTPS**; Minimum TLS Version 1.2.
3. SSL/TLS › Origin Server › **Create Certificate** cho `<APP_DOMAIN>`, rồi cài certificate và private key vào nginx của host.

## nginx của host

nginx của host lo TLS (Origin Certificate) và chỉ nhận request từ dải IP Cloudflare; Qloud không lặp lại hai việc này.
Một `server` cho Qloud cần:

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name <APP_DOMAIN>;

    ssl_certificate     /etc/ssl/<APP_DOMAIN>/origin.pem;
    ssl_certificate_key /etc/ssl/<APP_DOMAIN>/origin.key;

    # Khớp với nginx của Qloud; byte file không đi qua đây (presigned URL).
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        # CF-Connecting-IP (IP thật của client) được chuyển nguyên; Django đọc header này.
        proxy_read_timeout 90s;
    }
}
```

Điều kiện để Django tin header `CF-Connecting-IP` khi tính rate limit: chỉ Cloudflare vào được 443 của host,
và cổng của Qloud chỉ mở trên `127.0.0.1` (giữ nguyên `ports` trong `compose.yml`).

## Cài đặt lần đầu

Trên VPS chỉ cần `compose.yml` và `.env`. Ví dụ đặt ở `/opt/qloud`:

```bash
sudo mkdir -p /opt/qloud && sudo chown "$USER" /opt/qloud
```

Từ máy có repo, chép hai file lên (`<vps>` là host SSH):

```bash
cd "$(git rev-parse --show-toplevel)" && scp infra/production/compose.yml infra/production/.env.example <vps>:/opt/qloud/
```

Trên VPS, tạo `.env` (chỉ khi chưa có) rồi điền mọi chỗ `<...>`:

```bash
cd /opt/qloud && { [ -f .env ] || cp .env.example .env; } && chmod 600 .env
```

Đăng nhập GHCR rồi khởi động:

```bash
cd /opt/qloud && docker login ghcr.io -u <github-user> && docker compose pull && docker compose up -d --wait
```

`migrate` chạy trước, `api` chỉ khởi động khi migrate xong. Tạo tài khoản quản trị:

```bash
cd /opt/qloud && docker compose run --rm api python manage.py createsuperuser
```

Kiểm tra: `https://<APP_DOMAIN>/api/v1/health` trả `{"status": "ok"}`, trang chủ mở được, `/admin/` có CSS.

## Cập nhật và quay lại bản cũ

Mỗi lần push lên `master`, CI push image với tag `master` và `sha-<7 ký tự commit>`.

```bash
cd /opt/qloud && docker compose pull && docker compose up -d --wait
```

Muốn ghim hoặc quay lại một bản cụ thể thì đặt `QLOUD_TAG=sha-<commit>` trong `.env` rồi chạy lại lệnh trên.
Migration chỉ chạy tiến: trước khi quay lại bản cũ hơn một migration, phải kiểm tra migration đó có đảo ngược được không.

Xem log: `docker compose logs -f api worker`. Trạng thái: `docker compose ps`.

## Chạy thử stack production trên máy

Dùng để kiểm tra Dockerfile, compose và nginx trước khi mở PR. Không cần Cloudflare hay nginx của host: gọi thẳng cổng HTTP của `web`,
S3 trỏ LocalStack và SMTP trỏ Mailpit của compose dev. Cần hạ tầng dev đang chạy (`docker compose up -d --wait` ở gốc repo).

Tạo thư mục thử (ngoài repo) với `.env` cho domain `qloud.test`, rồi build và chạy:

```bash
T="$(mktemp -d)" && cd "$(git rev-parse --show-toplevel)" &&
  sed 's#context: ../..#context: '"$PWD"'#' infra/production/compose.yml > "$T/compose.yml" &&
  cat > "$T/.env" <<EOF &&
COMPOSE_PROJECT_NAME=qloud-prodtest
QLOUD_IMAGE_PREFIX=qloud-local
QLOUD_TAG=test
QLOUD_HTTP_PORT=8088
DJANGO_SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(50))')
APP_DOMAIN=qloud.test
DJANGO_HSTS_SECONDS=0
POSTGRES_PASSWORD=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')
S3_ENDPOINT_URL=http://host.docker.internal:4566
S3_BUCKET=qloud-dev
S3_ACCESS_KEY_ID=test
S3_SECRET_ACCESS_KEY=test
S3_ADDRESSING_STYLE=path
EMAIL_HOST=host.docker.internal
EMAIL_PORT=1025
MODERATION_EMAIL=abuse@qloud.test
TURNSTILE_SITE_KEY=local-placeholder-site-key
TURNSTILE_SECRET_KEY=local-placeholder-secret-key
EOF
  docker compose -f "$T/compose.yml" build && docker compose -f "$T/compose.yml" up -d --wait && echo "$T"
```

Gọi thử (`Host` thay cho domain thật; `CF-Connecting-IP` giả lập header Cloudflare gửi):

```bash
curl -s -H 'Host: qloud.test' -H 'CF-Connecting-IP: 203.0.113.7' http://127.0.0.1:8088/api/v1/health
curl -sI -H 'Host: qloud.test' http://127.0.0.1:8088/drive          # index.html, Cache-Control: no-cache
curl -sI -H 'Host: qloud.test' http://127.0.0.1:8088/admin/login/   # 200 từ Django
```

Dọn sau khi thử (xóa cả volume của stack thử, không đụng dữ liệu dev):

```bash
docker compose -f "<thư mục in ra ở trên>/compose.yml" down -v
```
