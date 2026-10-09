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

> Phiên bản tra trên registry ngày 2026-10-09. Khi khởi tạo (M0), tra lại một lần nữa rồi cập nhật bảng này cho khớp với lockfile.

| Thành phần | Phiên bản |
|---|---|
| Python | 3.14 (nếu Celery hoặc một thư viện nào đó chưa ổn trên 3.14 thì dùng 3.13, và ghi lý do) |
| Django | 6.1 |
| Django REST Framework | 3.18 |
| drf-spectacular | 0.30 (classifier chính thức mới ghi tới Django 6.0 — cần kiểm tra lại khi làm M0) |
| django-allauth | 65.x |
| Celery | 5.6 |
| psycopg | 3.3 |
| PostgreSQL | 18 |
| Redis | 8 |
| Node.js | bản LTS hiện hành |
| React | 19 |
| TypeScript | 7 |
| Vite | 8 |
| React Router | 8 |
| TanStack Query | 5 |
| Tailwind CSS | 4 |
| Vitest | 5 |
| Playwright | 1.64 |

### Backend — `qloud_backend/`
| Mục đích | Thư viện |
|---|---|
| Framework | Django 6.1, Django REST Framework |
| OpenAPI | drf-spectacular. Schema là nguồn sự thật để FE sinh type |
| Auth | django-allauth (headless mode): email/mật khẩu, Google, GitHub |
| DB driver | psycopg 3 |
| S3 | boto3 |
| Tác vụ nền | Celery + Redis (gồm celery beat cho tác vụ định kỳ) |
| Ảnh | Pillow (thumbnail ảnh), pypdfium2 (render trang PDF; Apache-2.0/BSD, không cần thư viện hệ thống) |
| Email | SMTP riêng (cấu hình qua `.env`), gửi qua Celery; dev dùng Mailpit |
| Cấu hình | django-environ |
| Quản lý package | uv |
| Chất lượng | ruff (lint + format), mypy + django-stubs |
| Test | pytest, pytest-django, factory_boy, moto hoặc MinIO cho S3 |

**Cấu trúc module (Django apps):**
```
qloud_backend/
├── config/            # settings (base/dev/test/prod), urls, celery, wsgi/asgi
├── apps/
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
| UI | Tailwind CSS, shadcn/ui (Radix), lucide-react icons |
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

## Triển khai

- **Môi trường dev:** `docker compose` chạy PostgreSQL, Redis và MinIO. BE và FE chạy trực tiếp trên máy.
- **Production (giai đoạn 1):** **mọi thứ chạy trên một VPS** bằng Docker Compose: nginx, api, worker, beat, postgres, redis.
  Phía trước VPS là **Cloudflare proxy** (DNS bật proxy — biểu tượng đám mây cam). Chi tiết ở [ADR-0006](adr/0006-cloudflare-proxy-nginx.md).
  - **TLS:** chế độ SSL của Cloudflare là **Full (strict)**. nginx dùng **Cloudflare Origin Certificate**; file cert và key được mount vào container, đường dẫn cấu hình qua `.env`. VPS không dùng Let's Encrypt.
  - **Firewall (ufw):** cổng 443 chỉ mở cho các dải IP của Cloudflare; SSH mở riêng. Cổng 80 đóng (Cloudflare tự chuyển HTTP sang HTTPS).
  - **nginx:** phục vụ bản build FE (cache dài cho các file có hash trong tên, `index.html` thì không cache, mọi route SPA trả về `index.html`), và reverse proxy `/api/`, `/admin/` sang gunicorn.
  - **IP thật của client:** nginx dùng `real_ip_header CF-Connecting-IP` + `set_real_ip_from <dải IP Cloudflare>`. Django tin header `X-Forwarded-For` và `X-Forwarded-Proto` từ nginx (`SECURE_PROXY_SSL_HEADER`).
    Rate limit và báo cáo vi phạm đều dựa trên IP này.
  - **Giới hạn của Cloudflare cần nhớ:** request body tối đa 100 MB (gói Free) và timeout 100 giây. Hai giới hạn này không ảnh hưởng, vì file đi thẳng lên S3/R2, không qua proxy. API không được có request chạy lâu.
  File lưu trên dịch vụ tương thích S3: AWS S3 hay Cloudflare R2 **chỉ khác nhau ở `.env`** (`S3_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
  Code không được dùng tính năng riêng của một nhà cung cấp. Frontend là static build, do nginx phục vụ.
- **Domain:** lấy từ `.env` (`APP_DOMAIN`). nginx dùng biến này cho `server_name`; Django dùng nó cho `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` và các link trong email.
  FE và API **cùng origin**: `https://<domain>/` là SPA, `https://<domain>/api/` là Django, `/admin/` là Django admin.
  Nhờ vậy không cần CORS cho API và cookie session đơn giản. Chỉ bucket S3 cần cấu hình CORS cho origin này.
- **CI/CD:** GitHub Actions. Mỗi PR chạy lint, type check, test BE, test FE, build và E2E. Merge vào `master` thì build image rồi deploy lên VPS.

## Hướng mở rộng sau này (chưa làm)
- PostgreSQL managed kèm read replica; tách worker ra máy riêng; thêm CDN cho thumbnail.
- Tìm kiếm full-text nội dung file bằng OpenSearch hoặc Meilisearch.
- Khử trùng lặp (dedup) blob theo checksum.
