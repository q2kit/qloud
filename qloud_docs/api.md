# API

> **Nguồn sự thật là OpenAPI schema** do drf-spectacular sinh ra (`/api/schema/`, giao diện xem tại `/api/docs/`).
> Schema được commit ở `qloud_backend/openapi.yaml`; frontend sinh type từ file đó (`qloud_frontend/src/lib/api/schema.d.ts`).

## Cập nhật schema và client (bắt buộc khi đổi API)

Lệnh: AGENTS.md mục 8 › *Sau khi đổi API*.

- Commit cả `openapi.yaml` và `schema.d.ts` trong cùng PR với thay đổi API. CI chặn nếu một trong hai bị cũ
  (test `test_openapi_file.py` ở BE; bước so sánh type ở FE). Schema phải validate **không có cảnh báo**.
- Mỗi view phải khai báo đủ response (kể cả mã lỗi) bằng `@extend_schema`, để type ở FE đúng.
- FE gọi API qua `api` (`src/lib/api/client.ts`, openapi-fetch): tự gửi cookie và `X-CSRFToken`.
  Dùng `unwrap()` để lấy `data` hoặc ném `ApiError` (`status`, `code`, `details` theo định dạng lỗi chung).
  Không gọi `fetch` trực tiếp tới API.
> File này chỉ mô tả quy ước chung và danh sách endpoint ở mức tổng quan. Khi thêm hoặc sửa endpoint, cập nhật bảng bên dưới.

## Quy ước

- Base URL: `/api/v1`. JSON, tên trường dạng `snake_case`.
- **Xác thực:** session cookie (`allauth` headless, client `browser`). Mọi request ghi dữ liệu phải gửi header `X-CSRFToken`.
- **Phân trang:** dạng cursor, `?cursor=...&page_size=50` (tối đa 200). Response trả về `{ "results": [...], "next": "...", "previous": "..." }`.
- **Sắp xếp:** `?ordering=name|-name|updated_at|-updated_at|size|-size`. Folder luôn được xếp trước file.
- **Lỗi:** dùng một định dạng thống nhất
  ```json
  { "error": { "code": "quota_exceeded", "message": "Human readable", "details": {} } }
  ```
  `code` là chuỗi ổn định để FE dịch sang thông báo i18n. Lỗi dữ liệu (`validation_error`) đặt lỗi theo trường ở `details.fields` (`{"name": ["..."]}`); lỗi không gắn với trường nào nằm ở khóa `non_field_errors`.
  Mã HTTP: 400 (dữ liệu sai), 401, 403, 404 (**dùng 404 thay cho 403 khi không muốn để lộ là node có tồn tại**), 409 (xung đột), 413, 429.
- **Rate limit:** auth 10 req/phút/IP; tạo upload 60 req/phút/user; các endpoint còn lại 600 req/phút/user.

## Danh sách endpoint (tổng quan)

### Auth: `/api/auth/browser/v1/...`
Do allauth headless cung cấp (phiên bản `v1` của allauth). **Ngoại lệ về định dạng:** các endpoint này dùng định dạng của allauth,
không dùng định dạng lỗi chung ở trên: thành công `{"status", "data", "meta": {"is_authenticated"}}`,
lỗi `{"status", "errors": [{"code", "message", "param"}]}`. Chưa đăng nhập thì trả 401 kèm `data.flows`.
Schema riêng ở `/api/auth/openapi.json` (xem tại `/api/auth/openapi.html`), không nằm trong `openapi.yaml`.
Schema đó là của allauth nên không có các trường Qloud thêm vào: `remember` (login) và `turnstile_token` (signup, password request, provider signup).
Vượt rate limit trả 429; Turnstile sai trả 400 với `code: "captcha_invalid"`, `param: "turnstile_token"`.
FE gọi các endpoint này qua `src/features/auth/api.ts` (không qua `api` của openapi-fetch, vì chúng không có trong `openapi.yaml`);
module này gửi cookie, `X-CSRFToken` và `Accept-Language`, và là nơi duy nhất làm việc với API auth.

| Method | Path | Mô tả |
|---|---|---|
| GET | `/config` | Cấu hình auth; cũng đặt cookie `csrftoken` |
| GET / DELETE | `/auth/session` | Session hiện tại / đăng xuất |
| POST | `/auth/signup` | `{email, password, turnstile_token}` |
| POST | `/auth/login` | `{email, password, remember?}` |
| POST | `/auth/email/verify` | `{key}` từ link trong email |
| POST | `/auth/email/verify/resend` | Gửi lại email xác thực |
| POST | `/auth/password/request` | `{email, turnstile_token}`: gửi email đặt lại mật khẩu |
| POST | `/auth/password/reset` | `{key, password}` |
| POST | `/account/password/change` | Đổi mật khẩu khi đã đăng nhập |
| GET / POST / DELETE | `/account/email` | Quản lý email |
| POST (form) | `/auth/provider/redirect` | `provider`, `callback_url`, `process` (`login`/`connect`): chuyển sang Google/GitHub |
| GET / DELETE | `/account/providers` | Provider đã liên kết / gỡ liên kết `{provider, account}` |

Callback của provider (không gọi trực tiếp): `/api/auth/oauth/<provider>/login/callback/`.

### Cấu hình
| Method | Path | Mô tả |
|---|---|---|
| GET | `/config` | Công khai, không cần đăng nhập: `turnstile_site_key` (null khi server không kiểm tra Turnstile) |

### Tài khoản
| Method | Path | Mô tả |
|---|---|---|
| GET/PATCH | `/me` | Hồ sơ và tùy chọn: `display_name`, `locale` (`vi`/`en`), `theme` (`system`/`light`/`dark`) sửa được; `id`, `email`, `avatar_url` chỉ đọc. PATCH chỉ ghi các trường được gửi |
| GET | `/me/storage` | Quota, dung lượng đã dùng, chia theo loại file |

