# Data model

> Trạng thái: **Nháp**. Mọi bảng đều dùng khóa chính `id UUID` (UUIDv7, sắp xếp được theo thời gian), và có `created_at`, `updated_at`.

Phần User/Plan và nền Node tạo folder gốc được duyệt trong [M1-01](https://github.com/q2kit/qloud/issues/10#issuecomment-6088713465);
`drive_node`, `drive_blob`, `drive_file_version` và `uploads_upload_session` được duyệt cùng M2 ([#17](https://github.com/q2kit/qloud/issues/17)).
Các model/trường của milestone sau vẫn là thiết kế nháp.

## Sơ đồ quan hệ

```
Plan 1─────* User
User 1─────* Node (owner)
Node 1─────* Node (parent → children)          # cây thư mục
Node 1─────* FileVersion ─────1 Blob           # chỉ khi node là file
Node ──current_version──▶ FileVersion
Node 1─────* Share ─────* User (grantee)
Node 1─────* ShareLink
User 1─────* UploadSession ────▶ Node (đích) 
```

## Bảng

### `accounts_user`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid | |
| email | varchar(254), unique | đăng nhập bằng email; luôn lưu chữ thường, kèm unique constraint trên `lower(email)` |
| display_name | varchar(100) | |
| avatar_url | text, null | |
| locale | varchar(5) | `vi` hoặc `en` |
| theme | varchar(10) | `system`, `light` hoặc `dark` |
| plan_id | uuid → Plan | gói được gán khi đăng ký, là gói đang có `is_default_for_signup = true` tại thời điểm đó |
| quota_override_bytes | bigint, null | admin đặt riêng cho từng người, ưu tiên hơn giá trị của plan |
| used_bytes | bigint | tổng dung lượng các version của user, **kể cả trong thùng rác** |
| reserved_bytes | bigint | dung lượng đang giữ chỗ cho các upload chưa xong |
| session_version | bigint, không âm | mặc định 0; tăng khi khóa user, tham gia hash session để session cũ không dùng lại được khi mở khóa; không sửa từ admin |
| root_folder_id | uuid → Node, unique, null | folder gốc "Drive của tôi", tạo cùng lúc với user trong transaction; null tạm thời lúc tạo để giải quyết tham chiếu vòng User ↔ Node |

Bảng tài khoản OAuth và email xác thực do django-allauth quản lý.

### `accounts_plan`
Gói dung lượng. Đây là cách làm cho giới hạn **thay đổi được mà không ảnh hưởng user cũ** (xem [ADR-0005](adr/0005-storage-plans.md)).

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid | |
| code | varchar(50), unique | ví dụ `free-2026`, `free-2027`, `pro` |
| name | varchar(100) | tên hiển thị |
| quota_bytes | bigint | |
| max_file_size_bytes | bigint | |
| max_versions_per_file | int | số phiên bản cũ giữ lại tối đa |
| version_retention_days | int, null | phiên bản cũ quá số ngày này thì bị dọn; null = không giới hạn theo thời gian |
| trash_retention_days | int | mặc định 30 |
| is_default_for_signup | bool | partial unique index bảo đảm **tối đa một** plan true; seed và dịch vụ đổi mặc định duy trì đúng một plan active mặc định |
| is_active | bool | plan ngừng hoạt động thì không gán thêm cho ai, user đang dùng vẫn giữ |

- Giới hạn thực tế của một user: `quota_override_bytes ?? plan.quota_bytes`. Các giới hạn khác lấy từ plan.
- **Plan coi như bất biến sau khi đã có người dùng.** Muốn đổi giới hạn cho user mới thì tạo plan mới và đặt nó làm mặc định.
  Sửa trực tiếp một plan đang dùng sẽ ảnh hưởng tới mọi user của plan đó; chỉ làm vậy khi cố ý (ví dụ tặng thêm dung lượng cho mọi người).
- Migration dữ liệu ban đầu tạo 2 plan:
  - `free-2026` (**mặc định** cho đăng ký mở): 5 GB, file tối đa 5 GB, giữ 100 phiên bản trong 30 ngày, thùng rác 30 ngày.
  - `plus-2026` (admin gán thủ công): 50 GB, file tối đa 50 GB, các giới hạn khác như trên.
  Các con số này chỉnh được trong admin trước khi có user.
- Admin quản lý plan qua Django admin.
- `plan_id` không được null sau migration. Migration M1-01 seed plan rồi backfill plan/folder gốc cho user cũ trước khi đặt NOT NULL.
  Foreign key dùng `PROTECT` để không xóa plan có user. Tạo user mới không có mặc định hoặc chọn plan inactive thì bị từ chối, không lưu user dở dang.
- M1-01 có enum/constraint cho locale, theme và giới hạn không âm cho quota/counter.

### `drive_node`

Mỗi owner có tối đa một node `parent = null`, node này phải là folder (M1-01). M2-01 thêm các trường file/xóa mềm bên dưới và các index.
Check constraint ở DB: tên hợp lệ (giống `drive.names`); folder có `size = 0`, không có `mime_type`/`current_version`;
`trashed_at` và `trashed_root` cùng có hoặc cùng trống. `current_version`, `trashed_by` dùng `SET_NULL`.
Truy vấn node luôn đi qua `sharing.permissions` (xem [architecture.md › Phân quyền](architecture.md#phân-quyền)).

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid | |
| owner_id | uuid → User | |
| parent_id | uuid → Node, null | chỉ folder gốc có giá trị null |
| kind | enum(`folder`,`file`) | |
| name | varchar(255), collation `natural` | không chứa `/`; khác rỗng. Collation ICU `und-u-kn-true` (M2-02) cho natural sort; so sánh của cursor dùng cùng collation |
| mime_type | varchar(255), null | chỉ dùng cho file |
| size | bigint | dung lượng của current version (file); 0 với folder |
| current_version_id | uuid → FileVersion, null | |
| trashed_at | timestamptz, null | thời điểm xóa mềm |
| trashed_root_id | uuid → Node, null | node mà người dùng đã bấm xóa (dùng để khôi phục theo nhóm) |
| trashed_by_id | uuid → User, null | |
| thumbnail_key | text, null | |

**Ràng buộc và index:**
- Unique `(parent_id, lower(name))` WHERE `trashed_at IS NULL` để tên không trùng trong cùng folder. Khi trùng thì BE tự thêm hậu tố ` (1)`, ` (2)`…
- Index `(parent_id, kind DESC, name, id)` khớp thứ tự liệt kê mặc định (folder trước); index `(owner_id, trashed_at)`.
- Index trigram GIN trên `name` (extension `pg_trgm`) cho tìm kiếm: thêm ở M6-01, cùng lúc bật extension.
- Thao tác di chuyển phải chặn trường hợp chuyển node vào chính cây con của nó (kiểm tra bằng recursive CTE).

> Cách lưu cây: **adjacency list (`parent_id`) + recursive CTE**. Nếu đo thấy chậm thì chuyển sang `ltree` hoặc closure table và ghi lại bằng ADR.

### `drive_blob`
Xóa `FileVersion` không xóa `Blob`, và Blob đang có version thì không xóa được (`PROTECT`):
object trên S3 phải được xóa trước, việc này thuộc thùng rác (M4) và dọn phiên bản (M7).

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid | |
| storage_key | text, unique | ví dụ `blobs/{uuid}`. Không chứa tên file |
| size | bigint | |
| checksum_sha256 | char(64), null | |
| etag | text | |

### `drive_file_version`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid | |
| node_id | uuid → Node | |
| blob_id | uuid → Blob | |
| version_number | int | tăng dần theo từng node, unique `(node_id, version_number)` |
| size | bigint | |
| mime_type | varchar(255) | |
| uploaded_by_id | uuid → User | |
| original_name | varchar(255) | tên file lúc upload |
| keep_forever | bool | không bị chính sách giữ phiên bản tự động dọn |

`version_number` ≥ 1. `uploaded_by` dùng `SET_NULL`.
`drive_node.current_version_id` chỉ trỏ được tới version **của chính node đó**: khóa ngoại hai cột `(current_version_id, id) → drive_file_version (id, node_id)`,
kèm unique `(id, node_id)`, viết bằng SQL trong migration `drive.0004` vì Django không khai báo được. Cột trống thì không bị kiểm tra.

### `uploads_upload_session`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid | |
| user_id | uuid → User | người upload; chỉ người này thấy session |
| owner_id | uuid → User | bị tính quota: owner của folder đích. Lưu riêng để trả lại phần giữ chỗ cả khi folder đã bị xóa |
| parent_id | uuid → Node, null | folder đích; `SET_NULL` khi folder bị xóa |
| parent_path | jsonb | `[{id, name}]` từ folder gốc tới folder đích, chụp lúc tạo, để tạo lại đường dẫn bị mất khi hoàn tất |
| target_node_id | uuid → Node, null | có giá trị khi upload phiên bản mới cho file đã có (M7-01, chưa có) |
| filename | varchar(255) | |
| size | bigint | |
| mime_type | varchar(255) | |
| fingerprint | varchar(128) | dùng để FE nhận ra lại file khi resume |
| storage_key | text | |
| s3_upload_id | text | |
| part_size | int | |
| status | enum(`active`,`completed`,`aborted`,`expired`) | |
| expires_at | timestamptz | mặc định 7 ngày |
| on_conflict | enum(`fail`,`rename`) | trùng tên lúc tạo: 409 hay "Giữ cả hai" |
| node_id | uuid → Node, null | file đã tạo, để `complete` gọi lại trả đúng node |

`storage_key` unique; `s3_upload_id` trống với file 0 byte. Index `(user_id, status, created_at, id)` cho danh sách, `(status, expires_at)` cho việc dọn ở M2-06.

Trạng thái của từng part **không lưu trong DB**: lấy từ S3 `ListParts` khi cần resume.

### `sharing_share`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid | |
| node_id | uuid → Node | |
| grantee_id | uuid → User | |
| role | enum(`viewer`,`editor`) | |
| created_by_id | uuid → User | |
Unique `(node_id, grantee_id)`.

### `sharing_share_link`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid | |
| node_id | uuid → Node | |
| token | varchar(43), unique | sinh ngẫu nhiên, ít nhất 256 bit (`secrets.token_urlsafe(32)`) |
| role | enum(`viewer`) | MVP chỉ có quyền xem |
| expires_at | timestamptz, null | |
| revoked_at | timestamptz, null | |
| revoked_by_id | uuid → User, null | owner hoặc admin |
| revoke_reason | varchar(30), null | `owner`, `moderation` |
| created_by_id | uuid → User | |

### `moderation_report`
Báo cáo vi phạm từ trang link công khai (xem [sharing.md](features/sharing.md)).

| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid | |
| share_link_id | uuid → ShareLink | |
| node_id | uuid → Node | node cụ thể bị báo cáo (có thể là node con trong folder được chia sẻ) |
| reason | enum(`illegal`,`copyright`,`malware`,`abuse`,`other`) | |
| message | text, null | tối đa 2000 ký tự |
| reporter_email | citext, null | không bắt buộc |
| reporter_user_id | uuid → User, null | có giá trị nếu người báo cáo đang đăng nhập |
| reporter_ip_hash | char(64) | băm IP kèm salt, dùng để chống spam; không lưu IP gốc |
| status | enum(`open`,`actioned`,`dismissed`) | |
| resolved_by_id | uuid → User, null | |
| resolved_at | timestamptz, null | |
| resolution_note | text, null | |

**Khóa user:** thêm vào `accounts_user` các cột `suspended_at timestamptz null` và `suspended_reason text null`.
User bị khóa thì không đăng nhập được, mọi session cũ bị vô hiệu hóa qua `session_version`, và mọi share link của user ngừng hoạt động (kiểm tra lúc truy cập, không phải xóa link).

## Quy tắc về dung lượng

- `used_bytes` = tổng `size` của **mọi version** thuộc các node mà user sở hữu, gồm cả node trong thùng rác.
- Upload vào folder của người khác (khi có quyền `editor`): dung lượng được tính cho **owner của folder đích**, và file mới thuộc về owner đó.
  Giới hạn kích thước file cũng lấy theo plan của owner đó.
- Mọi thay đổi `used_bytes` và `reserved_bytes` phải dùng `SELECT ... FOR UPDATE` trên dòng user, hoặc cập nhật nguyên tử bằng `F()` kèm điều kiện kiểm tra.
