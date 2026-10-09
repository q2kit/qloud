# Kiến trúc

## Sơ đồ tổng thể

```
┌──────────────┐  HTTPS (JSON API, cookie session)   ┌──────────────────────────┐
│   Browser    │ ──────────────────────────────────▶ │  Django API (gunicorn)   │
│ React SPA    │                                     │  N instance, stateless   │
│              │ ◀── presigned URL ───────────────── │                          │
│              │                                     └──────┬─────────┬─────────┘
│              │  PUT part / GET object (trực tiếp)         │         │
│              │ ──────────────────────────┐                │         │ enqueue
└──────────────┘                           ▼                ▼         ▼
                                   ┌──────────────┐  ┌───────────┐ ┌─────────┐
                                   │ S3 bucket    │  │PostgreSQL │ │  Redis  │
                                   │ (file bytes) │  │(metadata) │ │(broker, │
                                   └──────▲───────┘  └───────────┘ │ cache)  │
                                          │                        └────┬────┘
                                          │   thumbnail, dọn dẹp        │
                                          └──────────── Celery worker ◀─┘
```

**Nguyên tắc cốt lõi:** server ứng dụng chỉ xử lý *metadata* và *phân quyền*.
Byte của file đi thẳng giữa trình duyệt và S3 qua presigned URL.

## Công nghệ

> Phiên bản tra trên registry ngày 2026-10-10 và khớp với `uv.lock`/`pnpm-lock.yaml`. Dependabot mở PR nâng phiên bản hằng tuần (`.github/dependabot.yml`); sửa bảng này trong cùng PR nâng phiên bản.

