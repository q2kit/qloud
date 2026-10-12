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
| GET/PATCH | `/me` | Hồ sơ và tùy chọn: `display_name`, `locale` (`vi`/`en`), `theme` (`system`/`light`/`dark`) sửa được; `id`, `email`, `avatar_url`, `root_folder_id` (folder gốc của Drive, M2-07a) chỉ đọc. PATCH chỉ ghi các trường được gửi |
| GET | `/me/storage` | Quota, dung lượng đã dùng, chia theo loại file |

### Node
| Method | Path | Mô tả |
|---|---|---|
| GET | `/nodes/{id}` | Chi tiết node, breadcrumb, quyền của mình (`capabilities`) |
| GET | `/nodes/{id}/children` | Liệt kê con (phân trang, sắp xếp) |
| POST | `/folders` | Tạo folder `{parent_id, name, on_conflict?}` |
| PATCH | `/nodes/{id}` | Đổi tên `{name}` |
| POST | `/nodes/move` | Di chuyển nhiều node `{node_ids, target_parent_id}` |

**M2-08b — xung đột khi tạo folder:**
`POST /folders` thêm `on_conflict`: `fail` (mặc định, 409 `name_conflict` như cũ),
`rename` (tên trống tiếp theo với hậu tố ` (n)`), `reuse` (trả folder cùng tên không phân biệt hoa/thường).
Cả tạo mới và dùng lại trả 201 cùng schema Node. `reuse` chỉ dùng folder đang sống;
trùng với file vẫn trả 409, folder trong thùng rác không được dùng lại. Quyền editor trên parent
được kiểm tra trước mọi lựa chọn; không có quyền trả 404. Lựa chọn được tuần tự hóa bằng khóa owner
trong transaction để các lần tạo/giữ cả hai/gộp đồng thời không sinh bản sao ngoài ý muốn.


M2-02 (5 endpoint trên):
- Node trả về `id, kind, name, parent_id, is_root, size, mime_type, created_at, updated_at`. Folder gốc có `is_root: true`; tên lưu là `Drive`, FE hiển thị tên đã dịch.
- Chi tiết thêm `breadcrumb` (`[{id, name}]` từ folder gốc tới folder cha; với người nhận share chỉ gồm đường dẫn liên tục có quyền xem) và `capabilities` (`can_edit`: đổi tên, di chuyển, tạo bên trong; `can_trash`; `can_share`). Folder gốc có cả ba là `false`.
- `children`: phân trang keyset (`apps/drive/pagination.py`), cùng dạng `{results, next, previous}`. `ordering` mặc định `name`; cursor chỉ dùng được với đúng `ordering` đã tạo ra nó, sai thì 404 `not_found`.
  File không có con: trả trang rỗng.
- `move`: 1–1000 id, một transaction; trả `{nodes: [...]}` sau khi chuyển (tên có thể đã thêm hậu tố). Một id không thấy hoặc không có quyền thì 404 và không chuyển gì. Editor chỉ chuyển node con trong cùng một folder cấp editor; chuyển giữa các cây được chia sẻ riêng hoặc chuyển chính gốc grant trả 400 `invalid_move`.
- Mã lỗi: `name_conflict` (409), `invalid_target` (400: đích không phải folder), `invalid_move` (400: vào chính nó/cây con, hoặc sang Drive của người khác), `root_folder` (400: đổi tên/di chuyển folder gốc).
| POST | `/nodes/trash` | Đưa nhiều node vào thùng rác `{node_ids}` |
| GET | `/nodes/{id}/download` | Trả về `{url, expires_at}` (presigned, 5 phút; folder → 400 `not_a_file`) |
| GET | `/nodes/{id}/preview` | `{kind, url, expires_at, thumbnail}` (M3-02, presigned 5 phút) |
| GET | `/recent` | Tối đa 100 file của mình được cập nhật gần nhất (M2-09) |
| GET | `/shared-with-me` | Các node người khác đã chia sẻ cho mình |