### Node
| Method | Path | Mô tả |
|---|---|---|
| GET | `/nodes/{id}` | Chi tiết node, breadcrumb, quyền của mình (`capabilities`) |
| GET | `/nodes/{id}/children` | Liệt kê con (phân trang, sắp xếp) |
| POST | `/folders` | Tạo folder `{parent_id, name}` |
| PATCH | `/nodes/{id}` | Đổi tên `{name}` |
| POST | `/nodes/move` | Di chuyển nhiều node `{node_ids, target_parent_id}` |

M2-02 (5 endpoint trên):
- Node trả về `id, kind, name, parent_id, is_root, size, mime_type, created_at, updated_at`. Folder gốc có `is_root: true`; tên lưu là `Drive`, FE hiển thị tên đã dịch.
- Chi tiết thêm `breadcrumb` (`[{id, name}]` từ folder gốc tới folder cha) và `capabilities` (`can_edit`: đổi tên, di chuyển, tạo bên trong; `can_trash`; `can_share`). Folder gốc có cả ba là `false`.
- `children`: phân trang keyset (`apps/drive/pagination.py`), cùng dạng `{results, next, previous}`. `ordering` mặc định `name`; cursor chỉ dùng được với đúng `ordering` đã tạo ra nó, sai thì 404 `not_found`.
  File không có con: trả trang rỗng.
- `move`: 1–1000 id, một transaction; trả `{nodes: [...]}` sau khi chuyển (tên có thể đã thêm hậu tố). Một id không thấy hoặc không có quyền thì 404 và không chuyển gì.
- Mã lỗi: `name_conflict` (409), `invalid_target` (400: đích không phải folder), `invalid_move` (400: vào chính nó/cây con, hoặc sang Drive của người khác), `root_folder` (400: đổi tên/di chuyển folder gốc).
| POST | `/nodes/trash` | Đưa nhiều node vào thùng rác `{node_ids}` |
| GET | `/nodes/{id}/download` | Trả về `{url, expires_at}` (presigned) |
| GET | `/nodes/{id}/preview` | URL xem trước hoặc thumbnail |
| GET | `/recent` | Các file mới mở hoặc mới sửa |
| GET | `/shared-with-me` | Các node người khác đã chia sẻ cho mình |

### Upload
| Method | Path | Mô tả |
|---|---|---|
| POST | `/uploads` | Tạo session `{parent_id, filename, size, mime_type, fingerprint, target_node_id?}` |
| GET | `/uploads/{id}` | Trạng thái session và danh sách part đã lên S3 |
| POST | `/uploads/{id}/parts` | Lấy presigned URL `{part_numbers: [..]}` |
| POST | `/uploads/{id}/complete` | Hoàn tất upload, trả về node |
| DELETE | `/uploads/{id}` | Hủy upload |
| GET | `/uploads?status=active` | Các upload dở dang, để resume |

M2-04: `POST /uploads` trả session `{id, part_size, part_count, expires_at, ...}` (201), nhận thêm `on_conflict` (`fail`|`rename`); `target_node_id` chờ M7-01.
`POST /uploads/{id}/parts` nhận tối đa 100 số part, trả `{parts: [{part_number, url}], expires_at}` (URL hạn 1 giờ).
`GET /uploads/{id}` có thêm `parts` (`part_number, size, etag`) đọc từ S3. `?status=active` bỏ qua session đã hết hạn. Quy tắc và mã lỗi: [upload.md](features/upload.md#quyết-định-của-m2-04-20).

### Phiên bản
| Method | Path | Mô tả |
|---|---|---|
| GET | `/nodes/{id}/versions` | Danh sách phiên bản |
| GET | `/nodes/{id}/versions/{vid}/download` | Tải một phiên bản cũ |
| POST | `/nodes/{id}/versions/{vid}/restore` | Đặt phiên bản này làm phiên bản hiện tại (tạo version mới) |
| DELETE | `/nodes/{id}/versions/{vid}` | Xóa một phiên bản (không xóa được phiên bản hiện tại) |

### Chia sẻ
| Method | Path | Mô tả |
|---|---|---|
| GET/POST | `/nodes/{id}/shares` | Danh sách share / chia sẻ cho người khác `{email, role}` |
| PATCH/DELETE | `/shares/{id}` | Đổi quyền / thu hồi |
| GET/POST | `/nodes/{id}/links` | Danh sách share link / tạo link `{expires_at?}` |
| DELETE | `/links/{id}` | Thu hồi link |
| GET | `/public/links/{token}` | Thông tin node qua link (không cần đăng nhập) |
| GET | `/public/links/{token}/children?folder_id=` | Duyệt folder được chia sẻ |
| GET | `/public/links/{token}/download?node_id=` | Tải file qua link |
| POST | `/public/links/{token}/reports` | Báo cáo vi phạm `{node_id, reason, message?, email?, turnstile_token}` |

### Thùng rác
| Method | Path | Mô tả |
|---|---|---|
| GET | `/trash` | Liệt kê các mục trong thùng rác (chỉ các `trashed_root`) |
| POST | `/trash/restore` | Khôi phục `{node_ids}` |
| POST | `/trash/delete` | Xóa vĩnh viễn `{node_ids}` |
| POST | `/trash/empty` | Dọn sạch thùng rác |

### Tìm kiếm
| Method | Path | Mô tả |
|---|---|---|
| GET | `/search?q=&type=&modified_after=&owner=me|others` | Tìm theo tên |

### Hệ thống
| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Healthcheck (DB, Redis) |
