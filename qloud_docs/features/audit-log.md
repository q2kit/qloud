# Audit log và tab Hoạt động (F-AUDIT)

**Trạng thái:** Đang làm (kế hoạch đã duyệt trên [#167](https://github.com/q2kit/qloud/issues/167#issuecomment-6239778098)) · **Milestone:** M8 (M8-11a BE, M8-11b FE) · **Màn hình:** tab Hoạt động trong panel chi tiết
Xem thêm [ADR-0012](../adr/0012-audit-log.md)

## User stories
- Tôi muốn biết ai đã đổi tên, di chuyển, xóa hay chia sẻ một file hoặc folder, và khi nào.
- Tôi muốn biết khi hệ thống dọn thùng rác/phiên bản hoặc quản trị viên gỡ link công khai của tôi.

## Quy tắc
- Mỗi thao tác dưới đây ghi đúng một sự kiện, trong cùng transaction; thao tác lỗi không để lại sự kiện. Thao tác hàng loạt ghi một sự kiện cho mỗi mục được chọn, không cho con cháu.

| Action | Khi nào | metadata |
|---|---|---|
| `node.create` | Tạo folder (không ghi khi dùng lại folder có sẵn) | — |
| `node.upload` | Upload xong một file mới | — |
| `version.create` | Upload xong một phiên bản mới cho file có sẵn | `version` |
| `node.rename` | Đổi tên | `from_name` |
| `node.move` | Di chuyển | `from_folder`, `to_folder` (`{id, name, is_root}`) |
| `node.trash`, `node.restore` | Đưa vào / khôi phục từ thùng rác | — |
| `node.purge` | Xóa vĩnh viễn (người dùng, hoặc hệ thống sau thời hạn thùng rác) | — |
| `version.restore`, `version.delete` | Khôi phục / xóa phiên bản | `from_version`, `version` / `version` |
| `version.expire` | Hệ thống dọn phiên bản theo plan | `versions` (danh sách số phiên bản) |
| `version.lock`, `version.unlock` | Đổi trạng thái Khóa | `version` |
| `share.add`, `share.role_change`, `share.remove` | Chia sẻ cho người dùng | `grantee` (`{id, name, email}`), `role`, `from_role` |
| `link.create`, `link.revoke` | Tạo / thu hồi liên kết công khai (cả khi kiểm duyệt gỡ) | `link_id`, `expires_at` |

- Người thực hiện: `actor_kind` là `user`, `system` (job dọn) hoặc `moderator` (kiểm duyệt; không lưu danh tính quản trị viên). Tên người thực hiện là tên hiển thị lúc đó, không bao giờ là email.
- Không ghi download/preview. Không lưu key S3, URL presigned, token link, IP hay user agent.
- Giữ 365 ngày, cố định, không tính vào quota hay plan.

## Đọc hoạt động
- `GET /nodes/{id}/activity` cần quyền viewer trở lên trên node còn sống; không có quyền thì 404.
- File: các sự kiện của chính file. Folder: các sự kiện có node, folder chứa hoặc folder nguồn (khi di chuyển) nằm trong cây con của folder, kể cả mục đã vào thùng rác hoặc đã bị xóa.
- Người nhận chia sẻ ở một nhánh con chỉ đọc được từ nhánh đó trở xuống.
- Email của người thực hiện và người nhận chia sẻ chỉ trả cho editor/owner. Tên folder trong `node.move` chỉ trả khi người đọc là owner hoặc mở được folder đó; nếu không, folder hiện là `{id: null, name: null}`.
- Django admin đọc và lọc sự kiện (action, loại người thực hiện, ngày; tìm theo tên/email), không thêm/sửa/xóa.

## Tiêu chí chấp nhận
- [x] Mỗi thao tác trong bảng tạo đúng một sự kiện, cùng transaction; thao tác lỗi không tạo sự kiện. (M8-11a)
- [x] API đúng quyền, có test không có quyền (404), không N+1, cursor pagination. (M8-11a)
- [ ] Tab Hoạt động hiển thị đúng, đủ i18n, light/dark, desktop/360px. (M8-11b)
- [x] Django admin đọc và lọc được. (M8-11a)
- [x] Migration chạy trên DB trống và DB có dữ liệu. (M8-11a)
