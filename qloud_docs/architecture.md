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

> Số phiên bản chính xác nằm trong `uv.lock` và `pnpm-lock.yaml` (Dependabot nâng hằng tuần). Bảng dưới chỉ ghi dòng phiên bản đang dùng
> và **ràng buộc** khiến chưa dùng bản mới nhất. Đọc tài liệu của đúng dòng phiên bản này trước khi dùng API.

| Thành phần | Phiên bản | Ràng buộc |
|---|---|---|
| Python | 3.14 | |
| Django / DRF / drf-spectacular | 6.1 / 3.18 / 0.30 | |
| django-allauth | 65 | Extra `headless` (pyjwt, cryptography), `headless-spec` (PyYAML) và `socialaccount` (requests, oauthlib) |
| Celery | 5.6 | |
| psycopg | 3.3 | |
| boto3 | 1.43 | Dev: `boto3-stubs[s3]` (MIT) cho mypy, cùng dòng phiên bản |
| mypy | 2.3 | djangorestframework-stubs 3.18 yêu cầu `mypy<2.4` |
| PostgreSQL / Redis | 18 / 8 | |
| Node.js | 24 | `engines` trong `package.json`; `@types/node` giữ cùng major |
| React / React Router / TanStack Query | 19 / 8 / 5 | |
| TypeScript | 6 | TS 7 chưa tương thích typescript-eslint ([#56](https://github.com/q2kit/qloud/issues/56)) |
| Vite / Vitest | 8 / 5 | |
| Tailwind CSS | 4 | |
| MSW | 2 | Vitest 5 chưa khai báo tương thích MSW 3 |
| openapi-typescript / openapi-fetch | 7 / 0.17 | openapi-typescript khai báo peer `typescript ^5`; đã kiểm tra chạy đúng với TS 6, ngoại lệ ghi trong `pnpm-workspace.yaml` (#56) |
| Playwright | 1 | |

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
| Test | pytest, pytest-django, factory_boy; S3 thật trên LocalStack (bucket riêng `qloud-test`) |

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

M1-01: `accounts.services` xử lý tạo user/Drive nguyên tử, đổi plan mặc định và khóa user;
`accounts.selectors.get_limits()` cung cấp giới hạn hiện tại. `drive.Node` mới có nền folder gốc, được hoàn thiện ở M2-01.
Auth backend `accounts.backends.AccountBackend` kế thừa backend email của allauth (vốn kế thừa ModelBackend) và chặn user bị khóa, gồm session đang có.
Hash session (`get_session_auth_hash` và bản fallback cho `SECRET_KEY_FALLBACKS`) gồm mật khẩu và `session_version`; khóa user tăng bộ đếm để thu hồi session độc lập session engine, kể cả khi mở khóa sau đó.
Không quét/giải mã toàn bộ session. Session dùng ModelBackend/hash cũ trước M1-01 phải đăng nhập lại sau nâng cấp.
M1-02: allauth headless gắn ở `/api/auth/` (`config/urls.py`); `accounts.adapter.AccountAdapter` và `accounts.auth_views` tùy biến
đăng ký/đăng nhập (xem auth.md). M1-04: `core.turnstile` kiểm tra token Turnstile bằng thư viện chuẩn (`urllib`), không thêm dependency;
email auth gửi qua task Celery `accounts.tasks.send_email`, template ở `accounts/templates/account/email/`.
M1-06: `GET /api/v1/config` (`core.views.ConfigView`) cấp cấu hình công khai lúc chạy cho SPA; `GET/PATCH /api/v1/me` (`accounts.views.MeView`) cho hồ sơ và tùy chọn. allauth không có type hint: `pyproject.toml` bỏ qua import của `allauth.*` và cho phép kế thừa trong ba module tích hợp.
M2-03: `storage.s3` là module duy nhất gọi object storage (boto3, client tạo một lần mỗi process). Nó cấp presigned URL cho từng part (hạn 1 giờ) và cho download (5 phút, `Content-Disposition` theo RFC 6266 để giữ tên tiếng Việt), và lo các bước multipart, `list_parts` đọc đủ mọi trang, xóa theo lô 1000 key.
Lỗi S3 gói thành `StorageError` (`code` = mã lỗi S3). Key có dạng `blobs/{uuid7}`, không chứa tên file. Cấu hình `S3_*` đọc từ env; test và CI chạy trên LocalStack.
Action Django admin dùng gettext, catalog `vi` và `en` nằm trong `accounts/locale`;
commit cả `.po` và `.mo` để runtime/CI không phụ thuộc gettext CLI. Khi sửa bản dịch, chạy
`cd "$(git rev-parse --show-toplevel)/qloud_backend" && uv run --frozen python manage.py compilemessages -l vi -l en --ignore .venv`
(cần `msgfmt` trên máy dev).

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

### Upload
Xem [features/upload.md](features/upload.md) và [ADR-0003](adr/0003-direct-to-s3-multipart-upload.md).

### Download / xem trước
FE gọi `GET /nodes/{id}/download`. BE kiểm tra quyền rồi trả presigned GET URL (hạn khoảng 5 phút,
có `Content-Disposition`). Video được stream trực tiếp từ S3 vì S3 hỗ trợ Range request.

### Phân quyền
Quyền của một người trên một node = mức quyền cao nhất trong các nguồn sau: là owner;
có `Share` trực tiếp trên node; có `Share` trên một folder tổ tiên (quyền được thừa kế).
Với share link thì chỉ xét token của link đó và cây con bên dưới node được chia sẻ.

Code: `apps/sharing/permissions.py` (M2-01; app `sharing` chưa có model, Share/ShareLink thêm ở M5).
- `Role`: `VIEWER < EDITOR < OWNER`. Hiện chỉ owner có quyền.
- `nodes_for(user, role, trashed=False)`: queryset các node mà user có ít nhất `role`; `trashed=True` chỉ node trong thùng rác, `None` cả hai.
  Mọi selector và view lấy node từ đây, không dùng `Node.objects` trực tiếp.
- `get_node_or_404(user, node_id, role)`: không có quyền, không tồn tại hay id sai định dạng đều là cùng một 404.
- `role_of(user, node)`. User chưa đăng nhập, không active hoặc bị khóa thì không có quyền gì.

## Triển khai

### Dev
- `docker-compose.yml` chạy PostgreSQL, Redis, LocalStack (S3, [ADR-0007](adr/0007-localstack-for-s3-dev.md)) và Mailpit, cổng chỉ mở trên `127.0.0.1`.
  `infra/localstack/init-s3.sh` tạo bucket, CORS và lifecycle rule giống production. BE và FE chạy trực tiếp trên máy (lệnh: AGENTS.md mục 8).
- File cấu hình (không commit; mẫu là `.env.example` bên cạnh):

  | File | Ai đọc | Nội dung |
  |---|---|---|
  | `.env` (gốc repo) | docker compose | Postgres, Redis, LocalStack token, Mailpit, CORS của bucket |
  | `qloud_backend/.env` | Django, Celery | Secret key, `APP_DOMAIN`, DB/Redis URL, S3, SMTP, OAuth, Turnstile, Sentry |
  | `qloud_frontend/.env` | Vite (`VITE_*`) | Chỉ giá trị công khai; hiện chưa cần biến nào. Cấu hình lúc chạy (ví dụ Turnstile site key) lấy từ `GET /api/v1/config` |

### E2E
- Playwright (`qloud_frontend/playwright.config.ts`) tự chạy Django (cổng 8001, `config.settings.e2e`), bản build FE qua `vite preview` (4173)
  và provider OAuth giả `qloud_frontend/e2e/oauth-provider.ts` (8002); Postgres, Redis và Mailpit lấy từ docker compose.
- `config.settings.e2e` kế thừa settings test (Celery eager, không rate limit, không Turnstile), cộng thêm: email gửi qua SMTP tới Mailpit,
  test đọc link trong email bằng API của Mailpit; Google và GitHub trỏ tới provider giả (allauth cho đổi URL provider), key OAuth thật trong `.env` không được dùng.
- Provider giả có trang "authorize" là một form để test chọn email, tên và email đã xác thực hay chưa. Danh tính nằm trong `code`/token, nên server không giữ trạng thái và test chạy song song được.

### Production
- Một VPS chạy Docker Compose: nginx, api (gunicorn), worker, beat, postgres, redis; phía trước là Cloudflare proxy
  ([ADR-0004](adr/0004-hosting-vps.md), [ADR-0006](adr/0006-cloudflare-proxy-nginx.md)). Firewall chỉ mở 443 cho dải IP Cloudflare.
- **Cùng origin:** `https://<APP_DOMAIN>/` là SPA (nginx), `/api/` và `/admin/` là Django, `/static/` là file tĩnh của admin (`collectstatic`).
  Không cần CORS cho API; chỉ bucket cần CORS cho origin này. nginx: cache dài cho file có hash, không cache `index.html`, mọi route SPA trả `index.html`.
- **IP thật của client:** nginx `real_ip_header CF-Connecting-IP` + `set_real_ip_from <dải IP Cloudflare>`; Django tin `X-Forwarded-For`/`X-Forwarded-Proto` từ nginx.
  Rate limit và báo cáo vi phạm dựa trên IP này.
- **Settings Django:** `DJANGO_SETTINGS_MODULE=config.settings.prod` (mặc định của `wsgi`, `asgi`, `celery`; chỉ `manage.py` mặc định dev).
  Settings prod dừng khi `APP_DOMAIN` thiếu hoặc là `localhost`, hay `DJANGO_SECRET_KEY` ngắn hơn 50 ký tự hoặc là giá trị mẫu.
  Bật `SECURE_SSL_REDIRECT` (trừ `/api/v1/health`) và HSTS 1 năm (`DJANGO_HSTS_SECONDS`), không `includeSubDomains`/`preload`. CI chạy `check --deploy` với settings prod.
- **Storage:** dịch vụ tương thích S3; AWS S3 hay Cloudflare R2 chỉ khác ở `.env` (`S3_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).
  Code không dùng tính năng riêng của nhà cung cấp nào.
- **Giới hạn của Cloudflare:** body tối đa 100 MB, timeout 100 giây. API không được có request chạy lâu; file không đi qua proxy.
- **Cần có trước khi deploy:** domain thật trên Cloudflare (OAuth và proxy không dùng được với IP trần), Origin Certificate, bucket kèm access key,
  tài khoản SMTP, OAuth app Google/GitHub cho domain production, Turnstile key. Tất cả nằm trong `.env` của server.