| Thành phần | Phiên bản |
|---|---|
| Python | 3.14 (đã kiểm tra Celery worker chạy được trên 3.14) |
| Django | 6.1 |
| Django REST Framework | 3.18 |
| drf-spectacular | 0.30 (đã kiểm tra chạy được với Django 6.1) |
| django-allauth | 65.x |
| Celery | 5.6 |
| psycopg | 3.3 |
| mypy | 2.3 — **không phải bản mới nhất (2.4)** vì djangorestframework-stubs 3.18.1 yêu cầu `mypy<2.4` |
| PostgreSQL | 18 |
| Redis | 8 |
| Node.js | 24 (LTS; `engines` trong `package.json`, CI dùng cùng bản) |
| React | 19.3.0 |
| TypeScript | 6.0.3 (bản 7.0.2 chưa tương thích với typescript-eslint 8.71.1; theo dõi việc nâng cấp ở [#56](https://github.com/q2kit/qloud/issues/56)) |
| Vite | 8.3.4 |
| React Router | 8.4.0 |
| TanStack Query | 5.104.1 |
| Tailwind CSS | 4.3.3 |
| Vitest | 5.0.3 |
| openapi-typescript | 7.13.0 (khai báo peer `typescript ^5`, đã kiểm tra chạy đúng với TS 6; ngoại lệ ghi trong `pnpm-workspace.yaml`, theo dõi ở #56) |
| openapi-fetch | 0.17.0 |
| Playwright | 1.64 |

MSW dùng bản 2.15.0 vì Vitest 5.0.3 chưa khai báo tương thích với MSW 3; sẽ nâng khi
peer dependency chính thức cho phép.

### Backend — `qloud_backend/`
| Mục đích | Thư viện |
|---|---|
| Framework | Django 6.1, Django REST Framework |
| OpenAPI | drf-spectacular. Schema là nguồn sự thật để FE sinh type |
| Auth | django-allauth (headless mode): email/mật khẩu, Google, GitHub |
| DB driver | psycopg 3 |
| S3 | boto3 |
| Tác vụ nền | Celery + Redis (gồm celery beat cho tác vụ định kỳ) |
| Ảnh | Pillow (thumbnail ảnh), pypdfium2 (render trang PDF; Apache-2.0/BSD, không cần thư viện hệ thống). Không dùng PyMuPDF vì giấy phép AGPL |
| Email | SMTP riêng (cấu hình qua `.env`), gửi qua Celery; dev dùng Mailpit. Cấu hình bằng setting `MAILERS` của Django 6.1 (các setting `EMAIL_*` đã bị deprecate) |
| Cấu hình | django-environ |
| Quản lý package | uv |
| Chất lượng | ruff (lint + format), mypy (strict) + django-stubs + django-stubs-ext |
| Test | pytest, pytest-django, factory_boy; S3 thật trên LocalStack |

**Cấu trúc module (Django apps):**
```
qloud_backend/
├── config/            # settings (base/dev/test/prod), urls, celery, wsgi/asgi
├── apps/
│   ├── core/          # BaseModel (UUIDv7 + timestamps), định dạng lỗi chung, phân trang, health
│   ├── accounts/      # User, profile, tích hợp allauth
│   ├── drive/         # Node, FileVersion, Blob — cây thư mục, đổi tên, di chuyển
│   ├── uploads/       # UploadSession, multipart
│   ├── sharing/       # Share, ShareLink, dịch vụ phân quyền
│   ├── trash/         # Logic thùng rác (có thể gộp vào drive)
│   ├── search/
│   └── storage/       # Wrapper S3: presign, multipart, delete
└── tests/
```

**Lớp nghiệp vụ:** logic nằm trong `services.py` (ghi) và `selectors.py` (đọc) của từng app.
View chỉ làm việc parse, gọi service rồi serialize. **Phân quyền** tập trung ở `sharing/permissions.py`;
mọi selector của node đều phải đi qua đây.

### Frontend — `qloud_frontend/`
| Mục đích | Thư viện |
|---|---|
| Build | Vite, React, TypeScript (strict) |
| Routing | React Router |
| Dữ liệu từ server | TanStack Query; API client sinh từ OpenAPI (openapi-typescript + openapi-fetch) |
| Trạng thái client | Zustand (hàng đợi upload, lựa chọn nhiều mục) |
| UI | Tailwind CSS, shadcn/ui (Radix), lucide-react (icon) |
| Form | react-hook-form + zod |
| i18n | i18next + react-i18next |
| Xem trước | pdf.js (PDF), thẻ `<video>` gốc của trình duyệt |
| Test | Vitest, Testing Library, MSW, Playwright |
| Chất lượng | eslint, prettier, tsc |

**Cấu trúc thư mục (theo feature):**
```
qloud_frontend/src/
├── app/            # router, providers, layout
├── features/       # auth, drive, upload, preview, sharing, trash, search, settings
│   └── <feature>/  # components/, hooks/, api.ts, types.ts
├── components/ui/  # các component shadcn
├── lib/            # api client, utils
└── locales/        # vi/, en/
```

## Các luồng chính

### Upload (chi tiết: [features/upload.md](features/upload.md))
1. FE gọi `POST /uploads` với tên, kích thước, folder đích và fingerprint.
   BE kiểm tra quyền và quota, **giữ chỗ quota**, tạo S3 multipart upload, rồi trả `session_id` và `part_size`.
2. FE xin presigned URL theo lô (`POST /uploads/{id}/parts`), sau đó PUT từng part thẳng lên S3 (song song 3–4 part).
3. Nếu bị gián đoạn: FE gọi `GET /uploads/{id}` để biết những part nào đã lên S3, rồi upload tiếp phần còn thiếu.
4. FE gọi `POST /uploads/{id}/complete`. BE hoàn tất multipart upload, tạo `Blob` và `FileVersion`, rồi chuyển phần quota đã giữ chỗ thành quota đã dùng.
5. BE đẩy task tạo thumbnail sang Celery.

### Download / xem trước
FE gọi `GET /nodes/{id}/download`. BE kiểm tra quyền rồi trả presigned GET URL (hạn khoảng 5 phút,
có `Content-Disposition`). Video được stream trực tiếp từ S3 vì S3 hỗ trợ Range request.

### Phân quyền
Quyền của một người trên một node = mức quyền cao nhất trong các nguồn sau: là owner;
có `Share` trực tiếp trên node; có `Share` trên một folder tổ tiên (quyền được thừa kế).
Với share link thì chỉ xét token của link đó và cây con bên dưới node được chia sẻ.

## Công cụ cưỡng chế quy tắc

Rule nào kiểm tra máy móc được thì để công cụ cưỡng chế, không chỉ viết bằng chữ:

| Tầng | Công cụ | Vai trò |
|---|---|---|
| Cưỡng chế | GitHub Actions (`.github/workflows/ci.yml` và `pr.yml`, M0-09) + branch protection | Không thể bỏ qua: lint, typecheck, test, build, giấy phép, gitleaks (`ci.yml`); tiêu đề/body PR, tên branch (`pr.yml`) |
| Phát hiện sớm | Git hooks bằng lefthook (`lefthook.yml`, M0-12) | Chạy trên máy, nhanh; có thể bị bỏ qua nên không thay thế CI |
| Quy trình | Script trong repo + skill Claude Code (M2-00) | Đóng gói các bước gh/git lặp lại; Codex và người cũng dùng được script |
| Phán đoán | `AGENTS.md` | Khi nào cần hỏi trước, định hướng, review |

## Triển khai

- **Môi trường dev:** `docker-compose.yml` ở thư mục gốc chạy PostgreSQL, Redis, **LocalStack** (giả lập S3, xem [ADR-0007](adr/0007-localstack-for-s3-dev.md)) và Mailpit. BE và FE chạy trực tiếp trên máy.
  Khi LocalStack khởi động, `infra/localstack/init-s3.sh` tạo bucket, CORS và lifecycle rule giống production.
- **File cấu hình (`.env`, không commit; mẫu là `.env.example` bên cạnh):**
  | File | Ai đọc | Nội dung |
  |---|---|---|
  | `.env` (gốc repo) | docker compose | Hạ tầng: Postgres, Redis, LocalStack token, Mailpit, CORS của bucket |
  | `qloud_backend/.env` | Django, Celery | Secret key, `APP_DOMAIN`, DB/Redis URL, S3, SMTP, OAuth, Turnstile, Sentry |
  | `qloud_frontend/.env` | Vite (`VITE_*`) | Chỉ các giá trị công khai, ví dụ Turnstile site key |
- **Production:** **mọi thứ chạy trên một VPS** bằng Docker Compose: nginx, api, worker, beat, postgres, redis.
  Phía trước VPS là **Cloudflare proxy** (DNS bật proxy — biểu tượng đám mây cam). Chi tiết ở [ADR-0006](adr/0006-cloudflare-proxy-nginx.md).
  - **TLS:** chế độ SSL của Cloudflare là **Full (strict)**. nginx dùng **Cloudflare Origin Certificate**; file cert và key được mount vào container, đường dẫn cấu hình qua `.env`. VPS không dùng Let's Encrypt.
  - **Firewall (ufw):** cổng 443 chỉ mở cho các dải IP của Cloudflare; SSH mở riêng. Cổng 80 đóng (Cloudflare tự chuyển HTTP sang HTTPS).
  - **nginx:** phục vụ bản build FE (cache dài cho các file có hash trong tên, `index.html` thì không cache, mọi route SPA trả về `index.html`), reverse proxy `/api/`, `/admin/` sang gunicorn, và phục vụ `/static/` (file tĩnh của Django admin, tạo bằng `collectstatic`).
  - **IP thật của client:** nginx dùng `real_ip_header CF-Connecting-IP` + `set_real_ip_from <dải IP Cloudflare>`. Django tin header `X-Forwarded-For` và `X-Forwarded-Proto` từ nginx (`SECURE_PROXY_SSL_HEADER`).
    Rate limit và báo cáo vi phạm đều dựa trên IP này.
  - **Settings Django:** container api/worker/beat đặt `DJANGO_SETTINGS_MODULE=config.settings.prod`; `wsgi`, `asgi` và `celery` cũng mặc định là prod, chỉ `manage.py` mặc định là dev.
    `config.settings.prod` dừng ngay khi khởi động nếu `APP_DOMAIN` thiếu hoặc là `localhost`, hay `DJANGO_SECRET_KEY` ngắn hơn 50 ký tự hoặc là giá trị mẫu.
    Bật `SECURE_SSL_REDIRECT` (trừ `/api/v1/health`) và HSTS 1 năm (`DJANGO_HSTS_SECONDS`), không kèm `includeSubDomains`/`preload`.
    CI chạy `manage.py check --deploy` với settings prod.
  - **Giới hạn của Cloudflare cần nhớ:** request body tối đa 100 MB (gói Free) và timeout 100 giây. Hai giới hạn này không ảnh hưởng, vì file đi thẳng lên S3/R2, không qua proxy. API không được có request chạy lâu.
  File lưu trên dịch vụ tương thích S3: AWS S3 hay Cloudflare R2 **chỉ khác nhau ở `.env`** (`S3_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
  Code không được dùng tính năng riêng của một nhà cung cấp. Frontend là static build, do nginx phục vụ.
  - **Cần chuẩn bị trước khi deploy:** domain trên Cloudflare, Origin Certificate, bucket S3/R2 kèm access key, tài khoản SMTP,
    OAuth app Google và GitHub cho domain production, Turnstile key. Tất cả đặt trong `.env` của server, không commit.
- **Domain:** production cần một domain thật trỏ về Cloudflare (OAuth của Google và Cloudflare proxy không dùng được với IP trần), lấy từ `.env` (`APP_DOMAIN`). nginx dùng biến này cho `server_name`; Django dùng nó cho `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` và các link trong email.
  FE và API **cùng origin**: `https://<domain>/` là SPA, `https://<domain>/api/` là Django, `/admin/` là Django admin.
  Nhờ vậy không cần CORS cho API và cookie session đơn giản. Chỉ bucket S3 cần cấu hình CORS cho origin này.
- **CI/CD:** GitHub Actions. Mỗi PR chạy lint, type check, test BE, test FE, build và E2E. Deploy tự động khi merge vào `master` (build image rồi deploy lên VPS) **chưa làm**, thuộc M8-04.

## Hướng mở rộng sau này (chưa làm)
- PostgreSQL managed kèm read replica; tách worker ra máy riêng; thêm CDN cho thumbnail.
- Tìm kiếm full-text nội dung file bằng OpenSearch hoặc Meilisearch.
- Khử trùng lặp (dedup) blob theo checksum.