### Xem trước (M3-02)
- `GET /nodes/{id}/preview`: yêu cầu đăng nhập/quyền viewer, node còn sống; không thấy/không có quyền/trashed → 404, folder → 400 `not_a_file`.
- `GET /nodes/{id}/preview?trashed_thumbnail=true`: chỉ owner của file trong thùng rác; quyền kiểm tra qua lớp chung. Trả cùng schema nhưng `url`/`expires_at` luôn null, chỉ ký URL thumbnail current version. File còn sống/không có quyền/không tồn tại → 404; folder hoặc query sai → 400. Chế độ mặc định và download vẫn từ chối node trong thùng rác.
- Response: `{kind, url, expires_at, thumbnail}`. `kind` là `image | pdf | video | audio | text | unsupported`. `url` và `expires_at` null khi unsupported; FE dùng endpoint download khi đó.
- `thumbnail`: null khi chưa tạo xong hoặc key không thuộc current version; có thì `{url, large_url, expires_at}` cho ảnh/PDF/MP4 (cạnh dài tối đa 256/1024px WebP). Tất cả URL inline hạn 5 phút, byte trực tiếp từ S3, hỗ trợ Range.
- MIME/size lấy từ current version, tên từ node hiện tại. Text trong allowlist nhỏ hơn 1.000.000 byte ép `text/plain`; không cấp URL preview cho loại chạy script hoặc MIME ngoài allowlist. Danh sách cụ thể và quyết định: [download-preview.md](features/download-preview.md#m3-02--api-preview).

### Gần đây (M2-09)
- `GET /recent` yêu cầu đăng nhập, chỉ trả file còn sống thuộc owner hiện tại, đi qua `sharing.permissions.nodes_for`.
- Schema `{results: Node[], next, previous}` giống children; mặc định `page_size=50`, tối đa 100 mỗi trang. Tổng tập kết quả tối đa 100 file, không phải 100 mỗi trang. Chọn tập 100 mới nhất trước khi áp cursor, không có offset/count query.
- Thứ tự cố định `-updated_at`, khóa phụ `-id`; `ordering` khác trả 400. Cursor lỗi trả 404; `page_size` không phải số nguyên dương trả 400. Cursor lấy từ link `next`/`previous`.
- Chưa có lịch sử lần mở/download. Không đưa file chia sẻ vào M2; bổ sung sau theo [quyết định #25](https://github.com/q2kit/qloud/issues/25#issuecomment-6100858060).

### Upload
| Method | Path | Mô tả |
|---|---|---|
| POST | `/uploads` | Tạo session `{parent_id, filename, size, mime_type, fingerprint, target_node_id?}` |
| GET | `/uploads/{id}` | Trạng thái session và danh sách part đã lên S3 |
| POST | `/uploads/{id}/parts` | Lấy presigned URL `{part_numbers: [..]}` |
| POST | `/uploads/{id}/complete` | Hoàn tất upload, trả về node |
| DELETE | `/uploads/{id}` | Hủy upload |
| GET | `/uploads?status=active` | Các upload dở dang, để resume |

M2-04: `POST /uploads` trả session `{id, part_size, part_count, expires_at, ...}` (201), nhận thêm `on_conflict` (`fail`|`rename`|`replace`). M7-01: `target_node_id` tùy chọn để thêm phiên bản vào file; khi có target, server đặt `on_conflict=replace`. `parent_id` phải khớp cha lúc tạo session. Target phải là file còn sống và có quyền editor; upload qua target tường minh không cần quyền trên folder cha. `replace` theo tên cần editor folder/file và khớp tên không phân biệt hoa thường. Session trả thêm `target_node_id` (nullable). Folder, target sai cha hoặc không có file để replace trả 400 `invalid_target`; thiếu quyền trả 404. Complete kiểm tra lại target, nếu mất quyền/trash/purge thì hủy session và trả 409 `target_unavailable`. Xem [versioning.md](features/versioning.md#m7-01--upload-phiên-bản-mới).
`POST /uploads/{id}/parts` nhận tối đa 100 số part, trả `{parts: [{part_number, url}], expires_at}` (URL hạn 1 giờ).
`GET /uploads/{id}` có thêm `parts` (`part_number, size, etag`) đọc từ S3. `?status=active` bỏ qua session đã hết hạn. Quy tắc và mã lỗi: [upload.md](features/upload.md#quyết-định-của-m2-04-20).

### Phiên bản
| Method | Path | Mô tả |
|---|---|---|
| GET | `/nodes/{id}/versions` | Danh sách phiên bản |
| GET | `/nodes/{id}/versions/{vid}/download` | Tải một phiên bản cũ |
| POST | `/nodes/{id}/versions/{vid}/restore` | Đặt phiên bản này làm phiên bản hiện tại (tạo version mới) |
| PATCH | `/nodes/{id}/versions/{vid}` | Bật/tắt Giữ mãi (owner) |
| DELETE | `/nodes/{id}/versions/{vid}` | Xóa một phiên bản (không xóa được phiên bản hiện tại) |

M7-03 bổ sung `capabilities.can_delete_versions` vào chi tiết node: true cho owner của file còn sống, false cho folder/root và public. Editor/viewer không có capability này; quyền restore vẫn theo `can_edit`. Không đổi luật kiểm tra quyền của endpoint.

M7-02 triển khai cả bốn endpoint, chỉ cho file còn sống và phiên đăng nhập:
- List/download cần viewer; restore cần editor; delete chỉ owner. Quyền trực tiếp và thừa kế dùng lớp chung. Không truy cập được, node trash hoặc version sai node → 404; folder → 400 `not_a_file`.
- List trả `{results, next, previous}`, `version_number` giảm dần, page_size mặc định 50, tối đa 200. Version gồm `{id, version_number, size, mime_type, original_name, uploaded_by: {id, display_name} | null, created_at, keep_forever, is_current}`; không có email/storage_key.
- Download trả `200 {url, expires_at}`, tên file theo node hiện tại, MIME an toàn của version đã chọn; TTL giống download current. Byte đi trực tiếp tới S3.
- Restore không nhận body, trả `200 Node`; tạo version mới dùng chung Blob nguồn, quota không tăng kể cả đã đầy. Reset/enqueue thumbnail cho version mới, giữ tên/vị trí/share/link.
- PATCH nhận bắt buộc `{keep_forever: boolean}` (JSON boolean), trả `200 FileVersion` với `is_current`. Chỉ owner, kể cả current; 400 khi thiếu/sai kiểu hoặc folder, 404 khi node trash/không có quyền/version sai node. Giữ mãi không ngăn owner xóa thủ công bản cũ.
- Delete trả 204; restore/delete current trả 409 `current_version`. Xóa Blob khỏi quota chỉ khi hết tham chiếu, S3/thumbnail được dọn qua hàng đợi bền vững sau commit.

### Chia sẻ
M5-02 triển khai API share người dùng; M5-03 triển khai API link/public (báo cáo thuộc M5-07).
- GET/POST danh sách share và PATCH/DELETE share yêu cầu editor hoặc owner trên node còn sống, không phải folder gốc. Viewer/người ngoài/trashed trả 404, folder gốc trả 400 `root_folder`. Kiểm tra quyền trước lookup email.
- POST `{email, role}` chỉ nhận viewer/editor; tra email chính của tài khoản active, không bị khóa, không phân biệt hoa thường. Không có người nhận hợp lệ: 400 `invalid_share_recipient`; người nhận là chính người thao tác hoặc owner: 400 `invalid_share_target`; grant trực tiếp trùng: 409 `share_exists`.
- POST trả 201, PATCH `{role}` trả 200 với Share `{id, node_id, grantee: {id, email, display_name}, role, created_by_id, created_at, updated_at}`; DELETE trả 204. Owner/editor có thể sửa/thu hồi mọi grant trực tiếp trên node đó. Grant thừa kế được quản lý ở node nguồn, không qua node con.
- GET shares trả `{results, next, previous}`, mới nhất trước theo created_at/id, page_size mặc định 50, tối đa 200. Không bao gồm grant ở tổ tiên.
- GET `/shared-with-me` dùng cursor/ordering như danh sách node, trả Node kèm `owner: {id, display_name}` và `effective_role` viewer/editor. Chỉ gồm grant trực tiếp cho mình trên node còn sống của người khác; node được thừa kế đơn thuần không xuất hiện. Grant trực tiếp trên cả cha và con đều xuất hiện.
- M5-04: POST tạo Share thành công xếp email thông báo text/HTML bằng locale người nhận sau commit, dùng SMTP/Celery hiện có. Rollback/lỗi/duplicate/PATCH/DELETE/ShareLink không gửi; tạo lại grant đã thu hồi gửi email mới. Nội dung giữ snapshot lần cấp quyền và link APP_BASE_URL, không kèm presigned URL hoặc byte file. API response/schema không đổi.
- Thu hồi bỏ một nguồn quyền; grant khác còn hiệu lực tiếp tục cấp mức cao nhất. Grant do editor tạo độc lập với quyền editor, owner thu hồi chúng riêng. M5-02 chưa gửi email; M5-04 bổ sung thông báo khi tạo grant mới.

| Method | Path | Mô tả |
|---|---|---|
| GET/POST | `/nodes/{id}/shares` | Danh sách share / chia sẻ cho người khác `{email, role}` |
| PATCH/DELETE | `/shares/{id}` | Đổi quyền / thu hồi |
| GET/POST | `/nodes/{id}/links` | Danh sách share link / tạo link `{expires_at?}` |
| DELETE | `/links/{id}` | Thu hồi link |
| GET | `/public/links/{token}?node_id=` | Thông tin node qua link (không cần đăng nhập) |
| GET | `/public/links/{token}/children?folder_id=` | Duyệt folder được chia sẻ |
| GET | `/public/links/{token}/download?node_id=` | Tải file qua link |
| GET | `/public/links/{token}/preview?node_id=` | Xem trước file qua link, schema như preview Drive |
| POST | `/public/links/{token}/reports` | Báo cáo vi phạm `{node_id, reason, message?, email?, turnstile_token}` |

#### Hợp đồng ShareLink (M5-03)
- GET/POST links và DELETE link chỉ owner thật trên node còn sống, không phải folder gốc; editor/viewer/người ngoài/trashed trả 404, root trả 400 `root_folder`. Kiểm tra quyền trước payload. POST `{expires_at?: datetime|null}`: null/bỏ qua là không hết hạn; thời gian phải ở tương lai. Trả 201 ShareLink `{id,node_id,token,role,expires_at,revoked_at,revoked_by_id,revoke_reason,created_by_id,created_at,updated_at}`.
- GET links cursor 50/tối đa 200, mới nhất trước created_at/id; gồm cả link đã hết hạn/thu hồi. DELETE trả 204, ghi revoked_at/by/reason owner; gọi lại không đổi audit, không bật lại link và giữ reason moderation.
- Public endpoint không dùng quyền session. Root và hậu duệ cùng owner còn sống là phạm vi duy nhất; token sai/hết hạn/thu hồi, owner inactive/suspended đều trả cùng 404 `not_found`. Kiểm tra ở mỗi request và truy vấn node qua lớp quyền link chung.
- GET public chi tiết nhận node_id tùy chọn, mặc định root. Trả `{id,kind,name,parent_id,size,mime_type,created_at,updated_at,breadcrumb,capabilities}`; parent_id root null, breadcrumb chỉ trong cây link, capabilities can_edit/can_trash/can_share đều false. Không trả email owner, tổ tiên ngoài cây, token/audit hay blob/storage key.
- Children nhận folder_id tùy chọn mặc định root, dùng cursor/ordering như Drive; chỉ liệt kê con trực tiếp trong cây. File trả 400 `not_a_folder`. Node ngoài cây/trash trả 404. UUID query sai trả 400 `validation_error`; cursor sai trả 404.
- Download/preview nhận node_id tùy chọn mặc định root. Folder trả 400 `not_a_file`; file chưa có current version trả 404. Download trả `{url,expires_at}`; preview dùng schema/allowlist MIME như Drive, thumbnail chỉ current version. Không có upload, ghi hoặc lịch sử phiên bản qua token.
- URL nguồn và thumbnail tối đa 5 phút, không vượt expires_at của link (làm tròn xuống theo giây; còn dưới 1 giây không cấp URL). Thu hồi/trash/di chuyển khỏi cây ngăn cấp URL mới ở request tiếp theo; URL S3 đã cấp còn hiệu lực tới hạn chữ ký. Byte không đi qua server ứng dụng.

### Thùng rác
| Method | Path | Mô tả |
|---|---|---|
| GET | `/trash` | Liệt kê các mục trong thùng rác (chỉ các `trashed_root`) |
| POST | `/trash/restore` | Khôi phục `{node_ids}` |
| POST | `/trash/delete` | Xóa vĩnh viễn `{node_ids}` |
| POST | `/trash/empty` | Dọn sạch thùng rác |

M4-01 đã triển khai các endpoint thùng rác ở trên và `POST /nodes/trash`:
- Các request `{node_ids}` nhận 1–1.000 UUID, bỏ ID lặp. Batch lỗi/quyền thiếu trả 404
  và không thay đổi mục nào. Folder gốc không được đưa vào thùng rác (`400 root_folder`).
- `POST /nodes/trash` trả `200 {nodes}` các root thực sự bị xóa; mỗi mục có thêm `trashed_at`,
  `trashed_root_id`. Nếu chọn cả cha và con còn sống thì trả root cha.
- `GET /trash` trả `{next, previous, results}` theo cursor, dùng cùng `ordering`/`page_size`
  với danh sách folder (mặc định tên, folder trước; 50 mục, tối đa 200). Chỉ trả root nhóm của owner.
- Khôi phục/xóa chỉ nhận ID root nhóm. Khôi phục trả `200 {nodes}` đã khôi phục, cha trước con;
  trùng tên tự thêm hậu tố, cha không còn sống thì về folder gốc.
- Xóa vĩnh viễn/dọn sạch trả 204; dọn sạch chỉ tác động thùng rác của owner đang đăng nhập.
  Quota giảm ngay trong transaction, object S3 và thumbnail được Celery dọn sau commit.
  Xóa folder bao gồm nhóm xóa cũ bên trong. Tất cả endpoint yêu cầu đăng nhập. Từ M5-01, đưa vào thùng rác cần editor/owner và ghi editor vào `trashed_by`; owner thực của node giữ quyền liệt kê/khôi phục/xóa vĩnh viễn, người nhận share mất quyền truy cập ngay.

### Tìm kiếm
| Method | Path | Mô tả |
|---|---|---|
| GET | `/search?q=&type=&modified_after=&owner=me|others` | Tìm theo tên |

M6-01: endpoint yêu cầu đăng nhập, nhận `q` (1–255 ký tự sau trim), `type` (folder/document/image/video/audio/archive/other), `owner` (me/others), `modified_after` (ISO 8601 có timezone, lọc >=), `page_size` (mặc định 50, tối đa 200) và `cursor`. Bỏ bộ lọc nghĩa là tất cả node có quyền.
- Không phân biệt hoa/dấu, NFC; chuỗi con và trigram >=0,3 cho từ khóa từ 3 ký tự. Từ khóa 1–2 ký tự chỉ chuỗi con; `%`/`_` không là wildcard.
- Xếp exact → prefix → similarity giảm dần (lượng tử hóa thành số nguyên triệu phần) → updated_at giảm dần → UUID giảm dần. Cursor có chữ ký, gắn user/từ khóa/bộ lọc, hỗ trợ tiến/lùi.
- Response `{next, previous, results}`; mỗi kết quả gồm metadata Node, `owner: {id, display_name}`, `effective_role: owner|editor|viewer`. Không trả breadcrumb, source URL hay byte.
- Bao gồm node sở hữu và được share trực tiếp/thừa kế; loại folder gốc và trash. Link public không cấp quyền tìm kiếm. Truy vấn qua `sharing.permissions.nodes_for`.
- Query sai trả 400 `validation_error`; chưa đăng nhập trả 403; cursor sai hoặc dùng với user/từ khóa/bộ lọc khác trả 404.
- MIME document: text/*, PDF/RTF/MS Office/OpenXML/OpenDocument; archive: ZIP/RAR/7z/tar/gzip/bzip2/xz; image/video/audio theo MIME prefix; other gồm MIME chưa biết hoặc null.

### Hệ thống
| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Healthcheck (DB, Redis) |


## Báo cáo vi phạm và kiểm duyệt (M5-07)

`GET /api/v1/me` bổ sung `is_superuser` boolean chỉ đọc; PATCH không sửa được quyền.

| Endpoint | Quyền | Hợp đồng |
|---|---|---|
| `POST /api/v1/public/links/{token}/reports` | Khách hoặc session hợp lệ; session phải có CSRF | JSON `node_id` UUID, `reason` illegal/copyright/malware/abuse/other; `message` tùy chọn ≤2000, `email` tùy chọn ≤254, `turnstile_token` tùy chọn khi dev tắt captcha. 202 `{status: "accepted"}` cho mới và trùng; 400 validation/captcha_invalid, 403 CSRF, 404 nội dung không khả dụng/ngoài phạm vi, 429 throttled kèm Retry-After. |
| `GET /api/v1/moderation/reports` | Superuser active, chưa suspended | Cursor pagination chuẩn, `status` tùy chọn open/actioned/dismissed; `node_uuid` UUID tùy chọn, kết hợp với status và được giữ qua cursor. Mỗi hàng gồm id, created_at, node_uuid, node_name, link_uuid, root_node_uuid, owner_uuid, reason, status, `node_report_count`, `node_open_report_count`. Hai số đếm bao gồm mọi report cùng UUID snapshot node, không bị giới hạn bởi filter/trang hiện tại. 403 khi không đủ quyền. |
| `GET /api/v1/moderation/reports/{id}` | Như trên | Thêm message, reporter_email, reporter_user_id nullable, resolved_at/by_id nullable, resolution_note, resolution nullable. `subject` gồm node/root_node nullable (id, tên hiện tại, loại, size, MIME nullable, trashed_at nullable), owner nullable (id, display_name, email, is_active, suspended_at), link_state active/revoked/expired/deleted/unavailable, link_revoked_at/expires_at/revoke_reason nullable, resolver_name nullable. UUID/name snapshot cũ giữ nguyên; không trả token, URL file hay IP hash. 404 nếu report không tồn tại. |
| `POST /api/v1/moderation/reports/{id}/resolve` | Như trên và CSRF | `action`: revoke_link/revoke_node/suspend_owner/dismiss; `note` bắt buộc, trim, 1–2000 ký tự. 200 chi tiết report sau xử lý. 400 input/guard khóa tài khoản, 403 quyền/CSRF, 404 report, 409 report_resolved/moderation_target_unavailable. |

Audit `resolution` có id, created_at, actor_uuid, action, note, targets (UUID owner/node và danh sách revoked_link_ids hoặc changed khi khóa). Một report có tối đa một resolution; không có endpoint sửa/xóa/mở lại. Gỡ mọi link giới hạn ở node gốc mà ShareLink trỏ tới. Báo cáo giữ snapshot dù mục/link đã xóa. Quy tắc quota/dedup/email xem [sharing.md](features/sharing.md).
