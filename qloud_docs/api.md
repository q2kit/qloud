# API

> **Nguồn sự thật là OpenAPI schema** do drf-spectacular sinh ra (`/api/schema/`, giao diện xem tại `/api/docs/`).
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
  `code` là chuỗi ổn định để FE dịch sang thông báo i18n. Mã HTTP: 400 (dữ liệu sai), 401, 403, 404 (**dùng 404 thay cho 403 khi không muốn để lộ là node có tồn tại**), 409 (xung đột), 413, 429.
- **Rate limit:** auth 10 req/phút/IP; tạo upload 60 req/phút/user; các endpoint còn lại 600 req/phút/user.

## Danh sách endpoint (tổng quan)

### Auth: `/api/v1/auth/...` (do allauth headless cung cấp)
Đăng ký, đăng nhập, đăng xuất, xác thực email, quên và đặt lại mật khẩu, OAuth Google/GitHub, lấy session hiện tại.

### Tài khoản
| Method | Path | Mô tả |
|---|---|---|
| GET/PATCH | `/me` | Thông tin cá nhân, locale, theme |
| GET | `/me/storage` | Quota, dung lượng đã dùng, chia theo loại file |

### Node
| Method | Path | Mô tả |
|---|---|---|
| GET | `/nodes/{id}` | Chi tiết node, breadcrumb, quyền của mình (`capabilities`) |
| GET | `/nodes/{id}/children` | Liệt kê con (phân trang, sắp xếp) |
| POST | `/folders` | Tạo folder `{parent_id, name}` |
| PATCH | `/nodes/{id}` | Đổi tên `{name}` |
| POST | `/nodes/move` | Di chuyển nhiều node `{node_ids, target_parent_id}` |
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
