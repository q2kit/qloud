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
| Zustand / TanStack Virtual | 5 / 3 | `@tanstack/react-virtual` (MIT) thêm ở M2-07a cho danh sách folder dài, duyệt ở [#23](https://github.com/q2kit/qloud/issues/23) |
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
| Ảnh | Pillow (thumbnail ảnh), pypdfium2 (render trang PDF; Apache-2.0/BSD, không cần thư viện hệ thống). Không dùng PyMuPDF vì giấy phép AGPL. Video MP4: FFmpeg/ffprobe 9.0.2, build LGPL-2.1-or-later riêng cho worker ([ADR 0009](adr/0009-mp4-thumbnails.md)) |
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
M2-04: app `uploads` (`UploadSession`, `services.py`): giữ chỗ quota, cấp URL part, hoàn tất (tạo Blob/Node/FileVersion), hủy. Không gọi S3 trong transaction; quota của một owner thay đổi lần lượt nhờ khóa dòng User. Quy tắc: [upload.md](features/upload.md).
M2-06: celery beat chạy lịch trong `CELERY_BEAT_SCHEDULE` (hiện có `expire-uploads` mỗi giờ). Mỗi deployment chỉ chạy **một** process beat; dev chạy khi cần:
`cd "$(git rev-parse --show-toplevel)/qloud_backend" && DJANGO_SETTINGS_MODULE=config.settings.dev uv run celery -A config beat -l info` (file lịch `celerybeat-schedule` không commit).
M3-01: `drive.thumbnails` xử lý ảnh/PDF bằng Pillow 12 / pypdfium2 5, lockfile ghim bản ổn định đã xác minh và cài được trên Python 3.14. Chỉ worker dùng `storage.s3.read_object` (giới hạn byte) / `put_object` để tạo nội dung dẫn xuất. `drive.tasks.generate_thumbnail` chạy sau commit, retry S3 và có timeout riêng; quy tắc/giới hạn ở [download-preview.md](features/download-preview.md#m3-01--thumbnail-ảnhpdf). Không proxy byte người dùng qua Django. PDFium được khóa bằng mutex trong mỗi process (kể cả eager test) vì [thư viện không thread-safe](https://pypdfium2.readthedocs.io/en/stable/python_api.html#incompatibility-with-threading); triển khai dùng Celery prefork để xử lý song song và thực thi timeout.
M3-02: `drive.previews` cấp presigned URL nguồn/thumbnail qua `storage.s3.presign_download`, sau khi view lấy node qua lớp quyền chung. MIME nguồn được allowlist; text ép `text/plain`, loại có thể chạy script không cấp URL preview. Không đọc byte hoặc gọi worker trong request; key thumbnail phải thuộc current version. API và types sinh từ OpenAPI; UI thuộc M3-03.
Pillow có type hint; pypdfium2 chưa có nên chỉ bỏ qua import cho module này, ép kiểu ảnh PIL ở biên thư viện. Giấy phép thực tế trong metadata: Pillow `MIT-CMU` (permissive); pypdfium2 `BSD-3-Clause, Apache-2.0, dependency licenses`, kèm các license permissive của PDFium và native bundle (BSD, MIT, Apache, Unicode, FreeType, IJG/libjpeg, libpng, zlib). Wheel giữ các notice bản quyền. `scripts/check_licenses.py` cho phép đúng hai chuỗi theo từng package, không mở rộng allowlist chung; giấy phép thay đổi vẫn bị CI chặn. Không dùng PyMuPDF/AGPL.
M2-08a (FE): `features/upload/engine.ts` là engine upload thuần TypeScript (API, XHR, timer, trạng thái mạng được truyền vào để test), chạy trong `UploadProvider` ở layout của app; khay upload đọc store `zustand`. Quy tắc: [upload.md](features/upload.md#đã-làm-ở-m2-08a-105).
LocalStack có hai bucket: `qloud-dev` (dev, CORS cho Vite) và `qloud-e2e` (Playwright, CORS cho `vite preview`). Đổi `infra/localstack/init-s3.sh` thì phải tạo lại container (`docker compose up -d --force-recreate localstack`), vì bind mount một file vẫn giữ bản cũ.
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
| Danh sách dài | @tanstack/react-virtual (virtualization khi folder có hơn 200 mục) |
| Menu chuột phải | @radix-ui/react-context-menu (cùng họ Radix với shadcn/ui) |
| UI | Tailwind CSS, shadcn/ui (Radix), lucide-react (icon) |
| Form | react-hook-form + zod |
| i18n | i18next + react-i18next |
| Xem trước | pdf.js 6.4 (`pdfjs-dist`, Apache-2.0), thẻ `<video>`/`<audio>` gốc của trình duyệt |
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
M2-08b: resume dùng fingerprint lưu trên server, không dùng IndexedDB. FE đọc session active qua TanStack Query và chỉ gắn File vào engine sau khi chọn lại đúng fingerprint; upload folder tạo cây từ trên xuống rồi ánh xạ đường dẫn sang ID.
Xem [features/upload.md](features/upload.md) và [ADR-0003](adr/0003-direct-to-s3-multipart-upload.md).

### Download / xem trước
FE gọi `GET /nodes/{id}/download`. BE kiểm tra quyền rồi trả presigned GET URL (hạn khoảng 5 phút,
có `Content-Disposition`). Video được stream trực tiếp từ S3 vì S3 hỗ trợ Range request.

### Phân quyền
Quyền của một người trên một node = mức quyền cao nhất trong các nguồn sau: là owner;
có `Share` trực tiếp trên node; có `Share` trên một folder tổ tiên (quyền được thừa kế).
Với share link thì chỉ xét token của link đó và cây con bên dưới node được chia sẻ.

Code: `apps/sharing/permissions.py`; model Share thêm ở M5-01, ShareLink ở M5-03.
- `Role`: `VIEWER < EDITOR < OWNER`. Share cấp viewer/editor trực tiếp hoặc qua folder tổ tiên.
- `nodes_for(user, role, trashed=False)`: queryset các node mà user có ít nhất `role`; `trashed=True` chỉ node trong thùng rác, `None` cả hai.
  Mọi selector và view lấy node từ đây, không dùng `Node.objects` trực tiếp.
- `get_node_or_404(user, node_id, role)`: không có quyền, không tồn tại hay id sai định dạng đều là cùng một 404.
- Recursive CTE PostgreSQL duyệt cây từ các grant, chỉ qua folder còn sống và cùng owner. `nodes_for` dùng subquery để giữ queryset composable; `role_of` lấy mức cao nhất. Không cache quyền giữa request.
- Share không cho xem node đã trash, kể cả `trashed=True/None`; các chế độ đó chỉ mở thùng rác cho owner.
- `can_move_within` yêu cầu một grant editor chung bao phủ cả node con và folder đích. Breadcrumb cắt trước tổ tiên không có quyền; editor trash khóa owner thực của node và ghi người thao tác vào `trashed_by`.
- `role_of(user, node)`. User chưa đăng nhập, không active hoặc bị khóa thì không có quyền gì.

M5-02: `sharing.services` tuần tự hóa mọi thao tác ghi grant bằng khóa user owner thật của node và kiểm tra lại quyền sau khóa, dùng cùng khóa với Drive move/trash. Selector danh sách đi qua `nodes_for`; `shared_with_me` dùng Exists/Case để tính role và select_related owner trong một query, danh sách grant select_related grantee. Grant trực tiếp độc lập với grant đã cấp quyền cho người tạo; thu hồi không cascade theo created_by. API/schema/type cùng được cập nhật; email và UI chia sẻ thuộc M5-04/M5-05.

M5-03: `ShareLink` và `sharing.link_services/link_selectors` quản lý link owner-only, cùng khóa owner với Drive. `nodes_for_link` dùng recursive CTE từ đúng root/cùng owner, chỉ đi qua folder còn sống; kiểm tra lại revoked_at/expiry/trash/is_active/suspended_at trong query, độc lập với session và grant người dùng. Public breadcrumb cũng giới hạn CTE này; mọi endpoint public đi qua lớp quyền chung. Public views AllowAny và không dùng session authentication; chỉ GET, quản lý link vẫn session/CSRF như API khác. `storage.s3.presign_download` nhận TTL tùy chọn, Drive download/preview giữ hạn mặc định cho session, public giới hạn cả URL nguồn/thumbnail theo thời gian còn lại của link. Không proxy byte; URL đã cấp không thể thu hồi trước hạn chữ ký. Hợp đồng này và preview public được owner duyệt ở #35.

M5-04: `sharing.notifications.schedule_share_email` render snapshot text/HTML bằng locale người nhận, templates/catalog vi/en trong app sharing. `create_share` đăng ký `transaction.on_commit` để enqueue `accounts.tasks.send_email`; không gửi email trong transaction, không thêm query vào endpoint danh sách hoặc schema/outbox. Payload đã render giữ nguyên khi node/grant/user thay đổi sau commit. HTML autoescape, subject cố định dịch; link theo UUID compact + APP_BASE_URL, không chứa tổ tiên hay presigned URL. SMTP/OSError retry dùng task auth hiện có; delivery không bảo đảm exactly-once. M5-08: file-link UI kiểm tra node file trước, rồi quyền folder cha; nếu cha trả 404 thì dùng viewer độc lập với đúng một file, không fetch danh sách cha hay chuyển file. Đóng viewer về Drive của người nhận; lỗi cha khác 404 cho phép thử lại. API preview/download vẫn kiểm tra quyền hiện tại.

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

M2-09: stack E2E tắt persistent DB connections (`CONN_MAX_AGE=0`) để request trong các thread của Django runserver giải phóng kết nối sau khi xong; các bài seed dữ liệu/phân trang chạy song song không tích lũy kết nối vượt giới hạn PostgreSQL. Cấu hình ứng dụng dev/production giữ nguyên. Seed API cho test Gần đây giới hạn 2 request tạo file đồng thời mỗi test để giảm burst kết nối qua proxy vào runserver khi nhiều worker cùng kiểm tra luồng UI.

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

M3-03: frontend dùng query preview theo node id/updated_at, chỉ tải thumbnail khi item hiển thị (grid/list). Viewer PDF lazy-load module, worker và CMap/font/WASM đi từ assets nội bộ; `scripts/copy-pdfjs-assets.mjs` sao chép từ dependency lockfile trước dev/build, thư mục sinh `public/pdfjs` không commit/lint/format. Chọn pdf.js 6.4 sau kiểm tra [release v6.4.299](https://github.com/mozilla/pdf.js/releases/tag/v6.4.299) và [API/examples chính thức](https://mozilla.github.io/pdf.js/examples/); render canvas không gắn scripting/action layer. S3 CORS expose `Accept-Ranges`, `Content-Range`, `Content-Length` cùng `ETag` để pdf.js đọc Range; production bucket cần cùng cấu hình header.


M3-04: FFmpeg/ffprobe **chạy trên host/container Celery worker**, dưới dạng subprocess của `drive.video_thumbnails`; không chạy trong trình duyệt hay Django API. Dev chạy worker trực tiếp trên máy thì binary nằm trên máy; production phải build/cài binary và shared libraries vào image hoặc host của worker. Django API chỉ cấp URL S3, không cần FFmpeg. `python3 scripts/build_ffmpeg.py` dùng C compiler + make, tải source 9.0.2 chính thức theo SHA256 ghim, build shared LGPL-2.1-or-later không GPL/nonfree/version3/network, chỉ demux MOV/MP4, decoder native H.264/HEVC/MPEG-4 và xuất PNG. Không dùng FFmpeg Homebrew có GPL. `--check` kiểm tra phiên bản/cấu hình/license; CI build và kiểm tra ở backend/E2E. Thư mục `.tools/ffmpeg` không commit. Khi đóng gói worker, giữ toàn bộ prefix cùng `share/qloud-ffmpeg` (source, license và cấu hình), rồi đặt `THUMBNAIL_FFMPEG`/`THUMBNAIL_FFPROBE` thành đường dẫn tuyệt đối nếu khác mặc định.

Build dùng zlib của hệ thống (giấy phép Zlib, cần header khi compile) và RPATH tới `<prefix>/lib`. Khi build image nhiều stage, dùng `--prefix` đúng đường dẫn cuối trong worker và copy prefix sang cùng đường dẫn; không di chuyển binary/shared libraries sang prefix khác. Ví dụ build `python3 scripts/build_ffmpeg.py --prefix /opt/qloud-ffmpeg`, rồi cấu hình `THUMBNAIL_FFMPEG=/opt/qloud-ffmpeg/bin/ffmpeg` và `THUMBNAIL_FFPROBE=/opt/qloud-ffmpeg/bin/ffprobe`.

### Dọn thùng rác (M4-02)

Celery beat gọi `apps.drive.tasks.expire_trash` hằng ngày, xét thời hạn `trash_retention_days`
của plan hiện tại từng owner, gồm cả tài khoản bị khóa. Quét root theo batch 200, mỗi root
là một transaction có khóa owner; kiểm tra lại hạn/trạng thái để không xóa nhóm đã khôi phục.
Nghiệp vụ purge dùng chung với API. `apps.drive.tasks.delete_trash_objects` chạy mỗi giờ
và được enqueue sau commit của API; xóa S3 theo batch 1.000, giữ hàng đợi bền vững khi lỗi.
Một tiến trình beat duy nhất; worker có thể chạy nhiều instance. Dev cần chạy cả worker và beat.

### Frontend chia sẻ (M5-05)

`features/sharing` quản lý grant/link qua TanStack Query và API có kiểu hiện có. `/shared` dùng FileBrowser/NodeCollection; `/s/:token` đặt PublicTokenContext để viewer/thumbnail dùng endpoint public. Cache node/children/preview public có token trong key, tách cache Drive. `useNode` và `downloadNode` nhận token tùy chọn; preview đọc context và giữ refresh URL trước hết hạn. Public node được chuyển sang kiểu hiển thị chung bằng `is_root: false`; không thêm thông tin owner/tổ tiên hoặc cấp quyền từ session. UI capabilities phục vụ ẩn action; server vẫn quyết định quyền mọi request.


### Báo cáo và kiểm duyệt (M5-07)
Moderation nằm trong app sharing, dùng service duy nhất cho API superuser. `/moderation` là route React riêng; `/admin/` chỉ đọc report/audit. Không thêm dependency. PostgreSQL transaction advisory lock theo HMAC IP bảo đảm giới hạn 5 báo cáo mới/giờ và dedup 24 giờ khi nhiều instance; owner row lock đồng bộ với thay đổi cây/link. Resolver khóa actor/owner/superuser theo thứ tự UUID cùng service suspension, sau đó report/link để tránh thao tác cạnh tranh tạo nhiều audit hoặc email. Snapshot UUID giữ lịch sử sau purge. `MODERATION_EMAIL` bắt buộc hợp lệ ở production (dev có thể trống), email qua Celery sau commit; IP qua allauth adapter và trusted proxy hiện có. E2E có header IP riêng chỉ trong test settings để mỗi browser fixture kiểm tra quota độc lập.
